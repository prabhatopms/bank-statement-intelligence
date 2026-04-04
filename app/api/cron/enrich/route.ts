import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { enrichTransaction, saveEnrichResult } from '@/lib/enrich';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 20;     // records per user per cron tick
const TX_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header, or manual trigger via query param)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Find all users with auto-enrichment enabled (not currently running or idle)
  const jobs = await sql`
    SELECT user_id, failed_ids, processed_count, failed_count
    FROM enrichment_jobs
    WHERE enabled = true
  `;

  if (jobs.length === 0) {
    return NextResponse.json({ message: 'No jobs to run', processed: 0 });
  }

  let totalProcessed = 0;
  let totalFailed = 0;

  for (const job of jobs) {
    const userId = job.user_id as string;
    const failedIds: string[] = (job.failed_ids as string[]) || [];
    let jobProcessed = job.processed_count as number;
    let jobFailed = job.failed_count as number;

    // Mark as running
    await sql`
      UPDATE enrichment_jobs
      SET status = 'running', updated_at = now()
      WHERE user_id = ${userId}
    `;

    try {
      // Get unenriched transactions, excluding permanently failed ones
      const rows = failedIds.length > 0
        ? await sql`
            SELECT * FROM transactions
            WHERE user_id = ${userId}
              AND enriched = false
              AND id != ALL(${failedIds}::uuid[])
            ORDER BY date DESC
            LIMIT ${BATCH_SIZE}
          `
        : await sql`
            SELECT * FROM transactions
            WHERE user_id = ${userId} AND enriched = false
            ORDER BY date DESC
            LIMIT ${BATCH_SIZE}
          `;

      if (rows.length === 0) {
        // Nothing left to enrich — count remaining (might all be in failed_ids)
        const countRows = await sql`
          SELECT COUNT(*) AS cnt FROM transactions
          WHERE user_id = ${userId} AND enriched = false
        `;
        const remaining = parseInt(String((countRows[0] as { cnt: string }).cnt), 10);

        await sql`
          UPDATE enrichment_jobs
          SET status = 'idle',
              total_unenriched = ${remaining},
              last_run_at = now(),
              updated_at = now()
          WHERE user_id = ${userId}
        `;
        continue;
      }

      let lastLabel = '';
      const newFailedIds = [...failedIds];

      for (const tx of rows) {
        const txId = tx.id as string;
        try {
          const result = await withTimeout(
            enrichTransaction(tx as Parameters<typeof enrichTransaction>[0]),
            TX_TIMEOUT_MS
          );
          await saveEnrichResult(txId, userId, result);
          jobProcessed++;
          totalProcessed++;
          lastLabel = result.label;
        } catch (e) {
          jobFailed++;
          totalFailed++;
          newFailedIds.push(txId);

          await sql`
            UPDATE enrichment_jobs
            SET last_error = ${e instanceof Error ? e.message : 'Unknown error'},
                updated_at = now()
            WHERE user_id = ${userId}
          `;
        }
      }

      // Count remaining
      const countRows = await sql`
        SELECT COUNT(*) AS cnt FROM transactions
        WHERE user_id = ${userId} AND enriched = false
      `;
      const remaining = parseInt(String((countRows[0] as { cnt: string }).cnt), 10);

      await sql`
        UPDATE enrichment_jobs
        SET status = 'idle',
            processed_count = ${jobProcessed},
            failed_count = ${jobFailed},
            total_unenriched = ${remaining},
            failed_ids = ${JSON.stringify(newFailedIds)}::jsonb,
            last_label = ${lastLabel || null},
            last_run_at = now(),
            updated_at = now()
        WHERE user_id = ${userId}
      `;
    } catch (e) {
      // Whole-job error — mark idle so it retries next tick
      await sql`
        UPDATE enrichment_jobs
        SET status = 'idle',
            last_error = ${e instanceof Error ? e.message : 'Cron job error'},
            updated_at = now()
        WHERE user_id = ${userId}
      `;
    }
  }

  return NextResponse.json({
    message: `Processed ${totalProcessed}, failed ${totalFailed}`,
    usersProcessed: jobs.length,
    processed: totalProcessed,
    failed: totalFailed,
  });
}
