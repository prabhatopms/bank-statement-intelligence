import pdfParse from 'pdf-parse';

export async function extractTextFromPDF(
  buffer: Buffer,
  password?: string
): Promise<string> {
  const options: Record<string, unknown> = {};
  if (password) {
    options.password = password;
  }

  const data = await pdfParse(buffer, options);
  return data.text;
}
