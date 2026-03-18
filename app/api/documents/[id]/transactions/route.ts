import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import sql from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify document belongs to user
  const docs = await sql`SELECT id FROM documents WHERE id = ${params.id} AND user_id = ${userId}`;
  if (docs.length === 0) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const result = await sql`
    DELETE FROM transactions
    WHERE document_id = ${params.id} AND user_id = ${userId}
    RETURNING id
  `;

  // Reset document status back to 'uploaded'
  await sql`
    UPDATE documents
    SET status = 'uploaded', extracted_at = null
    WHERE id = ${params.id} AND user_id = ${userId}
  `;

  return NextResponse.json({ deleted: result.length });
}
