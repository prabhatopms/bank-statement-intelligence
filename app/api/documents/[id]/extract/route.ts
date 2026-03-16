import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { waitUntil } from '@vercel/functions';
import { generateText } from 'ai';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { getLLMModel } from '@/lib/llm';
import { extractTextFromPDF } from '@/lib/pdf';
import { computeFingerprint } from '@/lib/fingerprint';

export const maxDuration = 300;

const FLAG_KEYWORDS = ['refund', 'failed', 'reversal', 'chargeback', 'dispute', 'unknown', 'error', 'hold'];

function shouldFlag(description: string): boolean {
  return FLAG_KEYWORDS.some(kw => description.toLowerCase().includes(kw));
}

const SYSTEM_PROMPT = `You are a highly accurate bank statement parser. Your sole job is to extract EVERY transaction from bank statement text with zero omissions.

RULES — follow all of them exactly:

1. COMPLETENESS: Extract EVERY single transaction line. Do not skip, merge, summarise, or truncate any entries. If a statement has 500 rows, return 500 objects.

2. OUTPUT FORMAT: Return ONLY a valid raw JSON array. No markdown, no code fences, no explanation, no preamble, no trailing text.

3. EACH OBJECT must have exactly these fields (use null for any field not present):
   - "date": string YYYY-MM-DD — transaction/posting date.
   - "value_date": string YYYY-MM-DD or null — value date if shown separately.
   - "description": string — full, untruncated narration as it appears in the statement.
   - "remarks": string or null — any secondary narration, note, or additional detail line.
   - "amount": positive number — always positive regardless of debit/credit.
   - "currency": string — e.g. "INR", "USD". Default to "INR" if not stated.
   - "balance": number or null — closing/running balance after this transaction.
   - "type": "debit" or "credit" only.
   - "mode": string or null — payment mode. Detect from narration: "UPI", "NEFT", "IMPS", "RTGS", "ATM", "POS", "CHEQUE", "DD", "NACH", "ECS", "SWIFT", "CASH", "WALLET", "EMI", "SI". null if unclear.
   - "transaction_id": string or null — bank's UTR number, RRN, or system-generated ID found in narration.
   - "reference_number": string or null — cheque number, DD number, or other instrument reference.
   - "counterparty": string or null — name of sender (for credits) or receiver (for debits) if mentioned.
   - "counterparty_account": string or null — account number of the other party if mentioned.
   - "counterparty_bank": string or null — bank name of the other party if mentioned.
   - "upi_id": string or null — UPI ID (e.g. name@bank) found in narration.
   - "location": string or null — ATM location, POS merchant location, or city if mentioned.

4. TYPE DETECTION (apply in order):
   - Separate Dr/Cr columns → use whichever has the value.
   - DEBIT keywords: withdrawal, debit, payment, purchase, transfer out, paid, POS, ATM WDL, NEFT DR, IMPS DR, UPI DR, EMI, bill pay, charges, fee, tax, debit card.
   - CREDIT keywords: deposit, credit, received, salary, refund, reversal, cashback, interest credit, NEFT CR, IMPS CR, UPI CR, dividend, inward.
   - Balance decreases → debit. Balance increases → credit.

5. DATE PARSING: Handle all formats — DD/MM/YYYY, MM/DD/YYYY, DD-Mon-YYYY, DD Mon YYYY, YYYY-MM-DD. Always output YYYY-MM-DD.

6. AMOUNT PARSING: Remove commas, currency symbols (₹, $, £, €). Bracketed amounts like (1,234.56) are positive numbers.

7. COUNTERPARTY EXTRACTION examples:
   - "UPI-JOHN DOE-john@upi-HDFC" → counterparty: "JOHN DOE", upi_id: "john@upi", counterparty_bank: "HDFC"
   - "NEFT CR-AXIS BANK-JANE SMITH-UTR12345" → counterparty: "JANE SMITH", counterparty_bank: "AXIS BANK", transaction_id: "UTR12345"
   - "ATM WDL SBI ATM MUMBAI" → mode: "ATM", location: "MUMBAI"

8. Skip: headers, footers, page numbers, account summaries, opening/closing balance rows, blank lines, column labels.

9. VALIDATION: Count transaction rows in input and verify your array has the same count. If in doubt, include the row.`;

type RawTransaction = {
  date: string;
  value_date?: string | null;
  description: string;
  remarks?: string | null;
  amount: number;
  currency: string;
  balance: number | null;
  type: 'debit' | 'credit';
  mode?: string | null;
  transaction_id?: string | null;
  reference_number?: string | null;
  counterparty?: string | null;
  counterparty_account?: string | null;
  counterparty_bank?: string | null;
  upi_id?: string | null;
  location?: string | null;
};

async function runExtraction(documentId: string, userId: string) {
  try {
    const docs = await sql`SELECT * FROM documents WHERE id = ${documentId} AND user_id = ${userId}`;
    if (docs.length === 0) return;
    const doc = docs[0];

    // Decrypt password
    let pdfPassword: string | undefined;
    if (doc.password_hint) {
      try {
        pdfPassword = decrypt(doc.password_hint);
      } catch (e) {
        await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
        console.error('Password decrypt failed:', e);
        return;
      }
    }

    // Download PDF
    const pdfResponse = await fetch(doc.blob_url);
    if (!pdfResponse.ok) {
      await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
      console.error('PDF download failed:', pdfResponse.status);
      return;
    }
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    // Parse PDF text
    let extractedText: string;
    try {
      extractedText = await extractTextFromPDF(pdfBuffer, pdfPassword);
    } catch (e) {
      await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
      console.error('PDF parse failed:', e);
      return;
    }

    if (!extractedText || extractedText.trim().length < 10) {
      await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
      console.error('PDF empty or image-based');
      return;
    }

    // Chunk and call LLM
    const model = getLLMModel(doc.llm_provider || 'openai', doc.llm_model || 'gpt-4o');
    const CHUNK_SIZE = 40000;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += CHUNK_SIZE) {
      chunks.push(extractedText.slice(i, i + CHUNK_SIZE));
    }

    const allTransactions: RawTransaction[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const { text } = await generateText({
        model,
        temperature: 0,
        maxTokens: 16000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract all transactions from this bank statement text${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}. Return ONLY a raw JSON array.\n\n${chunks[i]}`,
          },
        ],
      });

      try {
        const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed: RawTransaction[] = JSON.parse(cleaned);
        if (Array.isArray(parsed)) allTransactions.push(...parsed);
      } catch {
        console.error(`Chunk ${i + 1} parse failed, raw:`, text.substring(0, 300));
      }
    }

    if (allTransactions.length === 0) {
      await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
      console.error('No transactions extracted');
      return;
    }

    // Insert transactions
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

    await sql`
      UPDATE documents
      SET status = 'extracted', extracted_at = now()
      WHERE id = ${documentId}
    `;

    console.log(`Extraction complete: ${inserted} inserted, ${skipped} skipped`);
  } catch (error) {
    console.error('Extraction failed:', error);
    await sql`UPDATE documents SET status = 'failed', extracted_at = now() WHERE id = ${documentId}`;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const documentId = params.id;

  const docs = await sql`SELECT id, status FROM documents WHERE id = ${documentId} AND user_id = ${userId}`;
  if (docs.length === 0) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  if (docs[0].status === 'extracting') {
    return NextResponse.json({ message: 'Extraction already in progress' }, { status: 202 });
  }

  await sql`UPDATE documents SET status = 'extracting', extracted_at = null WHERE id = ${documentId}`;

  // Fire extraction in background — HTTP response returns immediately
  waitUntil(runExtraction(documentId, userId));

  return NextResponse.json({ message: 'Extraction started', documentId }, { status: 202 });
}
