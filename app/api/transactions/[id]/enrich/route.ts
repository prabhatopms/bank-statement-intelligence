import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateText } from 'ai';
import sql from '@/lib/db';
import { getLLMModel } from '@/lib/llm';

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

      const model = getLLMModel('anthropic', 'claude-haiku-4-5-20251001');
      const { text } = await generateText({
        model,
        prompt: `Based on merchant name "${merchant}", categorize this transaction.
Return a JSON object: { "category": "one of: ${CATEGORIES.join(', ')}" }
Return ONLY raw JSON, no markdown.`,
      });

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
      const model = getLLMModel('anthropic', 'claude-haiku-4-5-20251001');
      const { text } = await generateText({
        model,
        prompt: `Analyze this bank transaction and extract merchant information.
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
Return ONLY raw JSON, no markdown, no explanation.`,
      });

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
