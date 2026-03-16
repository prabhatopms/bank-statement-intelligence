import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);

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

    const params: unknown[] = [userId];
    const conditions: string[] = ['t.user_id = $1'];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.description ILIKE $${params.length} OR t.merchant ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      conditions.push(`t.category = $${params.length}`);
    }
    if (flagged === 'true') conditions.push('t.flagged = true');
    if (flagged === 'false') conditions.push('t.flagged = false');
    if (enriched === 'true') conditions.push('t.enriched = true');
    if (enriched === 'false') conditions.push('t.enriched = false');
    if (documentId) {
      params.push(documentId);
      conditions.push(`t.document_id = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`t.date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`t.date <= $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const [transactions, countResult, statsResult] = await Promise.all([
      sql(
        `SELECT t.*, d.filename as document_filename
         FROM transactions t
         LEFT JOIN documents d ON t.document_id = d.id
         WHERE ${whereClause}
         ORDER BY t.date DESC, t.imported_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      sql(`SELECT COUNT(*) as count FROM transactions t WHERE ${whereClause}`, params),
      sql(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_debits,
          SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_credits,
          SUM(CASE WHEN flagged = true THEN 1 ELSE 0 END) as flagged_count,
          SUM(CASE WHEN enriched = true THEN 1 ELSE 0 END) as enriched_count
         FROM transactions t
         WHERE t.user_id = $1`,
        [userId]
      ),
    ]);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total: parseInt((countResult[0] as { count: string }).count),
        pages: Math.ceil(parseInt((countResult[0] as { count: string }).count) / limit),
      },
      stats: statsResult[0],
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
