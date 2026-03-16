import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateText } from 'ai';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { getLLMModel } from '@/lib/llm';
import { extractTextFromPDF } from '@/lib/pdf';
import { computeFingerprint } from '@/lib/fingerprint';

export const maxDuration = 300;

const FLAG_KEYWORDS = ['refund', 'failed', 'reversal', 'chargeback', 'dispute', 'unknown', 'error', 'hold'];
function shouldFlag(d: string) { return FLAG_KEYWORDS.some(kw => d.toLowerCase().includes(kw)); }

const SYSTEM_PROMPT = `You are a highly accurate bank statement parser. Your sole job is to extract EVERY transaction from bank statement text with zero omissions.

RULES — follow all of them exactly:

1. COMPLETENESS: Extract EVERY single transaction line. Do not skip, merge, summarise, or truncate. If a statement has 500 rows, return 500 objects.
2. OUTPUT FORMAT: Return ONLY a valid raw JSON array. No markdown, no code fences, no explanation, no preamble, no trailing text.
3. EACH OBJECT must have exactly these fields (use null if not present):
   - "date": YYYY-MM-DD (transaction/posting date)
   - "value_date": YYYY-MM-DD or null
   - "description": full untruncated narration
   - "remarks": secondary narration or null
   - "amount": positive number always
   - "currency": "INR" default
   - "balance": running balance or null
   - "type": "debit" or "credit"
   - "mode": "UPI"|"NEFT"|"IMPS"|"RTGS"|"ATM"|"POS"|"CHEQUE"|"DD"|"NACH"|"ECS"|"SWIFT"|"CASH"|"WALLET"|"EMI"|"SI" or null
   - "transaction_id": UTR/RRN/system ID or null
   - "reference_number": cheque/DD number or null
   - "counterparty": sender/receiver name or null
   - "counterparty_account": account number or null
   - "counterparty_bank": bank name or null
   - "upi_id": UPI ID like name@bank or null
   - "location": ATM/POS location or null
4. TYPE DETECTION: Dr/Cr columns > keywords (debit/credit/withdrawal/deposit etc.) > balance direction
5. DATE: handle DD/MM/YYYY, DD-Mon-YYYY, DD Mon YYYY → always YYYY-MM-DD
6. COUNTERPARTY: "UPI-JOHN DOE-john@upi-HDFC" → counterparty:"JOHN DOE", upi_id:"john@upi", counterparty_bank:"HDFC"
7. Skip: headers, footers, opening/closing balance rows, column labels.
8. VALIDATION: count rows in input, verify output array matches.`;

type RawTx = {
  date: string; value_date?: string | null; description: string; remarks?: string | null;
  amount: number; currency: string; balance: number | null; type: 'debit' | 'credit';
  mode?: string | null; transaction_id?: string | null; reference_number?: string | null;
  counterparty?: string | null; counterparty_account?: string | null; counterparty_bank?: string | null;
  upi_id?: string | null; location?: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const documentId = params.id;
  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = (data: object) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch { /* stream closed */ }
  };

  // Run extraction async, stream events as they happen
  (async () => {
    try {
      const docs = await sql`SELECT * FROM documents WHERE id = ${documentId} AND user_id = ${userId}`;
      if (docs.length === 0) { send({ type: 'error', message: 'Document not found' }); return; }
      const doc = docs[0];

      if (doc.status === 'extracting') {
        send({ type: 'error', message: 'Extraction already in progress' }); return;
      }

      await sql`UPDATE documents SET status = 'extracting', extracted_at = null WHERE id = ${documentId}`;
      send({ type: 'log', message: '🔐 Decrypting document password...' });

      let pdfPassword: string | undefined;
      if (doc.password_hint) {
        try {
          pdfPassword = decrypt(doc.password_hint);
          send({ type: 'log', message: '✓ Password decrypted successfully' });
        } catch (e) {
          await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
          send({ type: 'error', message: `Password decryption failed: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
      } else {
        send({ type: 'log', message: '✓ No password required' });
      }

      send({ type: 'log', message: `📥 Downloading PDF from storage...` });
      const pdfResponse = await fetch(doc.blob_url);
      if (!pdfResponse.ok) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: `Failed to download PDF: ${pdfResponse.status} ${pdfResponse.statusText}` });
        return;
      }
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      send({ type: 'log', message: `✓ PDF downloaded (${(pdfBuffer.length / 1024).toFixed(0)} KB)` });

      send({ type: 'log', message: '📄 Parsing PDF text...' });
      let extractedText: string;
      try {
        extractedText = await extractTextFromPDF(pdfBuffer, pdfPassword);
      } catch (e) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: 'error', message: `PDF parsing failed: ${msg.toLowerCase().includes('password') ? msg + ' — check PDF password' : msg}` });
        return;
      }

      if (!extractedText || extractedText.trim().length < 10) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: 'PDF is empty or image-based (scanned). Only text-based PDFs are supported.' });
        return;
      }

      const charCount = extractedText.trim().length;
      send({ type: 'log', message: `✓ Extracted ${charCount.toLocaleString()} characters of text` });

      const CHUNK_SIZE = 40000;
      const chunks: string[] = [];
      for (let i = 0; i < extractedText.length; i += CHUNK_SIZE) {
        chunks.push(extractedText.slice(i, i + CHUNK_SIZE));
      }
      send({ type: 'log', message: `📊 Split into ${chunks.length} chunk${chunks.length > 1 ? 's' : ''} for LLM processing` });

      const provider = doc.llm_provider || 'openai';
      const modelName = doc.llm_model || 'gpt-4o';
      const model = getLLMModel(provider, modelName);
      const allTransactions: RawTx[] = [];

      for (let i = 0; i < chunks.length; i++) {
        send({ type: 'log', message: `🤖 Calling ${provider}/${modelName} — chunk ${i + 1} of ${chunks.length} (~${Math.round(chunks[i].length / 4)} tokens)...` });

        let text = '';
        try {
          const result = await generateText({
            model,
            temperature: 0,
            maxTokens: 16000,
            abortSignal,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `Extract all transactions from this bank statement text${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}. Return ONLY a raw JSON array.\n\n${chunks[i]}` },
            ],
          });
          text = result.text;
        } catch (e) {
          send({ type: 'log', message: `⚠️  Chunk ${i + 1} LLM error: ${e instanceof Error ? e.message : String(e)}` });
          continue;
        }

        try {
          const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed: RawTx[] = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            allTransactions.push(...parsed);
            send({ type: 'log', message: `✓ Chunk ${i + 1}: extracted ${parsed.length} transactions (running total: ${allTransactions.length})` });
          }
        } catch {
          send({ type: 'log', message: `⚠️  Chunk ${i + 1}: could not parse LLM response (preview: ${text.substring(0, 80).replace(/\n/g, ' ')}...)` });
        }
      }

      if (allTransactions.length === 0) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        send({ type: 'error', message: 'No transactions could be extracted from this document.' });
        return;
      }

      send({ type: 'log', message: `💾 Saving ${allTransactions.length} transactions to database...` });

      let inserted = 0;
      let skipped = 0;

      for (const tx of allTransactions) {
        if (!tx.date || !tx.description || tx.amount === undefined || !tx.type) continue;
        const fingerprint = computeFingerprint(userId, tx.date, tx.description, tx.amount, tx.type);
        const flagged = shouldFlag(tx.description);
        try {
          const result = await sql`
            INSERT INTO transactions (
              user_id, document_id, date, value_date, description, remarks,
              amount, currency, balance, type, mode,
              transaction_id, reference_number,
              counterparty, counterparty_account, counterparty_bank,
              upi_id, location, fingerprint, flagged, flag_reason
            ) VALUES (
              ${userId}, ${documentId}, ${tx.date}, ${tx.value_date || null},
              ${tx.description}, ${tx.remarks || null}, ${tx.amount},
              ${tx.currency || 'INR'}, ${tx.balance ?? null}, ${tx.type},
              ${tx.mode || null}, ${tx.transaction_id || null}, ${tx.reference_number || null},
              ${tx.counterparty || null}, ${tx.counterparty_account || null},
              ${tx.counterparty_bank || null}, ${tx.upi_id || null}, ${tx.location || null},
              ${fingerprint}, ${flagged}, ${flagged ? 'Auto-flagged: suspicious keyword' : null}
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

      send({ type: 'done', inserted, skipped, total: allTransactions.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const aborted = abortSignal.aborted || msg.toLowerCase().includes('abort');
      console.error('Extraction error:', msg);
      try {
        await sql`UPDATE documents SET status = ${aborted ? 'uploaded' : 'failed'} WHERE id = ${documentId}`;
      } catch { /* ignore */ }
      send({ type: aborted ? 'aborted' : 'error', message: aborted ? 'Extraction was terminated.' : msg });
    } finally {
      try { writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
