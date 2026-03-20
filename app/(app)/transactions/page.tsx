"use client"

import { useState, useEffect, useCallback } from 'react';
import { Download, Sparkles, Filter, Search, RefreshCw } from 'lucide-react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, toast } from '@/lib/apollo-wind';
import { TransactionsTable } from '@/components/TransactionsTable';
import { StatsBar } from '@/components/StatsBar';

const CATEGORIES = ['All', 'Food & Dining', 'Travel', 'Shopping', 'Utilities', 'Healthcare', 'Entertainment', 'Finance', 'Income', 'Transfer', 'Other'];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState({ total: 0, total_debits: 0, total_credits: 0, flagged_count: 0, enriched_count: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enrichingBulk, setEnrichingBulk] = useState(false);

  const [filters, setFilters] = useState({
    search: '',
    category: '',
    flagged: '',
    enriched: '',
    date_from: '',
    date_to: '',
    page: 1,
  });

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters.flagged) params.set('flagged', filters.flagged);
      if (filters.enriched) params.set('enriched', filters.enriched);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      params.set('page', String(filters.page));

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      setTransactions(data.transactions || []);
      setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
      setStats(data.stats || { total: 0, total_debits: 0, total_credits: 0, flagged_count: 0, enriched_count: 0 });
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleEnrichSelected = async (mode: 'ai' | 'search' = 'ai') => {
    if (selectedIds.length === 0) return;
    setEnrichingBulk(true);
    try {
      const res = await fetch('/api/transactions/enrich-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, mode }),
      });
      const data = await res.json();
      toast('Bulk enrichment complete', { description: `${data.processed} transactions enriched` });
      setSelectedIds([]);
      fetchTransactions();
    } catch {
      toast.error('Bulk enrichment failed');
    } finally {
      setEnrichingBulk(false);
    }
  };

  const handleEnrichAll = async () => {
    setEnrichingBulk(true);
    try {
      const res = await fetch('/api/transactions/enrich-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrichAll: true, mode: 'ai' }),
      });
      const data = await res.json();
      toast('Enrichment started', { description: `Processing ${data.processed} transactions` });
      fetchTransactions();
    } catch {
      toast.error('Enrichment failed');
    } finally {
      setEnrichingBulk(false);
    }
  };

  const handleExport = () => {
    window.open('/api/transactions/export', '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-1">View and manage all extracted transactions</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button variant="outline" onClick={() => handleEnrichSelected('ai')} disabled={enrichingBulk}>
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich Selected ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" onClick={handleEnrichAll} disabled={enrichingBulk}>
            {enrichingBulk ? <Spinner size="sm" className="mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Enrich All Unenriched
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <StatsBar stats={stats} />

      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
          <Button size="sm" variant="ghost" onClick={() => setFilters({ search: '', category: '', flagged: '', enriched: '', date_from: '', date_to: '', page: 1 })}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative col-span-2 md:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-9"
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))}
            />
          </div>
          <Select value={filters.category || 'all'} onValueChange={(v) => setFilters(f => ({ ...f, category: v === 'all' ? '' : v, page: 1 }))}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c.toLowerCase() === 'all' ? 'all' : c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.flagged || 'all'} onValueChange={(v) => setFilters(f => ({ ...f, flagged: v === 'all' ? '' : v, page: 1 }))}>
            <SelectTrigger><SelectValue placeholder="Flagged" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Flagged only</SelectItem>
              <SelectItem value="false">Not flagged</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.enriched || 'all'} onValueChange={(v) => setFilters(f => ({ ...f, enriched: v === 'all' ? '' : v, page: 1 }))}>
            <SelectTrigger><SelectValue placeholder="Enriched" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Enriched</SelectItem>
              <SelectItem value="false">Not enriched</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={filters.date_from} onChange={(e) => setFilters(f => ({ ...f, date_from: e.target.value, page: 1 }))} />
          <Input type="date" value={filters.date_to} onChange={(e) => setFilters(f => ({ ...f, date_to: e.target.value, page: 1 }))} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="xl" />
        </div>
      ) : (
        <TransactionsTable
          transactions={transactions}
          pagination={pagination}
          onPageChange={(page) => setFilters(f => ({ ...f, page }))}
          onRefresh={fetchTransactions}
          selectedIds={selectedIds}
          onSelectChange={setSelectedIds}
        />
      )}
    </div>
  );
}
