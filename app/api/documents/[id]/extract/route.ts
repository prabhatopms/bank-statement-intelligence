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
  request: NextRequest,
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
      pdfPassword = decrypt(doc.password_hint);
    }

    const pdfResponse = await fetch(doc.blob_url);
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    const extractedText = await extractTextFromPDF(pdfBuffer, pdfPassword);

    const model = getLLMModel(doc.llm_provider || 'anthropic', doc.llm_model || 'claude-sonnet-4-20250514');

    const { text } = await generateText({
      model,
      prompt: `Extract all transactions from the following bank statement text as a JSON array.
Each item must have these fields: { "date": "YYYY-MM-DD", "description": "string", "amount": number, "currency": "string", "balance": number, "type": "debit" | "credit" }
Return ONLY a raw JSON array. No markdown. No explanation. No code blocks.
Bank statement text:
${extractedText.substring(0, 50000)}`,
    });

    let transactions: Array<{
      date: string;
      description: string;
      amount: number;
      currency: string;
      balance: number;
      type: 'debit' | 'credit';
    }>;

    try {
      const cleanedText = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      transactions = JSON.parse(cleanedText);
    } catch {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${documentId}`;
      return NextResponse.json({ error: 'Failed to parse LLM response', raw: text }, { status: 422 });
    }

    let inserted = 0;
    let skipped = 0;

    for (const tx of transactions) {
      if (!tx.date || !tx.description || tx.amount === undefined || !tx.type) continue;

      const fingerprint = computeFingerprint(userId, tx.date, tx.description, tx.amount, tx.type);
      const flagged = shouldFlag(tx.description);

      try {
        const result = await sql`
          INSERT INTO transactions (user_id, document_id, date, description, amount, currency, balance, type, fingerprint, flagged, flag_reason)
          VALUES (
            ${userId},
            ${documentId},
            ${tx.date},
            ${tx.description},
            ${tx.amount},
            ${tx.currency || 'INR'},
            ${tx.balance || null},
            ${tx.type},
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
