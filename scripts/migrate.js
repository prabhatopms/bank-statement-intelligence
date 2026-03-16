const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

async function migrate() {
  const sql = neon(process.env.DATABASE_URL);

  console.log('Running migrations...');

  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      blob_url TEXT NOT NULL,
      password_hint TEXT,
      llm_provider TEXT,
      llm_model TEXT,
      status TEXT DEFAULT 'uploaded',
      uploaded_at TIMESTAMPTZ DEFAULT now(),
      extracted_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
      date DATE,
      description TEXT,
      amount NUMERIC(18,2),
      currency TEXT DEFAULT 'INR',
      balance NUMERIC(18,2),
      type TEXT CHECK (type IN ('debit','credit')),
      fingerprint TEXT NOT NULL,
      flagged BOOLEAN DEFAULT false,
      flag_reason TEXT,
      enriched BOOLEAN DEFAULT false,
      merchant TEXT,
      website TEXT,
      category TEXT,
      enrich_source TEXT,
      enriched_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, fingerprint)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_transactions_document_id ON transactions(document_id)
  `;

  console.log('Migrations complete!');
}

migrate().catch(console.error);
