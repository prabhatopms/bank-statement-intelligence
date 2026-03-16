import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transactions = await sql`
      SELECT
        t.date,
        t.description,
        t.merchant,
        t.amount,
        t.currency,
        t.balance,
        t.type,
        t.category,
        t.flagged,
        t.flag_reason,
        t.enriched,
        t.enrich_source,
        t.website,
        d.filename as document_filename,
        t.imported_at
      FROM transactions t
      LEFT JOIN documents d ON t.document_id = d.id
      WHERE t.user_id = ${userId}
      ORDER BY t.date DESC
    `;

    const headers = ['Date', 'Description', 'Merchant', 'Amount', 'Currency', 'Balance', 'Type', 'Category', 'Flagged', 'Flag Reason', 'Enriched', 'Enrich Source', 'Website', 'Document', 'Imported At'];

    const rows = transactions.map((t: Record<string, unknown>) => [
      t.date,
      `"${String(t.description || '').replace(/"/g, '""')}"`,
      `"${String(t.merchant || '').replace(/"/g, '""')}"`,
      t.amount,
      t.currency,
      t.balance,
      t.type,
      t.category,
      t.flagged,
      `"${String(t.flag_reason || '').replace(/"/g, '""')}"`,
      t.enriched,
      t.enrich_source,
      t.website,
      `"${String(t.document_filename || '').replace(/"/g, '""')}"`,
      t.imported_at,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="transactions-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
