import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';
import { enrichTransaction, saveEnrichResult } from '@/lib/enrich';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { ids, enrichAll = false } = await request.json();

  // Collect transaction IDs to process
  let transactionIds: string[] = ids ?? [];
  if (enrichAll) {
    const rows = await sql`
      SELECT id FROM transactions
      WHERE user_id = ${userId} AND enriched = false
      ORDER BY date DESC
      LIMIT 200
    `;
    transactionIds = (rows as { id: string }[]).map(r => r.id);
  }

  if (transactionIds.length === 0) {
    return new Response(`data: ${JSON.stringify({ type: 'done', processed: 0, failed: 0, total: 0 })}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const send = (data: object) => {
    try { writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /**/ }
  };

  (async () => {
    const total = transactionIds.length;
    let processed = 0, failed = 0;

    // Fetch all tx details in one query — no internal HTTP calls
    const txRows = await sql`
      SELECT * FROM transactions
      WHERE id = ANY(${transactionIds}) AND user_id = ${userId}
    `;
    const txMap = new Map((txRows as { id: string }[]).map(t => [t.id, t]));

    send({ type: 'started', total });

    for (let i = 0; i < transactionIds.length; i++) {
      const txId = transactionIds[i];
      const tx = txMap.get(txId);
      if (!tx) continue;

      send({ type: 'progress', current: i + 1, total, id: txId, description: (tx as Record<string, unknown>).description as string });

      try {
        const result = await enrichTransaction(tx as Parameters<typeof enrichTransaction>[0]);
        await saveEnrichResult(txId, userId, result);
        processed++;
        send({ type: 'enriched', id: txId, label: result.label, category: result.category, notes: result.notes });
      } catch (e) {
        failed++;
        send({ type: 'failed', id: txId, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    send({ type: 'done', processed, failed, total });
    try { writer.close(); } catch { /**/ }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
