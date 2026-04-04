import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL!);

  // Ensure enrichment_jobs table exists (idempotent)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS enrichment_jobs (
        user_id TEXT PRIMARY KEY,
        enabled BOOLEAN DEFAULT true,
        status TEXT DEFAULT 'idle' CHECK (status IN ('idle','running','paused')),
        processed_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        total_unenriched INT DEFAULT 0,
        failed_ids JSONB DEFAULT '[]',
        last_label TEXT,
        last_error TEXT,
        last_run_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;
  } catch {
    // table already exists or other DDL issue — continue
  }

  // Upsert — create job row if missing (default: enabled)
  await sql`
    INSERT INTO enrichment_jobs (user_id, enabled, status)
    VALUES (${userId}, true, 'idle')
    ON CONFLICT (user_id) DO NOTHING
  `;

  const rows = await sql`
    SELECT enabled, status, processed_count, failed_count,
           total_unenriched, last_label, last_error, last_run_at,
           failed_ids
    FROM enrichment_jobs
    WHERE user_id = ${userId}
  `;

  const job = (rows[0] || {}) as Record<string, unknown>;

  // Live counts from transactions table
  const [unenrichedRows, totalRows] = await Promise.all([
    sql`SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ${userId} AND enriched = false`,
    sql`SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ${userId}`,
  ]);
  const totalUnenriched = parseInt(String((unenrichedRows[0] as { cnt: string }).cnt), 10);
  const totalTransactions = parseInt(String((totalRows[0] as { cnt: string }).cnt), 10);

  return NextResponse.json({
    enabled: job.enabled ?? true,
    status: job.status ?? 'idle',
    processedCount: job.processed_count ?? 0,
    failedCount: job.failed_count ?? 0,
    totalUnenriched,
    totalTransactions,
    lastLabel: job.last_label ?? null,
    lastError: job.last_error ?? null,
    lastRunAt: job.last_run_at ?? null,
    failedIds: Array.isArray(job.failed_ids) ? (job.failed_ids as string[]).length : 0,
  });
}
