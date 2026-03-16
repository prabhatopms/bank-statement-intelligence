import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = 50;
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';
    const flagged = searchParams.get('flagged');
    const enriched = searchParams.get('enriched');
    const documentId = searchParams.get('document_id') || '';
    const dateFrom = searchParams.get('date_from') || '';
    const dateTo = searchParams.get('date_to') || '';

    const conditions: string[] = [`t.user_id = '${userId}'`];
    if (search) conditions.push(`(t.description ILIKE '%${search.replace(/'/g, "''")}%' OR t.merchant ILIKE '%${search.replace(/'/g, "''")}%')`);
    if (category) conditions.push(`t.category = '${category.replace(/'/g, "''")}'`);
    if (flagged === 'true') conditions.push(`t.flagged = true`);
    if (flagged === 'false') conditions.push(`t.flagged = false`);
    if (enriched === 'true') conditions.push(`t.enriched = true`);
    if (enriched === 'false') conditions.push(`t.enriched = false`);
    if (documentId) conditions.push(`t.document_id = '${documentId}'`);
    if (dateFrom) conditions.push(`t.date >= '${dateFrom}'`);
    if (dateTo) conditions.push(`t.date <= '${dateTo}'`);

    const whereClause = conditions.join(' AND ');

    const transactions = await sql.unsafe(`
      SELECT
        t.*,
        d.filename as document_filename
      FROM transactions t
      LEFT JOIN documents d ON t.document_id = d.id
      WHERE ${whereClause}
      ORDER BY t.date DESC, t.imported_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await sql.unsafe(`
      SELECT COUNT(*) as count FROM transactions t WHERE ${whereClause}
    `);

    const statsResult = await sql.unsafe(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_debits,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_credits,
        SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END) as flagged_count,
        SUM(CASE WHEN enriched = true THEN 1 ELSE 0 END) as enriched_count
      FROM transactions t
      WHERE t.user_id = '${userId}'
    `);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total: parseInt(countResult[0].count),
        pages: Math.ceil(parseInt(countResult[0].count) / limit),
      },
      stats: statsResult[0],
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
