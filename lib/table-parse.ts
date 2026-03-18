import type { TableRow } from './table-extract';

export interface ColumnXMap {
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
const PATTERNS: Record<keyof ColumnXMap, RegExp> = {
  date:        /^(date|txn\s*date|tran\s*date|trans\.?\s*date|posting\s*date|transaction\s*date)$/i,
  value_date:  /^(value\s*date|val\.?\s*date|effective\s*date)$/i,
  description: /^(description|narration|particulars|remarks|transaction\s*details?|details?|memo|narrative|trans\.?\s*remarks|trans\.?\s*particular|tran\s*description|transaction\s*remarks?)$/i,
  debit:       /^(debit|dr\.?|withdrawal[s]?(\s*\(dr\.?\))?|withdrawal\s*am(ou)?n?t\.?|dr\s*am(ou)?n?t\.?|debit\s*am(ou)?n?t\.?|debit\s*\(dr\.?\)|withdrawl[s]?|paid\s*out|money\s*out)$/i,
  credit:      /^(credit|cr\.?|deposit[s]?(\s*\(cr\.?\))?|deposit\s*am(ou)?n?t\.?|cr\s*am(ou)?n?t\.?|credit\s*am(ou)?n?t\.?|credit\s*\(cr\.?\)|paid\s*in|money\s*in)$/i,
  balance:     /^(balance|closing\s*balance|running\s*balance|avl\.?\s*bal(ance)?|avail(able)?\s*bal(ance)?|bal\.?|outstanding\s*balance)$/i,
  reference:   /^(ref(erence)?\.?\s*no\.?|cheque?\s*no\.?|chq\.?\s*\/?(\s*ref\.?\s*no\.?)?|utr|trans(action)?\s*id|instrument\s*no\.?|tran\s*id|ref\s*id)$/i,
  mode:        /^(mode|trans(action)?\s*type|type|channel)$/i,
};

// Detect header row — returns X positions of each column (not indices)
export function detectHeader(rows: TableRow[]): { headerIndex: number; xmap: ColumnXMap } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const xmap: ColumnXMap = {};
    let score = 0;

    for (let j = 0; j < row.cells.length; j++) {
      const raw = row.cells[j].trim().replace(/[\n\r]+/g, ' ').replace(/\*+$/, '').trim();
      for (const [field, pattern] of Object.entries(PATTERNS) as [keyof ColumnXMap, RegExp][]) {
        if (pattern.test(raw) && xmap[field] === undefined) {
          // Store the X coordinate of this header cell
          (xmap as Record<string, number>)[field] = row.rawItems[j]?.x ?? j * 50;
          score++;
        }
      }
    }

    const hasMinFields =
      xmap.date !== undefined &&
      (xmap.debit !== undefined || xmap.credit !== undefined || xmap.balance !== undefined || xmap.description !== undefined);

    if (score >= 2 && hasMinFields) {
      return { headerIndex: i, xmap };
    }
  }
  return null;
}

// Get the text of the cell whose X position is closest to targetX
// tolerance: max distance in PDF units (default 40 — generous for column width variance)
function cellAtX(row: TableRow, targetX: number | undefined, tolerance = 40): string {
  if (targetX === undefined) return '';
  let best = '';
  let bestDist = Infinity;
  for (const item of row.rawItems) {
    const dist = Math.abs(item.x - targetX);
    if (dist < bestDist) {
      bestDist = dist;
      best = item.text;
    }
  }
  return bestDist <= tolerance ? best : '';
}

// Parse date strings into YYYY-MM-DD
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const MONTHS: Record<string, string> = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// Parse amount strings like "1,23,456.78" or "(500.00)" → number
function parseAmount(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().replace(/[₹$£€,\s]/g, '');
  if (!s || s === '-' || s === '.' || /^nil$/i.test(s)) return null;
  const bracketed = s.startsWith('(') && s.endsWith(')');
  const num = parseFloat(bracketed ? s.slice(1, -1) : s);
  return isNaN(num) || num === 0 ? null : Math.abs(num);
}

export function parseTransactions(
  rows: TableRow[],
  headerIndex: number,
  xmap: ColumnXMap,
): ParsedTransaction[] {
  const results: ParsedTransaction[] = [];
  const hasSeparateDrCr = xmap.debit !== undefined && xmap.credit !== undefined;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.rawItems.length < 2) continue;

    // Use X-position matching for every field
    const rawDate = cellAtX(row, xmap.date);
    const date = parseDate(rawDate);
    if (!date) continue;

    const rawDesc = cellAtX(row, xmap.description);
    if (!rawDesc) continue;

    let amount: number | null = null;
    let type: 'debit' | 'credit' = 'debit';

    if (hasSeparateDrCr) {
      const drAmt = parseAmount(cellAtX(row, xmap.debit));
      const crAmt = parseAmount(cellAtX(row, xmap.credit));
      if (drAmt) { amount = drAmt; type = 'debit'; }
      else if (crAmt) { amount = crAmt; type = 'credit'; }
    } else {
      // Single amount column — detect type from description keywords or balance delta
      const amtX = xmap.debit ?? xmap.credit;
      amount = parseAmount(cellAtX(row, amtX));
      if (!amount) continue;

      const descLower = rawDesc.toLowerCase();
      const creditKw = ['credit','cr ','deposit','received','salary','refund','reversal','cashback','interest','dividend','inward','neft cr','imps cr','upi cr'];
      type = creditKw.some(k => descLower.includes(k)) ? 'credit' : 'debit';

      if (xmap.balance !== undefined && results.length > 0) {
        const prevBal = results[results.length - 1].balance;
        const currBal = parseAmount(cellAtX(row, xmap.balance));
        if (prevBal !== null && currBal !== null) {
          type = currBal >= prevBal ? 'credit' : 'debit';
        }
      }
    }

    if (!amount) continue;

    results.push({
      date,
      value_date: parseDate(cellAtX(row, xmap.value_date)),
      description: rawDesc.replace(/\s+/g, ' ').trim(),
      amount,
      currency: 'INR',
      balance: parseAmount(cellAtX(row, xmap.balance)),
      type,
      reference_number: cellAtX(row, xmap.reference) || null,
      mode: cellAtX(row, xmap.mode) || null,
    });
  }

  return results;
}
