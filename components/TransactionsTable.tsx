"use client"

import { useState } from 'react';
import { format } from 'date-fns';
import { Sparkles, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface Transaction {
  id: string;
  date: string;
  description: string;
  merchant?: string;
  amount: number;
  currency: string;
  balance?: number;
  type: 'debit' | 'credit';
  category?: string;
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

export function TransactionsTable({
  transactions,
  pagination,
  onPageChange,
  onRefresh,
  selectedIds,
  onSelectChange,
}: TransactionsTableProps) {
  const [enriching, setEnriching] = useState<string | null>(null);
  const { toast } = useToast();

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
    if (selectedIds.includes(id)) {
      onSelectChange(selectedIds.filter(i => i !== id));
    } else {
      onSelectChange([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === transactions.length) {
      onSelectChange([]);
    } else {
      onSelectChange(transactions.map(t => t.id));
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-md">
        No transactions found. Upload and extract a bank statement to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-left p-3 font-medium">Merchant</th>
              <th className="text-right p-3 font-medium">Amount</th>
              <th className="text-left p-3 font-medium">Category</th>
              <th className="text-left p-3 font-medium">Document</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className={`border-b last:border-0 hover:bg-muted/20 ${selectedIds.includes(tx.id) ? 'bg-blue-50' : ''}`}>
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                    className="rounded"
                  />
                </td>
                <td className="p-3 text-muted-foreground whitespace-nowrap">
                  {tx.date ? format(new Date(tx.date), 'dd MMM yyyy') : '-'}
                </td>
                <td className="p-3 max-w-xs">
                  <div className="truncate" title={tx.description}>{tx.description}</div>
                </td>
                <td className="p-3 text-muted-foreground">
                  {tx.merchant || '-'}
                </td>
                <td className={`p-3 text-right font-medium whitespace-nowrap ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>
                  {tx.type === 'debit' ? '-' : '+'}&#8377;{parseFloat(String(tx.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="p-3">
                  {tx.category ? (
                    <Badge variant="outline" className="text-xs">{tx.category}</Badge>
                  ) : '-'}
                </td>
                <td className="p-3 text-muted-foreground text-xs truncate max-w-[120px]">
                  {tx.document_filename || '-'}
                </td>
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
                  </div>
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEnrich(tx.id, 'ai')}
                      disabled={enriching === tx.id}
                      title="Enrich with AI"
                    >
                      <Sparkles className={`h-4 w-4 ${enriching === tx.id ? 'animate-pulse' : ''}`} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {((pagination.page - 1) * 50) + 1}&ndash;{Math.min(pagination.page * 50, pagination.total)} of {pagination.total} transactions
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>Page {pagination.page} of {pagination.pages}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
