import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL!);

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

  if (rows.length === 0) {
    return NextResponse.json({ enabled: true, status: 'idle', processedCount: 0, failedCount: 0, totalUnenriched: 0 });
  }

  const job = rows[0] as Record<string, unknown>;

  // Also get the live unenriched count (may be more recent than last cron run)
  const countRows = await sql`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE user_id = ${userId} AND enriched = false
  `;
  const liveUnenriched = parseInt(String((countRows[0] as { cnt: string }).cnt), 10);

  const totalRows = await sql`
    SELECT COUNT(*) AS cnt FROM transactions
    WHERE user_id = ${userId}
  `;
  const totalTransactions = parseInt(String((totalRows[0] as { cnt: string }).cnt), 10);

  return NextResponse.json({
    enabled: job.enabled,
    status: job.status,
    processedCount: job.processed_count,
    failedCount: job.failed_count,
    totalUnenriched: liveUnenriched,
    totalTransactions,
    lastLabel: job.last_label,
    lastError: job.last_error,
    lastRunAt: job.last_run_at,
    failedIds: Array.isArray(job.failed_ids) ? (job.failed_ids as string[]).length : 0,
  });
}
