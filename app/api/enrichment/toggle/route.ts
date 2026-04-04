import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { enabled, resetFailed } = await request.json();
  const sql = neon(process.env.DATABASE_URL!);

  if (resetFailed) {
    // Clear failed IDs so they get retried
    await sql`
      UPDATE enrichment_jobs
      SET failed_ids = '[]'::jsonb,
          failed_count = 0,
          last_error = null,
          updated_at = now()
      WHERE user_id = ${userId}
    `;
    return NextResponse.json({ ok: true, action: 'reset_failed' });
  }

  await sql`
    INSERT INTO enrichment_jobs (user_id, enabled, status)
    VALUES (${userId}, ${enabled}, 'idle')
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = ${enabled},
      -- If re-enabling, reset counters
      processed_count = CASE WHEN ${enabled} THEN 0 ELSE enrichment_jobs.processed_count END,
      failed_count = CASE WHEN ${enabled} THEN 0 ELSE enrichment_jobs.failed_count END,
      failed_ids = CASE WHEN ${enabled} THEN '[]'::jsonb ELSE enrichment_jobs.failed_ids END,
      last_error = null,
      updated_at = now()
  `;

  return NextResponse.json({ ok: true, enabled });
}
