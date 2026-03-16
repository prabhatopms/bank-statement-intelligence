import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import sql from '@/lib/db';
import { encrypt } from '@/lib/encrypt';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;
    const llmProvider = formData.get('llmProvider') as string;
    const llmModel = formData.get('llmModel') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
    }

    const filename = `${userId}/${Date.now()}-${file.name}`;
    const blob = await put(filename, file, { access: 'public' });

    const encryptedPassword = password ? encrypt(password) : null;

    const result = await sql`
      INSERT INTO documents (user_id, filename, blob_url, password_hint, llm_provider, llm_model)
      VALUES (${userId}, ${file.name}, ${blob.url}, ${encryptedPassword}, ${llmProvider || 'openai'}, ${llmModel || 'gpt-4o'})
      RETURNING *
    `;

    return NextResponse.json({ document: result[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
