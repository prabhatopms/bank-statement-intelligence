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

interface ColZone {
  field: keyof ColumnXMap;
  x: number;
  left: number;
  right: number;
}

// Build exclusive zones for each column using midpoints between adjacent X positions.
// This guarantees no two columns overlap regardless of data cell positions.
function buildZones(xmap: ColumnXMap): ColZone[] {
  const entries = (Object.entries(xmap) as [keyof ColumnXMap, number][])
    .sort(([, a], [, b]) => a - b);

  return entries.map(([field, x], i) => {
    const prev = entries[i - 1]?.[1] ?? -Infinity;
    const next = entries[i + 1]?.[1] ?? Infinity;
    return {
      field,
      x,
      left:  i === 0              ? -Infinity : (x + prev) / 2,
      right: i === entries.length - 1 ? Infinity  : (x + next) / 2,
    };
  });
}

// Return all text items within a column's exclusive zone, joined as one string
function cellInZone(row: TableRow, zone: ColZone | undefined): string {
  if (!zone) return '';
  const items = row.rawItems.filter(it => it.x >= zone.left && it.x < zone.right);
  return items.map(it => it.text).join(' ').trim();
}

export function detectHeader(rows: TableRow[]): { headerIndex: number; xmap: ColumnXMap } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const xmap: ColumnXMap = {};
    let score = 0;

    for (let j = 0; j < row.cells.length; j++) {
      const raw = row.cells[j].trim().replace(/[\n\r]+/g, ' ').replace(/\*+$/, '').trim();
      for (const [field, pattern] of Object.entries(PATTERNS) as [keyof ColumnXMap, RegExp][]) {
        if (pattern.test(raw) && xmap[field] === undefined) {
          (xmap as Record<string, number>)[field] = row.rawItems[j]?.x ?? j * 50;
          score++;
        }
      }
    }

    const hasMinFields =
      xmap.date !== undefined &&
      (xmap.debit !== undefined || xmap.credit !== undefined ||
       xmap.balance !== undefined || xmap.description !== undefined);

    if (score >= 2 && hasMinFields) {
      return { headerIndex: i, xmap };
    }
  }
  return null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const M: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { const y = m[3].length===2?`20${m[3]}`:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-](\d{2,4})$/);
  if (m) { const mo=M[m[2].toLowerCase()]; if(mo){ const y=m[3].length===2?`20${m[3]}`:m[3]; return `${y}-${mo}-${m[1].padStart(2,'0')}`; } }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseAmount(raw: string): number | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().replace(/[₹$£€,\s]/g, '');
  if (!s || s==='-' || s==='.' || /^nil$/i.test(s)) return null;
  const bracketed = s.startsWith('(') && s.endsWith(')');
  const n = parseFloat(bracketed ? s.slice(1,-1) : s);
  return isNaN(n) || n===0 ? null : Math.abs(n);
}

export function parseTransactions(
  rows: TableRow[],
  headerIndex: number,
  xmap: ColumnXMap,
): ParsedTransaction[] {
  const zones = buildZones(xmap);
  const z = (field: keyof ColumnXMap) => zones.find(z => z.field === field);

  const hasSeparateDrCr = xmap.debit !== undefined && xmap.credit !== undefined;
  const results: ParsedTransaction[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.rawItems.length < 2) continue;

    const rawDate = cellInZone(row, z('date'));
    const date = parseDate(rawDate);
    if (!date) continue;

    const rawDesc = cellInZone(row, z('description'));
    if (!rawDesc) continue;

    let amount: number | null = null;
    let type: 'debit' | 'credit' = 'debit';

    if (hasSeparateDrCr) {
      const dr = parseAmount(cellInZone(row, z('debit')));
      const cr = parseAmount(cellInZone(row, z('credit')));
      if (dr)       { amount = dr; type = 'debit'; }
      else if (cr)  { amount = cr; type = 'credit'; }
    } else {
      const amtZone = z('debit') ?? z('credit');
      amount = parseAmount(cellInZone(row, amtZone));
      if (!amount) continue;

      const dl = rawDesc.toLowerCase();
      const crKw = ['credit','cr ','deposit','received','salary','refund','reversal','cashback','interest','dividend','inward','neft cr','imps cr','upi cr'];
      type = crKw.some(k => dl.includes(k)) ? 'credit' : 'debit';

      if (xmap.balance !== undefined && results.length > 0) {
        const prevBal = results[results.length-1].balance;
        const currBal = parseAmount(cellInZone(row, z('balance')));
        if (prevBal !== null && currBal !== null)
          type = currBal >= prevBal ? 'credit' : 'debit';
      }
    }

    if (!amount) continue;

    results.push({
      date,
      value_date:      parseDate(cellInZone(row, z('value_date'))),
      description:     rawDesc.replace(/\s+/g,' ').trim(),
      amount,
      currency:        'INR',
      balance:         parseAmount(cellInZone(row, z('balance'))),
      type,
      reference_number: cellInZone(row, z('reference')) || null,
      mode:             cellInZone(row, z('mode')) || null,
    });
  }

  return results;
}
