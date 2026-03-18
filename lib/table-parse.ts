import type { TableRow } from './table-extract';

export interface ColumnMap {
  date?: number;
  value_date?: number;
  description?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  reference?: number;
  mode?: number;
}

export interface ParsedTransaction {
  date: string;
  value_date: string | null;
  description: string;
  amount: number;
  currency: string;
  balance: number | null;
  type: 'debit' | 'credit';
  reference_number: string | null;
  mode: string | null;
}

// Header keyword patterns covering SBI, ICICI, HDFC, Axis, Kotak, Yes Bank etc.
const PATTERNS: Record<keyof ColumnMap, RegExp> = {
  date:        /^(date|txn\s*date|tran\s*date|trans\.?\s*date|posting\s*date|transaction\s*date|s\.?\s*no\.?)$/i,
  value_date:  /^(value\s*date|val\.?\s*date|effective\s*date)$/i,
  description: /^(description|narration|particulars|remarks|transaction\s*details?|details?|memo|narrative|trans\.?\s*remarks|trans\.?\s*particular|tran\s*description|transaction\s*remarks?)$/i,
  debit:       /^(debit|dr\.?|withdrawal[s]?\s*(\(dr\.?\))?|withdrawal\s*amount|dr\s*amount|debit\s*amount|debit\s*\(dr\.?\)|withdrawl[s]?|debit\s*\(inr\)|dr\s*\(inr\)|paid\s*out|money\s*out)$/i,
  credit:      /^(credit|cr\.?|deposit[s]?\s*(\(cr\.?\))?|deposit\s*amount|cr\s*amount|credit\s*amount|credit\s*\(cr\.?\)|deposit\s*\(inr\)|cr\s*\(inr\)|paid\s*in|money\s*in)$/i,
  balance:     /^(balance\*?|closing\s*balance\*?|running\s*balance\*?|avl\.?\s*bal(?:ance)?\*?|avail(?:able)?\s*bal(?:ance)?\*?|bal\.?\*?|outstanding\s*balance\*?|balance\s*\(inr\))$/i,
  reference:   /^(ref(?:erence)?\.?\s*no\.?|cheque?\s*no\.?|chq\.?\s*\/?\s*ref\s*no\.?|utr|trans(?:action)?\s*id|instrument\s*no\.?|tran\s*id|ref\s*id)$/i,
  mode:        /^(mode|trans(?:action)?\s*type|type|channel|transaction\s*type)$/i,
};

// Detect header row by scanning all rows (headers can appear after many pages of metadata)
export function detectHeader(rows: TableRow[]): { headerIndex: number; map: ColumnMap } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].cells;
    const map: ColumnMap = {};
    let score = 0;

    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j].trim().replace(/[\n\r]+/g, ' ').replace(/\*+$/, '').trim();
      for (const [field, pattern] of Object.entries(PATTERNS) as [keyof ColumnMap, RegExp][]) {
        if (pattern.test(cell)) {
          if (map[field] === undefined) {
            (map as Record<string, number>)[field] = j;
            score++;
          }
        }
      }
    }

    // Need at least: date + one of (debit, credit, balance, description)
    const hasMinFields =
      map.date !== undefined &&
      (map.debit !== undefined || map.credit !== undefined || map.balance !== undefined || map.description !== undefined);

    if (score >= 2 && hasMinFields) {
      return { headerIndex: i, map };
    }
  }
  return null;
}

// Parse date strings into YYYY-MM-DD
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  const MONTHS: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }

  // DD-Mon-YYYY or DD Mon YYYY
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-](\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${mon}-${m[1].padStart(2,'0')}`;
    }
  }

  // YYYY-MM-DD passthrough
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  return null;
}

// Parse amount strings like "1,23,456.78" or "(500.00)" → number
function parseAmount(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().replace(/[₹$£€,\s]/g, '');
  if (!s || s === '-' || s === '.' || s.toLowerCase() === 'nil') return null;
  // Bracketed = negative (but we always return positive)
  const bracketed = s.startsWith('(') && s.endsWith(')');
  const num = parseFloat(bracketed ? s.slice(1, -1) : s);
  return isNaN(num) ? null : Math.abs(num);
}

// Get cell safely
function cell(row: TableRow, idx: number | undefined): string {
  if (idx === undefined || idx >= row.cells.length) return '';
  return row.cells[idx] ?? '';
}

export function parseTransactions(
  rows: TableRow[],
  headerIndex: number,
  map: ColumnMap,
): ParsedTransaction[] {
  const results: ParsedTransaction[] = [];

  // Some statements have Dr/Cr in a single column — handle combined amount column
  const hasSeparateDrCr = map.debit !== undefined && map.credit !== undefined;
  const hasSingleAmount = !hasSeparateDrCr && (map.debit !== undefined || map.credit !== undefined);
  const amountCol = hasSingleAmount ? (map.debit ?? map.credit) : undefined;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.cells.length < 2) continue;

    const rawDate = cell(row, map.date);
    const date = parseDate(rawDate);
    if (!date) continue; // skip non-transaction rows (totals, headers, blanks)

    const rawDesc = cell(row, map.description);
    if (!rawDesc) continue;

    let amount: number | null = null;
    let type: 'debit' | 'credit' = 'debit';

    if (hasSeparateDrCr) {
      const drAmt = parseAmount(cell(row, map.debit));
      const crAmt = parseAmount(cell(row, map.credit));
      if (drAmt) { amount = drAmt; type = 'debit'; }
      else if (crAmt) { amount = crAmt; type = 'credit'; }
    } else if (amountCol !== undefined) {
      // Single amount column — determine type from balance change or keywords
      amount = parseAmount(cell(row, amountCol));
      if (!amount) continue;
      const descLower = rawDesc.toLowerCase();
      const creditKeywords = ['credit','cr','deposit','received','salary','refund','reversal','cashback','interest','dividend','inward','neft cr','imps cr','upi cr'];
      type = creditKeywords.some(k => descLower.includes(k)) ? 'credit' : 'debit';

      // Use balance direction if available
      if (map.balance !== undefined && i > headerIndex + 1) {
        const prevRow = results[results.length - 1];
        const currBal = parseAmount(cell(row, map.balance));
        if (prevRow?.balance && currBal) {
          type = currBal >= prevRow.balance ? 'credit' : 'debit';
        }
      }
    }

    if (!amount) continue;

    results.push({
      date,
      value_date: parseDate(cell(row, map.value_date)),
      description: rawDesc.replace(/\s+/g, ' ').trim(),
      amount,
      currency: 'INR',
      balance: parseAmount(cell(row, map.balance)),
      type,
      reference_number: cell(row, map.reference) || null,
      mode: cell(row, map.mode) || null,
    });
  }

  return results;
}
