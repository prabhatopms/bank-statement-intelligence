import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { extractTableRows } from '@/lib/table-extract';
import { detectHeader, parseTransactions } from '@/lib/table-parse';
import { computeFingerprint } from '@/lib/fingerprint';
import pdfParse from 'pdf-parse';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const FLAG_KEYWORDS = ['refund', 'failed', 'reversal', 'chargeback', 'dispute', 'unknown', 'error', 'hold'];
function shouldFlag(d: string) { return FLAG_KEYWORDS.some(kw => d.toLowerCase().includes(kw)); }

const EXTRACTION_SYSTEM_PROMPT = `You are a highly accurate bank statement parser. Extract EVERY transaction with zero omissions.

OUTPUT: Return ONLY a valid raw JSON array. No markdown, no code fences, no explanation.

EACH OBJECT must have exactly:
- "date": "YYYY-MM-DD" — infer year from context if missing
- "description": full narration as-is, untruncated
- "amount": positive number, always positive
- "currency": "INR" (default) or as stated
- "balance": running balance after transaction, or null
- "type": "debit" or "credit" only

TYPE DETECTION (apply in order):
1. Separate Dr/Cr columns → use whichever has a value
2. Keywords → debit: withdrawal, payment, purchase, paid, ATM, NEFT DR, IMPS DR, UPI DR, EMI, charges, fee
             → credit: deposit, received, salary, refund, reversal, cashback, interest, NEFT CR, IMPS CR, UPI CR
3. Balance direction → decreased = debit, increased = credit

DATE FORMATS: Handle DD/MM/YYYY, DD-Mon-YYYY (14-Mar-2026), DD Mon YYYY, YYYY-MM-DD. Always output YYYY-MM-DD.

AMOUNT: Remove commas, ₹, $. Bracketed (1,234.56) = positive number.

SKIP: headers, footers, page numbers, opening/closing balance summary rows, blank lines.

COMPLETENESS: If statement has 200 rows, return 200 objects. Do not merge, skip, or truncate.`;

type RawTx = { date: string; description: string; amount: number; currency?: string; balance?: number | null; type: 'debit' | 'credit' };

async function saveTransactions(
  userId: string, documentId: string,
  transactions: RawTx[],
  send: (d: object) => void
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0, skipped = 0;
  send({ type: 'log', message: `💾 Saving ${transactions.length} transactions to database...` });
  for (const tx of transactions) {
    if (!tx.date || !tx.description || tx.amount === undefined || !tx.type) { skipped++; continue; }
    const fp = computeFingerprint(userId, tx.date, tx.description, tx.amount, tx.type);
    const flagged = shouldFlag(tx.description);
    try {
      const r = await sql`
        INSERT INTO transactions (user_id, document_id, date, description, amount, currency, balance, type, fingerprint, flagged, flag_reason)
        VALUES (${userId}, ${documentId}, ${tx.date}, ${tx.description}, ${tx.amount}, ${tx.currency || 'INR'}, ${tx.balance ?? null}, ${tx.type}, ${fp}, ${flagged}, ${flagged ? 'Auto-flagged: suspicious keyword' : null})
        ON CONFLICT (user_id, fingerprint) DO NOTHING RETURNING id`;
      r.length > 0 ? inserted++ : skipped++;
    } catch { skipped++; }
  }
  return { inserted, skipped };
}

function cleanJson(text: string): string {
  return text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

// --- Mode: coordinate-based PDF parser (no LLM) ---
async function runAutoMode(pdfBuffer: Buffer, password: string | undefined, _userId: string, _documentId: string, send: (d: object) => void) {
  send({ type: 'log', message: '📊 Extracting table structure from PDF...' });
  const rows = await extractTableRows(pdfBuffer, password);
  send({ type: 'log', message: `✓ Found ${rows.length} rows across all pages` });

  send({ type: 'log', message: '🔍 Detecting column headers...' });
  const headerResult = detectHeader(rows);
  if (!headerResult) {
    const sample = [...rows.slice(0, 5), ...rows.slice(Math.floor(rows.length / 4), Math.floor(rows.length / 4) + 5)]
      .map((r, i) => `Row ${i + 1}: [${r.cells.join(' | ')}]`).join('\n');
    send({ type: 'log', message: `Sample rows:\n${sample}` });
    throw new Error('Could not detect column headers. Try GPT-4o or Gemini mode instead.');
  }

  const { headerIndex, xmap } = headerResult;
  send({ type: 'log', message: `✓ Headers on row ${headerIndex + 1}: ${rows[headerIndex].cells.join(' | ')}` });
  send({ type: 'log', message: `  Columns: ${Object.entries(xmap).map(([k, v]) => `${k}→x${Math.round(v as number)}`).join(', ')}` });

  send({ type: 'log', message: '⚙️  Parsing rows...' });
  const transactions = parseTransactions(rows, headerIndex, xmap);
  send({ type: 'log', message: `✓ Parsed ${transactions.length} transactions` });
  if (transactions.length === 0) throw new Error('No transactions parsed. Try GPT-4o or Gemini mode.');
  return transactions as RawTx[];
}

// --- Mode: GPT-4o (text extraction → LLM) ---
async function runOpenAIMode(pdfBuffer: Buffer, password: string | undefined, _userId: string, _documentId: string, send: (d: object) => void) {
  send({ type: 'log', message: '📄 Extracting text from PDF...' });
  const parsed = await pdfParse(pdfBuffer, password ? { password } as object : undefined);
  const text = parsed.text;
  send({ type: 'log', message: `✓ Extracted ${text.length.toLocaleString()} characters` });

  const CHUNK = 80000;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  send({ type: 'log', message: `📦 Processing ${chunks.length} chunk(s) with GPT-4o...` });

  const all: RawTx[] = [];
  for (let i = 0; i < chunks.length; i++) {
    send({ type: 'log', message: `🤖 GPT-4o — chunk ${i + 1}/${chunks.length}...` });
    let fullText = '';
    const { fullStream } = streamText({
      model: openai('gpt-4o'),
      temperature: 0,
      maxTokens: 16000,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Extract all transactions from this bank statement${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ''}. Return ONLY raw JSON array.\n\n${chunks[i]}` },
      ],
    });
    for await (const chunk of fullStream) {
      if (chunk.type === 'text-delta') fullText += chunk.textDelta;
    }
    try {
      const parsed = JSON.parse(cleanJson(fullText));
      if (Array.isArray(parsed)) { all.push(...parsed); send({ type: 'log', message: `  ✓ Chunk ${i + 1}: ${parsed.length} transactions` }); }
    } catch { send({ type: 'log', message: `  ⚠ Chunk ${i + 1} parse failed, skipping` }); }
  }
  if (all.length === 0) throw new Error('GPT-4o returned no transactions.');
  return all;
}

// --- Mode: Gemini 2.5 Flash (native PDF, best accuracy) ---
async function runGeminiMode(pdfBuffer: Buffer, _userId: string, _documentId: string, send: (d: object) => void) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set.');

  const BASE = 'https://generativelanguage.googleapis.com';

  // Hardcoded fallback order — newest stable first
  const FALLBACK_MODELS = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash-8b',
  ];

  // Step 1: discover which models are actually available for this API key
  send({ type: 'log', message: '🔍 Discovering available Gemini models...' });
  let availableModel: string | null = null;

  try {
    const listRes = await fetch(`${BASE}/v1beta/models?key=${apiKey}&pageSize=50`);
    if (!listRes.ok) {
      const errBody = await listRes.json().catch(() => ({}));
      send({ type: 'log', message: `  ⚠ ListModels HTTP ${listRes.status}: ${(errBody as { error?: { message?: string } })?.error?.message ?? listRes.statusText}` });
    } else {
      const listData = await listRes.json();
      const models: { name: string; supportedGenerationMethods?: string[] }[] = listData.models ?? [];

      const PREFERRED = ['flash', 'pro'];
      const candidates = models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
        .filter(id => !id.includes('embedding') && !id.includes('aqa'));

      send({ type: 'log', message: `  Found ${candidates.length} models with generateContent support` });
      if (candidates.length > 0) send({ type: 'log', message: `  Available: ${candidates.slice(0, 8).join(', ')}${candidates.length > 8 ? '...' : ''}` });

      for (const tier of ['2.5', '2.0', '1.5']) {
        for (const type of PREFERRED) {
          const match = candidates.find(id => id.includes(tier) && id.includes(type));
          if (match) { availableModel = match; break; }
        }
        if (availableModel) break;
      }
      if (!availableModel && candidates.length > 0) availableModel = candidates[0];
    }
  } catch (e) {
    send({ type: 'log', message: `  ⚠ ListModels failed: ${e instanceof Error ? e.message : e}` });
  }

  // Fall back to hardcoded list if discovery failed or returned nothing
  if (!availableModel) {
    send({ type: 'log', message: `  ℹ Discovery returned nothing — trying hardcoded fallback list` });
    availableModel = FALLBACK_MODELS[0];
  }
  send({ type: 'log', message: `🔮 Using model: ${availableModel}` });

  // Step 2: call generateContent — try selected model, then fallbacks
  const base64 = pdfBuffer.toString('base64');
  const prompt = `${EXTRACTION_SYSTEM_PROMPT}\n\nExtract ALL transactions from this bank statement PDF. Return ONLY a raw JSON array.`;

  const modelsToTry = [availableModel, ...FALLBACK_MODELS.filter(m => m !== availableModel)];

  for (const modelId of modelsToTry) {
    send({ type: 'log', message: `🔮 Trying model: ${modelId}` });
    const res = await fetch(`${BASE}/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64 } },
          { text: prompt },
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 65536 },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText;
      send({ type: 'log', message: `  ✗ ${modelId} failed (${res.status}): ${msg}` });
      continue;
    }

    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason: string = data?.candidates?.[0]?.finishReason ?? '';

    if (!text) {
      send({ type: 'log', message: `  ✗ ${modelId} returned empty (finishReason: ${finishReason || 'unknown'})` });
      continue;
    }

    send({ type: 'log', message: `✓ ${modelId} responded (${text.length.toLocaleString()} chars)` });
    const parsed = JSON.parse(cleanJson(text));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Gemini returned no transactions.');
    send({ type: 'log', message: `✓ ${parsed.length} transactions extracted` });
    return parsed as RawTx[];
  }

  throw new Error(`All Gemini models failed. Check your GOOGLE_GENERATIVE_AI_API_KEY and API quota.`);
}

// --- Mode: Claude (native PDF) ---
async function runClaudeMode(pdfBuffer: Buffer, _userId: string, _documentId: string, send: (d: object) => void) {
  send({ type: 'log', message: '🧠 Sending PDF to Claude (native PDF mode)...' });
  const base64 = pdfBuffer.toString('base64');
  let fullText = '';
  const { fullStream } = streamText({
    model: anthropic('claude-sonnet-4-5'),
    temperature: 0,
    maxTokens: 16000,
    messages: [{
      role: 'user',
      content: [
        { type: 'file', data: base64, mimeType: 'application/pdf' } as { type: 'file'; data: string; mimeType: string },
        { type: 'text', text: `${EXTRACTION_SYSTEM_PROMPT}\n\nExtract ALL transactions from this bank statement PDF. Return ONLY a raw JSON array.` },
      ],
    }],
  });
  for await (const chunk of fullStream) {
    if (chunk.type === 'text-delta') fullText += chunk.textDelta;
  }
  send({ type: 'log', message: `✓ Claude response: ${fullText.length.toLocaleString()} chars` });
  const parsed = JSON.parse(cleanJson(fullText));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Claude returned no transactions.');
  send({ type: 'log', message: `✓ Parsed ${parsed.length} transactions from Claude` });
  return parsed as RawTx[];
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const documentId = params.id;
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'auto'; // auto | openai | gemini | claude

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const send = (data: object) => { try { writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /**/ } };

  (async () => {
    try {
      const docs = await sql`SELECT * FROM documents WHERE id = ${documentId} AND user_id = ${userId}`;
      if (docs.length === 0) { send({ type: 'error', message: 'Document not found' }); return; }
      const doc = docs[0];
      if (doc.status === 'extracting') { send({ type: 'error', message: 'Extraction already in progress' }); return; }

      await sql`UPDATE documents SET status = 'extracting', extracted_at = null WHERE id = ${documentId}`;

      let pdfPassword: string | undefined;
      if (doc.password_hint) {
        try { pdfPassword = decrypt(doc.password_hint); send({ type: 'log', message: '🔐 Password decrypted' }); }
        catch (e) { throw new Error(`Password decryption failed: ${e instanceof Error ? e.message : e}`); }
      }

      send({ type: 'log', message: `📥 Downloading PDF... [mode: ${mode}]` });
      const pdfResponse = await fetch(doc.blob_url);
      if (!pdfResponse.ok) throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      send({ type: 'log', message: `✓ PDF downloaded (${(pdfBuffer.length / 1024).toFixed(0)} KB)` });

      let transactions: RawTx[];
      if (mode === 'openai')      transactions = await runOpenAIMode(pdfBuffer, pdfPassword, userId, documentId, send);
      else if (mode === 'gemini') transactions = await runGeminiMode(pdfBuffer, userId, documentId, send);
      else if (mode === 'claude') transactions = await runClaudeMode(pdfBuffer, userId, documentId, send);
      else                        transactions = await runAutoMode(pdfBuffer, pdfPassword, userId, documentId, send);

      const { inserted, skipped } = await saveTransactions(userId, documentId, transactions, send);
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
