import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';
import { decrypt } from '@/lib/encrypt';
import { extractTableRows } from '@/lib/table-extract';
import { detectHeader, parseTransactions } from '@/lib/table-parse';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const docs = await sql`SELECT * FROM documents WHERE id = ${params.id} AND user_id = ${userId}`;
  if (docs.length === 0) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const doc = docs[0];

  let pdfPassword: string | undefined;
  if (doc.password_hint) {
    try { pdfPassword = decrypt(doc.password_hint); } catch { /**/ }
  }

  const pdfResponse = await fetch(doc.blob_url);
  if (!pdfResponse.ok) return NextResponse.json({ error: 'Failed to download PDF' }, { status: 500 });
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  let rows;
  try {
    rows = await extractTableRows(pdfBuffer, pdfPassword);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }

  const headerResult = detectHeader(rows);

  // Return raw rows (first 200 for preview) + header detection result
  return NextResponse.json({
    totalRows: rows.length,
    headerIndex: headerResult?.headerIndex ?? null,
    columnMap: headerResult?.map ?? null,
    // Slice around detected header: a few rows above + first 60 data rows
    rows: rows.slice(
      Math.max(0, (headerResult?.headerIndex ?? 0) - 2),
      (headerResult?.headerIndex ?? 0) + 62
    ).map(r => r.cells),
    // Also provide parsed transactions preview (first 20)
    transactions: headerResult
      ? parseTransactions(rows, headerResult.headerIndex, headerResult.map).slice(0, 20)
      : [],
  });
}
