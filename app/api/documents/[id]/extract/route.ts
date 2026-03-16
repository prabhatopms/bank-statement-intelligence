import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateText } from 'ai';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { getLLMModel } from '@/lib/llm';
import { extractTextFromPDF } from '@/lib/pdf';
import { computeFingerprint } from '@/lib/fingerprint';

const FLAG_KEYWORDS = ['refund', 'failed', 'reversal', 'chargeback', 'dispute', 'unknown', 'error', 'hold'];

function shouldFlag(description: string): boolean {
  const lower = description.toLowerCase();
  return FLAG_KEYWORDS.some(kw => lower.includes(kw));
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const documentId = params.id;

    const docs = await sql`
      SELECT * FROM documents
      WHERE id = ${documentId} AND user_id = ${userId}
    `;

    if (docs.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const doc = docs[0];

    await sql`
      UPDATE documents SET status = 'extracting' WHERE id = ${documentId}
    `;

    let pdfPassword: string | undefined;
    if (doc.password_hint) {
      try {
        pdfPassword = decrypt(doc.password_hint);
      } catch (e) {
        await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
        return NextResponse.json({ error: `Password decryption failed — check ENCRYPTION_KEY env var: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
      }
    }

    const pdfResponse = await fetch(doc.blob_url);
    if (!pdfResponse.ok) {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
      return NextResponse.json({ error: `Failed to download PDF from storage: ${pdfResponse.status} ${pdfResponse.statusText}` }, { status: 500 });
    }
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    let extractedText: string;
    try {
      extractedText = await extractTextFromPDF(pdfBuffer, pdfPassword);
    } catch (e) {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
      const msg = e instanceof Error ? e.message : String(e);
      const hint = msg.toLowerCase().includes('password') ? `${msg} — make sure the correct PDF password was entered during upload` : msg;
      return NextResponse.json({ error: `PDF parsing failed: ${hint}` }, { status: 422 });
    }

    if (!extractedText || extractedText.trim().length < 10) {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
      return NextResponse.json({ error: 'PDF appears to be empty or image-based (scanned). Only text-based PDFs are supported.' }, { status: 422 });
    }

    const model = getLLMModel(doc.llm_provider || 'openai', doc.llm_model || 'gpt-4o');

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
   - "mode": string or null — payment mode. Detect from narration: "UPI", "NEFT", "IMPS", "RTGS", "ATM", "POS", "CHEQUE", "DD", "NACH", "ECS", "SWIFT", "CASH", "WALLET", "EMI", "SI" (standing instruction). null if unclear.
   - "transaction_id": string or null — bank's transaction reference ID, UTR number, RRN, or any system-generated ID found in narration.
   - "reference_number": string or null — cheque number, DD number, or other instrument reference.
   - "counterparty": string or null — name of sender (for credits) or receiver (for debits) if mentioned.
   - "counterparty_account": string or null — account number of the other party if mentioned.
   - "counterparty_bank": string or null — bank name of the other party if mentioned.
   - "upi_id": string or null — UPI ID (e.g. name@bank) found in narration.
   - "location": string or null — ATM location, POS merchant location, city if mentioned.

4. TYPE DETECTION rules (apply in order):
   - If the statement has separate Dr/Cr columns, use whichever column has the value.
   - Keywords implying DEBIT: withdrawal, debit, payment, purchase, transfer out, paid, POS, ATM WDL, NEFT DR, IMPS DR, UPI DR, EMI, bill pay, charges, fee, tax, debit card.
   - Keywords implying CREDIT: deposit, credit, received, salary, refund, reversal, cashback, interest credit, NEFT CR, IMPS CR, UPI CR, dividend, inward.
   - If balance decreases → debit. If balance increases → credit.

5. DATE PARSING: Handle all formats — DD/MM/YYYY, MM/DD/YYYY, DD-Mon-YYYY (e.g. 14-Mar-2026), DD Mon YYYY, YYYY-MM-DD. Always output YYYY-MM-DD.

6. AMOUNT PARSING: Remove commas, currency symbols (₹, $, £, €). Treat bracketed amounts like (1,234.56) as positive numbers.

7. DESCRIPTION: Keep the full narration. Do not shorten. Include reference numbers, UPI IDs, bank codes if present in the narration field.

8. COUNTERPARTY EXTRACTION: Many narrations contain the other party's name. Examples:
   - "UPI-JOHN DOE-john@upi-HDFC" → counterparty: "JOHN DOE", upi_id: "john@upi", counterparty_bank: "HDFC"
   - "NEFT CR-AXIS BANK-JANE SMITH-UTR12345" → counterparty: "JANE SMITH", counterparty_bank: "AXIS BANK", transaction_id: "UTR12345"
   - "ATM WDL SBI ATM MUMBAI" → mode: "ATM", location: "MUMBAI"

9. MULTI-PAGE / CONTINUED STATEMENTS: Process all pages as one continuous list. Opening/closing balance summary rows are NOT transactions — skip them.

10. NON-TRANSACTION LINES to skip: headers, footers, page numbers, account summaries, opening/closing balance rows, blank lines, column labels, statement period lines.

11. VALIDATION: Before returning, mentally count the transaction rows in the input and verify your array has the same count. If in doubt, include the row.`;

    // Chunk large statements to avoid token limits (process in 40k char windows)
    const CHUNK_SIZE = 40000;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += CHUNK_SIZE) {
      chunks.push(extractedText.slice(i, i + CHUNK_SIZE));
    }

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

    const allTransactions: RawTransaction[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { text } = await generateText({
        model,
        temperature: 0,
        maxTokens: 16000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract all transactions from this bank statement text${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}. Return ONLY a raw JSON array.\n\n${chunk}`,
          },
        ],
      });

      try {
        const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed: RawTransaction[] = JSON.parse(cleaned);
        if (Array.isArray(parsed)) allTransactions.push(...parsed);
      } catch {
        // If a chunk fails to parse, log and continue with remaining chunks
        console.error(`Failed to parse chunk ${i + 1}:`, text.substring(0, 200));
      }
    }

    const transactions = allTransactions;

    if (transactions.length === 0) {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
      return NextResponse.json({ error: 'No transactions found in document' }, { status: 422 });
    }

    let inserted = 0;
    let skipped = 0;

    for (const tx of transactions) {
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
            ${userId},
            ${documentId},
            ${tx.date},
            ${tx.value_date || null},
            ${tx.description},
            ${tx.remarks || null},
            ${tx.amount},
            ${tx.currency || 'INR'},
            ${tx.balance ?? null},
            ${tx.type},
            ${tx.mode || null},
            ${tx.transaction_id || null},
            ${tx.reference_number || null},
            ${tx.counterparty || null},
            ${tx.counterparty_account || null},
            ${tx.counterparty_bank || null},
            ${tx.upi_id || null},
            ${tx.location || null},
            ${fingerprint},
            ${flagged},
            ${flagged ? 'Auto-flagged: suspicious keyword' : null}
          )
          ON CONFLICT (user_id, fingerprint) DO NOTHING
          RETURNING id
        `;

        if (result.length > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (e) {
        console.error('Error inserting transaction:', e);
        skipped++;
      }
    }

    await sql`
      UPDATE documents
      SET status = 'extracted', extracted_at = now()
      WHERE id = ${documentId}
    `;

    return NextResponse.json({
      inserted,
      skipped,
      total: transactions.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Extraction error:', message);
    await sql`UPDATE documents SET status = 'failed' WHERE id = ${params.id}`;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
