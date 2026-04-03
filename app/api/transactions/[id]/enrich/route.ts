import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';
import { enrichTransaction, saveEnrichResult } from '@/lib/enrich';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const txId = params.id;
    const txs = await sql`SELECT * FROM transactions WHERE id = ${txId} AND user_id = ${userId}`;
    if (txs.length === 0) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const result = await enrichTransaction(txs[0] as Parameters<typeof enrichTransaction>[0]);
    await saveEnrichResult(txId, userId, result);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Enrichment error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Enrichment failed' }, { status: 500 });
  }
}
