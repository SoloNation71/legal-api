# Legal Research API Implementation Guide

This guide provides detailed instructions for implementing the Google Scholar-like legal research API for your In My Square Legal App. The implementation follows a hybrid approach using your existing Supabase database while creating a proprietary API service.

## Table of Contents
1. [System Overview](#system-overview)
2. [Implementation Steps](#implementation-steps)
3. [API Endpoints](#api-endpoints)
4. [Data Sources](#data-sources)
5. [Deployment](#deployment)
6. [Maintenance and Scaling](#maintenance-and-scaling)
7. [Monetization Options](#monetization-options)

## System Overview

This system creates a legal research API with functionality similar to Google Scholar but focused on legal content. It aggregates data from multiple sources:

1. **Primary storage**: Your Supabase database (cesifthkmduihsjiiwxj)
2. **External APIs**: CourtListener, Caselaw Access Project, PubMed
3. **Selective web scraping**: For legal journals and repositories that allow it

The architecture employs caching, rate limiting, and data deduplication to provide fast, reliable results while building your proprietary database over time.

## Implementation Steps

### 1. Set Up Supabase Schema

Create the following tables in your Supabase instance:

- `legal_cases`: Store case law information
- `legal_articles`: Store academic articles
- `citations`: Track citation relationships
- `judges`: Store judge information
- `search_queries`: Track common searches for optimization

Refer to the Database Schema diagram for detailed structure.

### 2. Set Up Development Environment

```bash
# Create project directory
mkdir legal-research-api
cd legal-research-api

# Initialize Node.js project
npm init -y

# Install dependencies
npm install express cors @supabase/supabase-js axios cheerio 
npm install async-sema lru-cache dotenv

# Create main file
touch index.js
```

### 3. Implement Core API Logic

Copy the provided API code to your `index.js` file, adjusting as needed for your specific use case.

### 4. Configure Environment Variables

Create a `.env` file with the necessary credentials:

```
SUPABASE_URL=https://cesifthkmduihsjiiwxj.supabase.co
SUPABASE_KEY=your_supabase_key
COURTLISTENER_API_KEY=your_courtlistener_key  # If available
CASELAW_API_KEY=your_caselaw_key  # If available
PORT=3000
```

### 5. Implement Data Source Adapters

For each external data source, implement a specialized adapter to normalize the data format. The provided code includes basic implementations for:

- CourtListener API
- Caselaw Access Project API
- PubMed API
- Web scraping (selected legal journals)

### 6. Create Database Migration Scripts

Create migration scripts to set up your database schema:

```javascript
// migrations/01_create_schema.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createSchema() {
  // Create legal_cases table
  const { error: casesError } = await supabase.rpc('create_table_if_not_exists', {
    table_name: 'legal_cases',
    columns: `
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title TEXT NOT NULL,
      content TEXT,
      court TEXT,
      decision_date DATE,
      judges TEXT,
      url TEXT,
      source TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    `
  });
  
  if (casesError) {
    console.error('Error creating legal_cases table:', casesError);
    return;
  }
  
  // Create remaining tables (following the same pattern)
  // ...
}

createSchema()
  .then(() => console.log('Schema created successfully'))
  .catch(err => console.error('Error creating schema:', err));
```

## API Endpoints

Your API will expose the following endpoints:

### Search Endpoint
```
GET /api/search
```
Parameters:
- `query` (required): Search term
- `filter` (optional): Comma-separated list of filters (e.g., `court:federal,year:2020`)
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Results per page (default: 20)

### Case Detail Endpoint
```
GET /api/case/:id
```
Parameters:
- `id` (required): Case identifier

### Citations Network Endpoint
```
GET /api/citations/:id
```
Parameters:
- `id` (required): Case identifier
- `direction` (optional): `citing`, `cited`, or `both` (default: `both`)
- `depth` (optional): Depth of citation network (default: 1)

### Judge Information Endpoint
```
GET /api/judge/:name
```
Parameters:
- `name` (required): Judge name

## Data Sources

### Free and Open Sources
- **CourtListener API**: Access to federal and state court opinions
- **Caselaw Access Project**: Historical US case law
- **PubMed API**: Medical-legal articles
- **Law Journals**: Many have open access policies

### Premium Sources (Optional)
Consider partnerships with:
- **LexisNexis API**: Comprehensive legal database
- **Westlaw API**: Case law and legal research
- **HeinOnline**: Law journal database

## Deployment

### Option 1: Cloud Deployment (Recommended)
Deploy your API service to a cloud provider:

```bash
# Example for deploying to Heroku
heroku create in-my-square-legal-api
git init
git add .
git commit -m "Initial commit"
heroku git:remote -a in-my-square-legal-api
git push heroku main
```

### Option 2: Self-Hosted Deployment
For more control, deploy on your own server:

```bash
# Set up a Node.js server with PM2
npm install pm2 -g
pm2 start index.js --name legal-research-api
pm2 save
pm2 startup
```

## Maintenance and Scaling

### Regular Maintenance
- **Update data sources**: Check API endpoints regularly and add new sources as they become available
- **Optimize database**: Add indexes for frequent queries and analyze query performance
- **Monitor rate limits**: Adjust as needed to avoid being blocked by external APIs
- **Refresh cached data**: Implement a background job to refresh frequently accessed data
- **Update scraping patterns**: Web sources may change their layout requiring scraper updates

### Scaling Strategies
- **Horizontal scaling**: Deploy multiple API instances behind a load balancer
- **Query optimization**: Create database indexes for common search patterns
- **Cache expansion**: Increase cache size and implement distributed caching with Redis
- **Database partitioning**: Shard data by jurisdiction or time period for faster queries