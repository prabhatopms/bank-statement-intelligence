import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ids, mode = 'ai', enrichAll = false } = await request.json();

    let transactionIds: string[] = ids;

    if (enrichAll) {
      const unenriched = await sql`
        SELECT id FROM transactions
        WHERE user_id = ${userId} AND enriched = false
        LIMIT 100
      `;
      transactionIds = (unenriched as { id: string }[]).map((t) => t.id);
    }

    if (!transactionIds || transactionIds.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;
    for (const id of transactionIds) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/transactions/${id}/enrich?mode=${mode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        processed++;
      } catch (e) {
        console.error(`Failed to enrich transaction ${id}:`, e);
      }
    }

    return NextResponse.json({ processed, total: transactionIds.length });
  } catch (error) {
    console.error('Bulk enrichment error:', error);
    return NextResponse.json({ error: 'Bulk enrichment failed' }, { status: 500 });
  }
}
