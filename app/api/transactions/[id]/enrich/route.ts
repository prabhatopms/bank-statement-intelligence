import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';

// Use Gemini REST directly (same key as extraction, no ANTHROPIC_API_KEY needed)
async function geminiText(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set');
  const BASE = 'https://generativelanguage.googleapis.com';
  for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (text) return text;
  }
  throw new Error('Gemini enrichment failed — all models unavailable');
}

const CATEGORIES = [
  'Food & Dining', 'Travel', 'Shopping', 'Utilities', 'Healthcare',
  'Entertainment', 'Finance', 'Income', 'Transfer', 'Other'
];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'ai';
    const txId = params.id;

    const txs = await sql`
      SELECT * FROM transactions
      WHERE id = ${txId} AND user_id = ${userId}
    `;

    if (txs.length === 0) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const tx = txs[0];

    if (mode === 'search') {
      const serpApiKey = process.env.SERPAPI_KEY;
      if (!serpApiKey) {
        return NextResponse.json({ error: 'SERPAPI_KEY not configured' }, { status: 500 });
      }

      const query = encodeURIComponent(tx.description);
      const serpResponse = await fetch(
        `https://serpapi.com/search?q=${query}&api_key=${serpApiKey}&num=3`
      );
      const serpData = await serpResponse.json();

      let merchant = tx.description;
      let website = '';

      if (serpData.organic_results && serpData.organic_results.length > 0) {
        const topResult = serpData.organic_results[0];
        merchant = topResult.title || tx.description;
        website = topResult.link || '';
      }

      const text = await geminiText(`Based on merchant name "${merchant}", categorize this transaction.
Return a JSON object: { "category": "one of: ${CATEGORIES.join(', ')}" }
Return ONLY raw JSON, no markdown.`);

      let category = 'Other';
      try {
        const parsed = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
        category = parsed.category || 'Other';
      } catch {}

      await sql`
        UPDATE transactions
        SET
          enriched = true,
          merchant = ${merchant},
          website = ${website},
          category = ${category},
          enrich_source = 'search',
          enriched_at = now()
        WHERE id = ${txId} AND user_id = ${userId}
      `;

      return NextResponse.json({ success: true, merchant, website, category });
    } else {
      const text = await geminiText(`Analyze this bank transaction and extract merchant information.
Transaction description: "${tx.description}"
Amount: ${tx.amount} ${tx.currency}
Type: ${tx.type}

Return a JSON object with these fields:
{
  "merchant": "merchant/company name",
  "website": "merchant website URL or empty string",
  "category": "one of: ${CATEGORIES.join(', ')}",
  "flagged": boolean (true if suspicious),
  "flagReason": "reason if flagged, else empty string"
}
Return ONLY raw JSON, no markdown, no explanation.`);

      let enrichData = {
        merchant: tx.description,
        website: '',
        category: 'Other',
        flagged: tx.flagged,
        flagReason: tx.flag_reason || '',
      };

      try {
        const parsed = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
        enrichData = { ...enrichData, ...parsed };
      } catch {}

      await sql`
        UPDATE transactions
        SET
          enriched = true,
          merchant = ${enrichData.merchant},
          website = ${enrichData.website},
          category = ${enrichData.category},
          flagged = ${enrichData.flagged},
          flag_reason = ${enrichData.flagReason || null},
          enrich_source = 'ai',
          enriched_at = now()
        WHERE id = ${txId} AND user_id = ${userId}
      `;

      return NextResponse.json({ success: true, ...enrichData });
    }
  } catch (error) {
    console.error('Enrichment error:', error);
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 500 });
  }
}
