// Legal Research API Architecture for In My Square Legal App
// This code provides a high-level implementation of a scholarly/legal research API

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
const { RateLimit } = require('async-sema');
const LRUCache = require('lru-cache');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://uhhxlimwdctancprdsst.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY ||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoaHhsaW13ZGN0YW5jcHJkc3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY4MzYzMjMsImV4cCI6MjA2MjQxMjMyM30.qYc_jj2wrh3sXBiJ53pqn_hRtXG1Vq6y4zLTra4F_Ac';
const supabase = createClient(supabaseUrl, supabaseKey);

// Rate limiting to prevent getting blocked
const courtListenerLimit = RateLimit(5); // 5 requests per second
const caseAccessLimit = RateLimit(2); // 2 requests per second
const webScraperLimit = RateLimit(1); // 1 request per second

// Cache configuration
const searchCache = new LRUCache({
  max: 1000, // Store up to 1000 search results
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});

// Database tables we'll need in Supabase
// - legal_cases: Stores case information
// - legal_articles: Stores academic article information
// - citations: Stores citation relationships
// - search_queries: Stores common search queries for optimization
// - judges: Stores judge information

/**
 * Main search endpoint that aggregates results from multiple sources
 */
app.get('/api/search', async (req, res) => {
  try {
    const { query, filter, page = 1, limit = 20 } = req.query;
    
    // Create a cache key
    const cacheKey = `${query}-${filter}-${page}-${limit}`;
    
    // Check cache first
    const cachedResults = searchCache.get(cacheKey);
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Get results from our database first (fastest)
    const dbResults = await searchInternalDatabase(query, filter, page, limit);
    
    // Get results from external APIs
    const apiResults = await Promise.all([
      searchCourtListener(query, filter),
      searchCaselaw(query, filter),
      searchPubMed(query, filter),
    ]);
    
    // Web scraping as last resort (if needed)
    let webResults = [];
    if (dbResults.length + apiResults.flat().length < limit) {
      webResults = await scrapeAllowedSources(query, filter);
    }
    
    // Combine, deduplicate, and sort results
    const allResults = [...dbResults, ...apiResults.flat(), ...webResults];
    const uniqueResults = deduplicateResults(allResults);
    const sortedResults = sortResultsByRelevance(uniqueResults, query);
    
    // Store in cache
    const paginatedResults = paginateResults(sortedResults, page, limit);
    searchCache.set(cacheKey, paginatedResults);
    
    // Store new results in our database for future searches
    storeResultsInDatabase(uniqueResults);
    
    return res.json(paginatedResults);
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'An error occurred during search' });
  }
});

/**
 * Get detailed information about a specific case
 */
app.get('/api/case/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check our database first
    let caseData = await getCaseFromDatabase(id);
    
    // If not in our database, fetch from external sources
    if (!caseData) {
      caseData = await fetchCaseFromExternalSources(id);
      
      // Store in our database
      if (caseData) {
        await storeCaseInDatabase(caseData);
      }
    }
    
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    return res.json(caseData);
  } catch (error) {
    console.error('Case retrieval error:', error);
    return res.status(500).json({ error: 'An error occurred retrieving the case' });
  }
});

/**
 * Get citation network for a case
 */
app.get('/api/citations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { direction = 'both', depth = 1 } = req.query;
    
    // Get citation network
    const citations = await getCitationNetwork(id, direction, depth);
    
    return res.json(citations);
  } catch (error) {
    console.error('Citation retrieval error:', error);
    return res.status(500).json({ error: 'An error occurred retrieving citations' });
  }
});

/**
 * Get information about a judge
 */
app.get('/api/judge/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    // Get judge data
    const judgeData = await getJudgeData(name);
    
    if (!judgeData) {
      return res.status(404).json({ error: 'Judge not found' });
    }
    
    return res.json(judgeData);
  } catch (error) {
    console.error('Judge data retrieval error:', error);
    return res.status(500).json({ error: 'An error occurred retrieving judge data' });
  }
});

// Database interaction functions
async function searchInternalDatabase(query, filter, page, limit) {
  // Search our Supabase database first
  const { data, error } = await supabase
    .from('legal_cases')
    .select('*')
    .or(`title.ilike.%${query}%, content.ilike.%${query}%`)
    .range((page - 1) * limit, page * limit - 1);
    
  if (error) {
    console.error('Database search error:', error);
    return [];
  }
  
  return data || [];
}

async function getCaseFromDatabase(id) {
  const { data, error } = await supabase
    .from('legal_cases')
    .select('*')
    .eq('id', id)
    .single();
    
  if (error) {
    console.error('Case retrieval error:', error);
    return null;
  }
  
  return data;
}

async function storeCaseInDatabase(caseData) {
  const { error } = await supabase
    .from('legal_cases')
    .upsert(caseData);
    
  if (error) {
    console.error('Case storage error:', error);
  }
}

async function storeResultsInDatabase(results) {
  // Filter out results that are likely already in our database
  const newResults = results.filter(result => !result.inDatabase);
  
  if (newResults.length === 0) {
    return;
  }
  
  const { error } = await supabase
    .from('legal_cases')
    .upsert(newResults.map(result => ({
      id: result.id,
      title: result.title,
      content: result.content,
      court: result.court,
      date: result.date,
      url: result.url,
      source: result.source
    })));
    
  if (error) {
    console.error('Bulk storage error:', error);
  }
}

// External API interaction functions
async function searchCourtListener(query, filter) {
  await courtListenerLimit();
  try {
    // Replace with actual CourtListener API call
    const response = await axios.get('https://www.courtlistener.com/api/rest/v3/search/', {
      params: {
        q: query,
        ...parseFilters(filter)
      },
      headers: {
        'Authorization': `Token ${process.env.COURTLISTENER_API_KEY}`
      }
    });
    
    return response.data.results.map(formatCourtListenerResult);
  } catch (error) {
    console.error('CourtListener API error:', error);
    return [];
  }
}

async function searchCaselaw(query, filter) {
  await caseAccessLimit();
  try {
    // Replace with actual Caselaw Access Project API call
    const response = await axios.get('https://api.case.law/v1/cases/', {
      params: {
        search: query,
        ...parseFilters(filter)
      },
      headers: {
        'Authorization': `Token ${process.env.CASELAW_API_KEY}`
      }
    });
    
    return response.data.results.map(formatCaselawResult);
  } catch (error) {
    console.error('Caselaw Access Project API error:', error);
    return [];
  }
}

async function searchPubMed(query, filter) {
  try {
    // Search PubMed for legal medical articles
    const response = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: {
        db: 'pubmed',
        term: `${query} AND law[Title/Abstract]`,
        retmode: 'json',
        retmax: 20
      }
    });
    
    const ids = response.data.esearchresult.idlist;
    if (!ids || ids.length === 0) {
      return [];
    }
    
    // Get details for each article
    const detailsResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
      params: {
        db: 'pubmed',
        id: ids.join(','),
        retmode: 'json'
      }
    });
    
    return Object.values(detailsResponse.data.result).filter(r => r.uid).map(formatPubMedResult);
  } catch (error) {
    console.error('PubMed API error:', error);
    return [];
  }
}

// Web scraping functions (use carefully and respect robots.txt)
async function scrapeAllowedSources(query, filter) {
  await webScraperLimit();
  
  try {
    // Example: scrape a site that allows academic search scraping
    // Always check robots.txt first and respect it
    const response = await axios.get('https://lawreview.stanford.edu/search', {
      params: { q: query },
      headers: {
        'User-Agent': 'Legal Research Bot (contact@inmysquare.app)'
      }
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // Extract search results
    $('.search-result').each((i, el) => {
      results.push({
        id: `stanford-${$(el).data('id') || i}`,
        title: $(el).find('.article-title').text().trim(),
        content: $(el).find('.article-excerpt').text().trim(),
        authors: $(el).find('.article-authors').text().trim(),
        date: $(el).find('.article-date').text().trim(),
        url: $(el).find('a').first().attr('href'),
        source: 'Stanford Law Review'
      });
    });
    
    return results;
  } catch (error) {
    console.error('Web scraping error:', error);
    return [];
  }
}

// Helper functions
function parseFilters(filterString) {
  if (!filterString) return {};
  
  const filters = {};
  const filterParts = filterString.split(',');
  
  filterParts.forEach(part => {
    const [key, value] = part.split(':');
    if (key && value) {
      filters[key] = value;
    }
  });
  
  return filters;
}

function formatCourtListenerResult(result) {
  return {
    id: `cl-${result.id}`,
    title: result.caseName,
    content: result.snippet,
    court: result.court_name,
    date: result.dateFiled,
    url: result.absolute_url,
    source: 'CourtListener'
  };
}

function formatCaselawResult(result) {
  return {
    id: `cap-${result.id}`,
    title: result.name,
    content: result.preview || '',
    court: result.court.name,
    date: result.decision_date,
    url: result.url,
    source: 'Caselaw Access Project'
  };
}

function formatPubMedResult(result) {
  return {
    id: `pm-${result.uid}`,
    title: result.title,
    content: result.description || '',
    authors: result.authors?.map(a => a.name).join(', ') || '',
    date: result.pubdate,
    url: `https://pubmed.ncbi.nlm.nih.gov/${result.uid}/`,
    source: 'PubMed'
  };
}

function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(result => {
    // Create a unique key based on title and court/source
    const key = `${result.title}-${result.court || result.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortResultsByRelevance(results, query) {
  // Basic relevance scoring
  // In a real implementation, this would be more sophisticated
  return results.sort((a, b) => {
    // Score based on title match
    const titleScoreA = a.title.toLowerCase().includes(query.toLowerCase()) ? 10 : 0;
    const titleScoreB = b.title.toLowerCase().includes(query.toLowerCase()) ? 10 : 0;
    
    // Score based on content match
    const contentScoreA = a.content.toLowerCase().includes(query.toLowerCase()) ? 5 : 0;
    const contentScoreB = b.content.toLowerCase().includes(query.toLowerCase()) ? 5 : 0;
    
    // Score based on recency (if date is available)
    const dateScoreA = a.date ? new Date(a.date).getTime() : 0;
    const dateScoreB = b.date ? new Date(b.date).getTime() : 0;
    
    // Combined score
    const totalScoreA = titleScoreA + contentScoreA + (dateScoreA / 10000000000);
    const totalScoreB = titleScoreB + contentScoreB + (dateScoreB / 10000000000);
    
    return totalScoreB - totalScoreA;
  });
}

function paginateResults(results, page, limit) {
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  
  return {
    results: results.slice(startIndex, endIndex),
    pagination: {
      total: results.length,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(results.length / limit)
    }
  };
}

async function getCitationNetwork(id, direction, depth) {
  // This would be a more complex implementation with recursion
  // For now, we'll do a simple version
  
  // Get direct citations first
  const { data: citedBy, error: citedByError } = await supabase
    .from('citations')
    .select('source_id, source_title')
    .eq('target_id', id);
    
  const { data: cites, error: citesError } = await supabase
    .from('citations')
    .select('target_id, target_title')
    .eq('source_id', id);
    
  if (citedByError || citesError) {
    console.error('Citation retrieval error:', citedByError || citesError);
    return { citedBy: [], cites: [] };
  }
  
  return {
    citedBy: citedBy || [],
    cites: cites || []
  };
}

async function getJudgeData(name) {
  // Get judge information from our database
  const { data, error } = await supabase
    .from('judges')
    .select('*')
    .ilike('name', `%${name}%`)
    .single();
    
  if (error) {
    console.error('Judge retrieval error:', error);
    return null;
  }
  
  if (!data) {
    // Try to fetch from external sources
    try {
      // Example: get from CourtListener judges API
      const response = await axios.get(`https://www.courtlistener.com/api/rest/v3/people/`, {
        params: { name_full__icontains: name },
        headers: {
          'Authorization': `Token ${process.env.COURTLISTENER_API_KEY}`
        }
      });
      
      if (response.data.results.length > 0) {
        const judgeData = {
          id: `cl-${response.data.results[0].id}`,
          name: response.data.results[0].name_full,
          position: response.data.results[0].position_titles?.[0] || 'Unknown',
          court: response.data.results[0].court_name || 'Unknown',
          appointed_by: response.data.results[0].appointer || 'Unknown',
          source: 'CourtListener'
        };
        
        // Store in our database for future
        await supabase.from('judges').insert(judgeData);
        
        return judgeData;
      }
    } catch (error) {
      console.error('External judge data retrieval error:', error);
    }
  }
  
  return data;
}

async function fetchCaseFromExternalSources(id) {
  // Extract the source prefix from the ID
  const [source, sourceId] = id.split('-');
  
  try {
    if (source === 'cl') {
      // Fetch from CourtListener
      await courtListenerLimit();
      const response = await axios.get(`https://www.courtlistener.com/api/rest/v3/opinions/${sourceId}/`, {
        headers: {
          'Authorization': `Token ${process.env.COURTLISTENER_API_KEY}`
        }
      });
      
      return {
        id: id,
        title: response.data.case_name,
        content: response.data.html_with_citations || response.data.plain_text,
        court: response.data.court_name,
        date: response.data.date_filed,
        judges: response.data.judges,
        url: response.data.absolute_url,
        source: 'CourtListener'
      };
    } else if (source === 'cap') {
      // Fetch from Caselaw Access Project
      await caseAccessLimit();
      const response = await axios.get(`https://api.case.law/v1/cases/${sourceId}/`, {
        headers: {
          'Authorization': `Token ${process.env.CASELAW_API_KEY}`
        }
      });
      
      return {
        id: id,
        title: response.data.name,
        content: response.data.casebody?.data?.opinions?.[0]?.text || '',
        court: response.data.court.name,
        date: response.data.decision_date,
        judges: response.data.casebody?.data?.judges || [],
        url: response.data.url,
        source: 'Caselaw Access Project'
      };
    } else if (source === 'pm') {
      // Fetch from PubMed
      const response = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
        params: {
          db: 'pubmed',
          id: sourceId,
          retmode: 'xml'
        }
      });
      
      // This would need XML parsing in a real implementation
      // For now, just return a placeholder
      return {
        id: id,
        title: 'PubMed Article',
        content: 'Article content',
        authors: 'Authors',
        date: '2023',
        url: `https://pubmed.ncbi.nlm.nih.gov/${sourceId}/`,
        source: 'PubMed'
      };
    }
  } catch (error) {
    console.error(`Error fetching case from ${source}:`, error);
    return null;
  }
  
  return null;
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Legal Research API running on port ${PORT}`);
});

module.exports = app;