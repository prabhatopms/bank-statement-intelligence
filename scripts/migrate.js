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
      value_date DATE,
      description TEXT,
      amount NUMERIC(18,2),
      currency TEXT DEFAULT 'INR',
      balance NUMERIC(18,2),
      type TEXT CHECK (type IN ('debit','credit')),
      mode TEXT,
      transaction_id TEXT,
      reference_number TEXT,
      counterparty TEXT,
      counterparty_account TEXT,
      counterparty_bank TEXT,
      upi_id TEXT,
      remarks TEXT,
      location TEXT,
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

  // Add new columns to existing tables (idempotent)
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS value_date DATE`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mode TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_number TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_account TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_bank TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS upi_id TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS remarks TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS location TEXT`;

  // Extraction metadata for adaptive improvement
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_meta JSONB`;

  // Richer enrichment fields
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS label TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sub_category TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_type TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_app TEXT`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT`;

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
