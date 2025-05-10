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