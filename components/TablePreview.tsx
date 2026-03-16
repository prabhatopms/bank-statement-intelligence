"use client"

import { useState } from 'react';
import { Loader2, Table2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  currency: string;
  balance: number | null;
  type: 'debit' | 'credit';
  reference_number: string | null;
  mode: string | null;
}

interface PreviewData {
  totalRows: number;
  headerIndex: number | null;
  columnMap: Record<string, number> | null;
  rows: string[][];
  transactions: ParsedTransaction[];
}

interface TablePreviewProps {
  documentId: string;
  filename: string;
  open: boolean;
  onClose: () => void;
}

export function TablePreview({ documentId, filename, open, onClose }: TablePreviewProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'raw' | 'parsed'>('parsed');

  const load = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/preview`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Preview failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && !data && !loading) load();
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table2 className="h-5 w-5 text-blue-500" />
            Table Preview — {filename}
          </DialogTitle>
          <DialogDescription>
            Extracted directly from PDF using coordinate-based table detection
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Parsing PDF table structure...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
              <XCircle className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {data && (
            <>
              {/* Stats bar */}
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <span className="text-muted-foreground">Total rows: <strong>{data.totalRows}</strong></span>
                {data.headerIndex !== null ? (
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle className="h-4 w-4" />
                    Headers auto-detected (row {data.headerIndex + 1})
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-700">
                    <AlertTriangle className="h-4 w-4" />
                    No headers detected
                  </span>
                )}
                {data.columnMap && (
                  <div className="flex gap-1 flex-wrap">
                    {Object.entries(data.columnMap).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-xs font-mono">
                        {k} → col {(v as number) + 1}
                      </Badge>
                    ))}
                  </div>
                )}
                <span className="text-muted-foreground ml-auto">
                  {data.transactions.length} transactions parsed (preview of first 20)
                </span>
              </div>

              {/* View toggle */}
              <div className="flex gap-2">
                <Button
                  size="sm" variant={view === 'parsed' ? 'default' : 'outline'}
                  onClick={() => setView('parsed')}
                >
                  Parsed Transactions
                </Button>
                <Button
                  size="sm" variant={view === 'raw' ? 'default' : 'outline'}
                  onClick={() => setView('raw')}
                >
                  Raw Table
                </Button>
                <Button size="sm" variant="ghost" onClick={load} className="ml-auto">
                  <Loader2 className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Reload
                </Button>
              </div>

              {/* Parsed transactions table */}
              {view === 'parsed' && (
                <div className="overflow-auto flex-1 border rounded-lg">
                  {data.transactions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                      No transactions could be parsed from the detected headers.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium">Date</th>
                          <th className="text-left p-2 font-medium">Description</th>
                          <th className="text-left p-2 font-medium">Mode</th>
                          <th className="text-left p-2 font-medium">Ref</th>
                          <th className="text-right p-2 font-medium">Amount</th>
                          <th className="text-right p-2 font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((tx, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="p-2 whitespace-nowrap text-muted-foreground">{tx.date}</td>
                            <td className="p-2 max-w-xs">
                              <div className="truncate" title={tx.description}>{tx.description}</div>
                            </td>
                            <td className="p-2">
                              {tx.mode ? <Badge variant="secondary" className="text-xs">{tx.mode}</Badge> : '-'}
                            </td>
                            <td className="p-2 font-mono text-muted-foreground">{tx.reference_number || '-'}</td>
                            <td className={`p-2 text-right font-medium whitespace-nowrap ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>
                              {tx.type === 'debit' ? '-' : '+'}₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
                              {tx.balance != null ? `₹${tx.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Raw rows table */}
              {view === 'raw' && (
                <div className="overflow-auto flex-1 border rounded-lg">
                  <table className="w-full text-xs font-mono">
                    <tbody>
                      {data.rows.map((row, i) => {
                        const isHeader = data.headerIndex !== null && i === (data.headerIndex < 2 ? data.headerIndex : 2);
                        return (
                          <tr key={i} className={`border-b last:border-0 ${isHeader ? 'bg-blue-50 font-bold' : 'hover:bg-muted/20'}`}>
                            <td className="p-1 pl-2 text-gray-400 select-none w-8">{i + 1}</td>
                            {row.map((cell, j) => (
                              <td key={j} className="p-1 px-2 border-l max-w-[200px] truncate" title={cell}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
