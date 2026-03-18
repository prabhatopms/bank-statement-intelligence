"use client"

import { useState } from 'react';
import { format } from 'date-fns';
import { Sparkles, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface Transaction {
  id: string;
  date: string;
  value_date?: string;
  description: string;
  remarks?: string;
  merchant?: string;
  amount: number;
  currency: string;
  balance?: number;
  type: 'debit' | 'credit';
  mode?: string;
  transaction_id?: string;
  reference_number?: string;
  counterparty?: string;
  counterparty_account?: string;
  counterparty_bank?: string;
  upi_id?: string;
  location?: string;
  category?: string;
  website?: string;
  flagged: boolean;
  flag_reason?: string;
  enriched: boolean;
  enrich_source?: string;
  document_filename?: string;
}

interface Pagination {
  page: number;
  pages: number;
  total: number;
}

interface TransactionsTableProps {
  transactions: Transaction[];
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  selectedIds: string[];
  onSelectChange: (ids: string[]) => void;
}

type ColKey =
  | 'date' | 'value_date' | 'description' | 'remarks'
  | 'withdrawal' | 'deposit' | 'amount' | 'balance'
  | 'mode' | 'merchant' | 'category'
  | 'counterparty' | 'counterparty_account' | 'counterparty_bank'
  | 'upi_id' | 'transaction_id' | 'reference_number' | 'location'
  | 'document' | 'status';

const ALL_COLUMNS: { key: ColKey; label: string; defaultVisible: boolean }[] = [
  { key: 'date',                label: 'Date',               defaultVisible: true  },
  { key: 'description',         label: 'Description',        defaultVisible: true  },
  { key: 'withdrawal',          label: 'Withdrawal (Dr)',     defaultVisible: true  },
  { key: 'deposit',             label: 'Deposit (Cr)',        defaultVisible: true  },
  { key: 'balance',             label: 'Balance',            defaultVisible: true  },
  { key: 'mode',                label: 'Mode',               defaultVisible: true  },
  { key: 'merchant',            label: 'Merchant',           defaultVisible: true  },
  { key: 'category',            label: 'Category',           defaultVisible: true  },
  { key: 'counterparty',        label: 'Counterparty',       defaultVisible: true  },
  { key: 'status',              label: 'Status',             defaultVisible: true  },
  { key: 'value_date',          label: 'Value Date',         defaultVisible: false },
  { key: 'amount',              label: 'Amount (combined)',  defaultVisible: false },
  { key: 'remarks',             label: 'Remarks',            defaultVisible: false },
  { key: 'counterparty_account',label: 'Counterparty A/C',  defaultVisible: false },
  { key: 'counterparty_bank',   label: 'Counterparty Bank',  defaultVisible: false },
  { key: 'upi_id',              label: 'UPI ID',             defaultVisible: false },
  { key: 'transaction_id',      label: 'Transaction ID',     defaultVisible: false },
  { key: 'reference_number',    label: 'Reference No.',      defaultVisible: false },
  { key: 'location',            label: 'Location',           defaultVisible: false },
  { key: 'document',            label: 'Document',           defaultVisible: false },
];

const DEFAULT_VISIBLE = new Set(
  ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)
);

function fmt(date: string) {
  try { return format(new Date(date), 'dd MMM yyyy'); } catch { return date; }
}

export function TransactionsTable({
  transactions,
  pagination,
  onPageChange,
  onRefresh,
  selectedIds,
  onSelectChange,
}: TransactionsTableProps) {
  const [enriching, setEnriching] = useState<string | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const { toast } = useToast();

  const toggleCol = (key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleEnrich = async (id: string, mode: 'ai' | 'search' = 'ai') => {
    setEnriching(id);
    try {
      const res = await fetch(`/api/transactions/${id}/enrich?mode=${mode}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: 'Transaction enriched', description: `Merchant: ${data.merchant || 'N/A'} · Category: ${data.category || 'N/A'}` });
      onRefresh();
    } catch (error) {
      toast({ title: 'Enrichment failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setEnriching(null);
    }
  };

  const toggleSelect = (id: string) => {
    onSelectChange(selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id]);
  };

  const toggleSelectAll = () => {
    onSelectChange(selectedIds.length === transactions.length ? [] : transactions.map(t => t.id));
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-md">
        No transactions found. Upload and extract a bank statement to get started.
      </div>
    );
  }

  const vis = (key: ColKey) => visibleCols.has(key);

  return (
    <div className="space-y-3">
      {/* Column visibility toggle */}
      <div className="flex justify-end relative">
        <Button size="sm" variant="outline" onClick={() => setShowColPicker(v => !v)}>
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          Columns
        </Button>
        {showColPicker && (
          <div className="absolute top-9 right-0 z-20 bg-white border rounded-lg shadow-lg p-3 w-56 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Toggle columns</p>
            {ALL_COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/40 px-1 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={visibleCols.has(col.key)}
                  onChange={() => toggleCol(col.key)}
                  className="rounded"
                />
                {col.label}
                {!col.defaultVisible && (
                  <span className="ml-auto text-[10px] text-muted-foreground">hidden</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.length === transactions.length && transactions.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              {vis('date')                 && <th className="text-left p-3 font-medium whitespace-nowrap">Date</th>}
              {vis('value_date')           && <th className="text-left p-3 font-medium whitespace-nowrap">Value Date</th>}
              {vis('description')          && <th className="text-left p-3 font-medium">Description</th>}
              {vis('remarks')              && <th className="text-left p-3 font-medium">Remarks</th>}
              {vis('withdrawal')            && <th className="text-right p-3 font-medium text-red-600">Withdrawal (Dr)</th>}
              {vis('deposit')              && <th className="text-right p-3 font-medium text-green-600">Deposit (Cr)</th>}
              {vis('amount')               && <th className="text-right p-3 font-medium">Amount</th>}
              {vis('balance')              && <th className="text-right p-3 font-medium">Balance</th>}
              {vis('mode')                 && <th className="text-left p-3 font-medium">Mode</th>}
              {vis('merchant')             && <th className="text-left p-3 font-medium">Merchant</th>}
              {vis('category')             && <th className="text-left p-3 font-medium">Category</th>}
              {vis('counterparty')         && <th className="text-left p-3 font-medium">Counterparty</th>}
              {vis('counterparty_account') && <th className="text-left p-3 font-medium">Counterparty A/C</th>}
              {vis('counterparty_bank')    && <th className="text-left p-3 font-medium">Counterparty Bank</th>}
              {vis('upi_id')               && <th className="text-left p-3 font-medium">UPI ID</th>}
              {vis('transaction_id')       && <th className="text-left p-3 font-medium">Txn ID</th>}
              {vis('reference_number')     && <th className="text-left p-3 font-medium">Ref No.</th>}
              {vis('location')             && <th className="text-left p-3 font-medium">Location</th>}
              {vis('document')             && <th className="text-left p-3 font-medium">Document</th>}
              {vis('status')               && <th className="text-left p-3 font-medium">Status</th>}
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className={`border-b last:border-0 hover:bg-muted/20 ${selectedIds.includes(tx.id) ? 'bg-blue-50' : ''}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selectedIds.includes(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded" />
                </td>

                {vis('date') && (
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{tx.date ? fmt(tx.date) : '-'}</td>
                )}
                {vis('value_date') && (
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{tx.value_date ? fmt(tx.value_date) : '-'}</td>
                )}
                {vis('description') && (
                  <td className="p-3 max-w-xs">
                    <div className="truncate" title={tx.description}>{tx.description}</div>
                  </td>
                )}
                {vis('remarks') && (
                  <td className="p-3 max-w-xs text-muted-foreground">
                    <div className="truncate" title={tx.remarks || ''}>{tx.remarks || '-'}</div>
                  </td>
                )}
                {vis('withdrawal') && (
                  <td className="p-3 text-right font-medium whitespace-nowrap text-red-600">
                    {tx.type === 'debit'
                      ? `₹${parseFloat(String(tx.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                      : <span className="text-muted-foreground/30">—</span>}
                  </td>
                )}
                {vis('deposit') && (
                  <td className="p-3 text-right font-medium whitespace-nowrap text-green-600">
                    {tx.type === 'credit'
                      ? `₹${parseFloat(String(tx.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                      : <span className="text-muted-foreground/30">—</span>}
                  </td>
                )}
                {vis('amount') && (
                  <td className={`p-3 text-right font-medium whitespace-nowrap ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>
                    {tx.type === 'debit' ? '-' : '+'}
                    {tx.currency === 'INR' ? '₹' : tx.currency + ' '}
                    {parseFloat(String(tx.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                )}
                {vis('balance') && (
                  <td className="p-3 text-right text-muted-foreground whitespace-nowrap">
                    {tx.balance != null ? `₹${parseFloat(String(tx.balance)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                  </td>
                )}
                {vis('mode') && (
                  <td className="p-3">
                    {tx.mode ? <Badge variant="secondary" className="text-xs font-mono">{tx.mode}</Badge> : '-'}
                  </td>
                )}
                {vis('merchant') && (
                  <td className="p-3 text-muted-foreground max-w-[140px]">
                    {tx.merchant ? (
                      tx.website
                        ? <a href={tx.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">{tx.merchant}</a>
                        : <span className="truncate block">{tx.merchant}</span>
                    ) : '-'}
                  </td>
                )}
                {vis('category') && (
                  <td className="p-3">
                    {tx.category ? <Badge variant="outline" className="text-xs">{tx.category}</Badge> : '-'}
                  </td>
                )}
                {vis('counterparty') && (
                  <td className="p-3 text-muted-foreground max-w-[140px]">
                    <div className="truncate" title={tx.counterparty || ''}>{tx.counterparty || '-'}</div>
                  </td>
                )}
                {vis('counterparty_account') && (
                  <td className="p-3 text-muted-foreground font-mono text-xs">{tx.counterparty_account || '-'}</td>
                )}
                {vis('counterparty_bank') && (
                  <td className="p-3 text-muted-foreground">{tx.counterparty_bank || '-'}</td>
                )}
                {vis('upi_id') && (
                  <td className="p-3 text-muted-foreground font-mono text-xs max-w-[160px]">
                    <div className="truncate" title={tx.upi_id || ''}>{tx.upi_id || '-'}</div>
                  </td>
                )}
                {vis('transaction_id') && (
                  <td className="p-3 text-muted-foreground font-mono text-xs max-w-[160px]">
                    <div className="truncate" title={tx.transaction_id || ''}>{tx.transaction_id || '-'}</div>
                  </td>
                )}
                {vis('reference_number') && (
                  <td className="p-3 text-muted-foreground font-mono text-xs">{tx.reference_number || '-'}</td>
                )}
                {vis('location') && (
                  <td className="p-3 text-muted-foreground">{tx.location || '-'}</td>
                )}
                {vis('document') && (
                  <td className="p-3 text-muted-foreground text-xs max-w-[120px]">
                    <div className="truncate" title={tx.document_filename || ''}>{tx.document_filename || '-'}</div>
                  </td>
                )}
                {vis('status') && (
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {tx.flagged && (
                        <span title={tx.flag_reason || 'Flagged'}>
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        </span>
                      )}
                      {tx.enriched && (
                        <span title={`Enriched via ${tx.enrich_source}`}>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        </span>
                      )}
                      {!tx.flagged && !tx.enriched && <span className="text-muted-foreground text-xs">—</span>}
                    </div>
                  </td>
                )}
                <td className="p-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEnrich(tx.id, 'ai')}
                    disabled={enriching === tx.id}
                    title="Enrich with AI"
                  >
                    <Sparkles className={`h-4 w-4 ${enriching === tx.id ? 'animate-pulse' : ''}`} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {((pagination.page - 1) * 50) + 1}–{Math.min(pagination.page * 50, pagination.total)} of {pagination.total} transactions
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>Page {pagination.page} of {pagination.pages}</span>
          <Button size="sm" variant="outline" onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page >= pagination.pages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
