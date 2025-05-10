erDiagram
    legal_cases {
        uuid id PK
        string title
        text content
        string court
        date decision_date
        string judges
        string url
        string source
        timestamp created_at
        timestamp updated_at
    }
    
    legal_articles {
        uuid id PK
        string title
        text abstract
        text content
        string authors
        date publication_date
        string journal
        string url
        string source
        timestamp created_at
        timestamp updated_at
    }
    
    citations {
        uuid id PK
        uuid source_id FK
        string source_title
        uuid target_id FK
        string target_title
        string citation_text
        timestamp created_at
    }
    
    judges {
        uuid id PK
        string name
        string position
        string court
        string appointed_by
        text biography
        string source
        timestamp created_at
        timestamp updated_at
    }
    
    search_queries {
        uuid id PK
        string query_text
        int frequency
        timestamp last_searched
        timestamp created_at
    }
    
    user_searches {
        uuid id PK
        uuid user_id FK
        string query_text
        jsonb filters
        timestamp created_at
    }
    
    legal_cases ||--o{ citations : "has"
    legal_articles ||--o{ citations : "has"
    legal_cases }o--o{ judges : "authored by"
    
    citations }o--|| legal_cases : "references"
    citations }o--|| legal_articles : "references"