import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';
import { enrichTransaction, saveEnrichResult } from '@/lib/enrich';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TX_TIMEOUT_MS = 15_000; // skip a transaction if Gemini takes longer than 15s

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Skipped — no response after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const {
    ids,
    enrichAll = false,
    excludeIds = [] as string[],
    limit = 100,
  } = await request.json();

  let transactionIds: string[] = ids ?? [];

  if (enrichAll) {
    const rows = excludeIds.length > 0
      ? await sql`
          SELECT id FROM transactions
          WHERE user_id = ${userId}
            AND enriched = false
            AND id != ALL(${excludeIds}::uuid[])
          ORDER BY date DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id FROM transactions
          WHERE user_id = ${userId} AND enriched = false
          ORDER BY date DESC
          LIMIT ${limit}
        `;
    transactionIds = (rows as { id: string }[]).map(r => r.id);
  }

  if (transactionIds.length === 0) {
    // Count remaining so client knows whether to stop
    const countRows = await sql`
      SELECT COUNT(*) AS cnt FROM transactions
      WHERE user_id = ${userId} AND enriched = false
    `;
    const remaining = parseInt(String((countRows[0] as { cnt: string }).cnt), 10);
    return new Response(
      `data: ${JSON.stringify({ type: 'done', processed: 0, failed: 0, total: 0, remaining, failedIds: [] })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const send = (data: object) => {
    try { writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /**/ }
  };

  (async () => {
    const total = transactionIds.length;
    let processed = 0;
    let failed = 0;
    const failedIds: string[] = [];

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

      send({
        type: 'progress',
        current: i + 1,
        total,
        id: txId,
        description: (tx as Record<string, unknown>).description as string,
      });

      try {
        const result = await withTimeout(
          enrichTransaction(tx as Parameters<typeof enrichTransaction>[0]),
          TX_TIMEOUT_MS
        );
        await saveEnrichResult(txId, userId, result);
        processed++;
        send({ type: 'enriched', id: txId, label: result.label, category: result.category, notes: result.notes });
      } catch (e) {
        failed++;
        failedIds.push(txId);
        send({ type: 'failed', id: txId, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    // How many unenriched remain (excluding permanently-failed ones this run)
    const countRows = await sql`
      SELECT COUNT(*) AS cnt FROM transactions
      WHERE user_id = ${userId} AND enriched = false
    `;
    const remaining = parseInt(String((countRows[0] as { cnt: string }).cnt), 10);

    send({ type: 'done', processed, failed, total, remaining, failedIds });
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
