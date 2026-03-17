import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { extractTableRows } from '@/lib/table-extract';
import { detectHeader, parseTransactions } from '@/lib/table-parse';
import { computeFingerprint } from '@/lib/fingerprint';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const FLAG_KEYWORDS = ['refund', 'failed', 'reversal', 'chargeback', 'dispute', 'unknown', 'error', 'hold'];
function shouldFlag(d: string) { return FLAG_KEYWORDS.some(kw => d.toLowerCase().includes(kw)); }

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const documentId = params.id;
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = (data: object) => {
    try { writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
  };

  (async () => {
    try {
      const docs = await sql`SELECT * FROM documents WHERE id = ${documentId} AND user_id = ${userId}`;
      if (docs.length === 0) { send({ type: 'error', message: 'Document not found' }); return; }
      const doc = docs[0];

      if (doc.status === 'extracting') { send({ type: 'error', message: 'Extraction already in progress' }); return; }

      await sql`UPDATE documents SET status = 'extracting', extracted_at = null WHERE id = ${documentId}`;

      // Decrypt password
      let pdfPassword: string | undefined;
      if (doc.password_hint) {
        try {
          pdfPassword = decrypt(doc.password_hint);
          send({ type: 'log', message: '🔐 Password decrypted' });
        } catch (e) {
          await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
          send({ type: 'error', message: `Password decryption failed: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
      }

      // Download PDF
      send({ type: 'log', message: '📥 Downloading PDF...' });
      const pdfResponse = await fetch(doc.blob_url);
      if (!pdfResponse.ok) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: `Failed to download PDF: ${pdfResponse.status}` });
        return;
      }
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      send({ type: 'log', message: `✓ PDF downloaded (${(pdfBuffer.length / 1024).toFixed(0)} KB)` });

      // Extract table rows using coordinate-based parsing
      send({ type: 'log', message: '📊 Extracting table structure from PDF...' });
      let rows;
      try {
        rows = await extractTableRows(pdfBuffer, pdfPassword);
      } catch (e) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: 'error', message: `PDF parse failed: ${msg.toLowerCase().includes('password') ? msg + ' — check PDF password' : msg}` });
        return;
      }

      send({ type: 'log', message: `✓ Found ${rows.length} rows across all pages` });

      // Detect header row and column mapping
      send({ type: 'log', message: '🔍 Detecting column headers...' });
      const headerResult = detectHeader(rows);

      if (!headerResult) {
        // Log a sample from different parts of the document
        const sampleRows = [
          ...rows.slice(0, 5),
          ...rows.slice(Math.floor(rows.length / 4), Math.floor(rows.length / 4) + 5),
        ];
        const sample = sampleRows.map((r, i) => `  Row ${i+1}: [${r.cells.join(' | ')}]`).join('\n');
        send({ type: 'log', message: `First 10 rows sample:\n${sample}` });
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: 'Could not detect column headers. Check Preview (👁) to see raw rows and identify the header format.' });
        return;
      }

      const { headerIndex, map } = headerResult;
      const headerRow = rows[headerIndex];
      send({ type: 'log', message: `✓ Headers found on row ${headerIndex + 1}: ${headerRow.cells.join(' | ')}` });
      send({ type: 'log', message: `  Column map: ${Object.entries(map).map(([k,v]) => `${k}→col${(v as number)+1}`).join(', ')}` });

      // Parse transactions from rows
      send({ type: 'log', message: '⚙️  Parsing transaction rows...' });
      const transactions = parseTransactions(rows, headerIndex, map);
      send({ type: 'log', message: `✓ Parsed ${transactions.length} transaction rows` });

      if (transactions.length === 0) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: 'No transactions could be parsed. Headers were detected but no valid data rows found.' });
        return;
      }

      // Save to database
      send({ type: 'log', message: `💾 Saving ${transactions.length} transactions to database...` });
      let inserted = 0;
      let skipped = 0;

      for (const tx of transactions) {
        const fingerprint = computeFingerprint(userId, tx.date, tx.description, tx.amount, tx.type);
        const flagged = shouldFlag(tx.description);
        try {
          const result = await sql`
            INSERT INTO transactions (
              user_id, document_id, date, value_date, description,
              amount, currency, balance, type,
              reference_number, mode,
              fingerprint, flagged, flag_reason
            ) VALUES (
              ${userId}, ${documentId}, ${tx.date}, ${tx.value_date},
              ${tx.description}, ${tx.amount}, ${tx.currency},
              ${tx.balance}, ${tx.type},
              ${tx.reference_number}, ${tx.mode},
              ${fingerprint}, ${flagged},
              ${flagged ? 'Auto-flagged: suspicious keyword' : null}
            )
            ON CONFLICT (user_id, fingerprint) DO NOTHING
            RETURNING id
          `;
          result.length > 0 ? inserted++ : skipped++;
        } catch (e) {
          console.error('Insert error:', e);
          skipped++;
        }
      }

      await sql`UPDATE documents SET status = 'extracted', extracted_at = now() WHERE id = ${documentId}`;
      send({ type: 'done', inserted, skipped, total: transactions.length });

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Extraction error:', msg);
      try { await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`; } catch { /**/ }
      send({ type: 'error', message: msg });
    } finally {
      try { writer.close(); } catch { /**/ }
    }
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
