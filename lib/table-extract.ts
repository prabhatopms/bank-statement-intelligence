import pdfParse from 'pdf-parse';

export interface TextItem {
  x: number;
  y: number;
  text: string;
  width: number;
  pageNum: number;
}

export interface TableRow {
  cells: string[];
  rawItems: { x: number; text: string }[];
  y: number;
  pageNum: number;
}

// Extract all text items with X/Y coordinates via pdfjs getTextContent
export async function extractTextItems(buffer: Buffer, password?: string): Promise<TextItem[]> {
  const allItems: TextItem[] = [];
  let pageNum = 0;

  await pdfParse(buffer, {
    ...(password ? { password } : {}),
    // pagerender receives PDFPageProxy from pdfjs — gives full coordinate access
    pagerender: async (pageData: any) => {
      pageNum++;
      const currentPage = pageNum;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true,
      });
      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) continue;
        allItems.push({
          x: item.transform[4],      // X from left
          y: item.transform[5],      // Y from bottom-left (PDF coords)
          text: item.str.trim(),
          width: item.width || 0,
          pageNum: currentPage,
        });
      }
      return '';
    },
  });

  return allItems;
}

// Group text items into rows by Y proximity, sorted by X within each row
export function itemsToRows(items: TextItem[], yTolerance = 3): TableRow[] {
  if (items.length === 0) return [];

  // Sort: page asc, Y desc (top of page = higher Y in PDF coords), X asc
  const sorted = [...items].sort((a, b) =>
    a.pageNum !== b.pageNum ? a.pageNum - b.pageNum
      : Math.abs(b.y - a.y) > yTolerance ? b.y - a.y
      : a.x - b.x
  );

  const rows: TableRow[] = [];
  let bucket: TextItem[] = [sorted[0]];
  let bucketY = sorted[0].y;
  let bucketPage = sorted[0].pageNum;

  const flushBucket = () => {
    if (bucket.length === 0) return;
    const byX = [...bucket].sort((a, b) => a.x - b.x);
    rows.push({
      cells: byX.map(i => i.text),
      rawItems: byX.map(i => ({ x: i.x, text: i.text })),
      y: bucketY,
      pageNum: bucketPage,
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const samePage = item.pageNum === bucketPage;
    const sameRow = samePage && Math.abs(item.y - bucketY) <= yTolerance;
    if (sameRow) {
      bucket.push(item);
    } else {
      flushBucket();
      bucket = [item];
      bucketY = item.y;
      bucketPage = item.pageNum;
    }
  }
  flushBucket();

  return rows;
}

export async function extractTableRows(buffer: Buffer, password?: string): Promise<TableRow[]> {
  const items = await extractTextItems(buffer, password);
  return itemsToRows(items);
}
