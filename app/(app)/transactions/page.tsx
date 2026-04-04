"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, Sparkles, Filter, Search, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TransactionsTable } from '@/components/TransactionsTable';
import { StatsBar } from '@/components/StatsBar';
import { CATEGORIES } from '@/lib/enrich';

const CATEGORY_OPTIONS = ['All', ...CATEGORIES];

interface EnrichProgress {
  running: boolean;
  // current batch
  current: number;
  total: number;
  currentDescription: string;
  lastLabel: string;
  // cumulative across all batches
  totalProcessed: number;
  totalFailed: number;
  batchNum: number;
  remaining: number;
}

function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState({ total: 0, total_debits: 0, total_credits: 0, flagged_count: 0, enriched_count: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const allFailedIdsRef = useRef<string[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress>({
    running: false, current: 0, total: 0, currentDescription: '', lastLabel: '',
    totalProcessed: 0, totalFailed: 0, batchNum: 0, remaining: 0,
  });

  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    category: searchParams.get('category') || '',
    flagged: searchParams.get('flagged') || '',
    enriched: searchParams.get('enriched') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    amount_min: searchParams.get('amount_min') || '',
    amount_max: searchParams.get('amount_max') || '',
    withdrawal_min: searchParams.get('withdrawal_min') || '',
    withdrawal_max: searchParams.get('withdrawal_max') || '',
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
      if (filters.amount_min) params.set('amount_min', filters.amount_min);
      if (filters.amount_max) params.set('amount_max', filters.amount_max);
      if (filters.withdrawal_min) params.set('withdrawal_min', filters.withdrawal_min);
      if (filters.withdrawal_max) params.set('withdrawal_max', filters.withdrawal_max);
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

  const runEnrichment = useCallback(async (body: { ids?: string[]; enrichAll?: boolean }) => {
    if (enrichProgress.running) return;
    const controller = new AbortController();
    enrichAbortRef.current = controller;
    allFailedIdsRef.current = [];

    setEnrichProgress({
      running: true, current: 0, total: 0, currentDescription: 'Starting...', lastLabel: '',
      totalProcessed: 0, totalFailed: 0, batchNum: 0, remaining: 0,
    });

    let totalProcessed = 0;
    let totalFailed = 0;
    let shouldContinue = true;
    let batchNum = 0;

    try {
      while (shouldContinue && !controller.signal.aborted) {
        batchNum++;
        const requestBody = body.enrichAll
          ? { enrichAll: true, excludeIds: allFailedIdsRef.current, limit: 100 }
          : body;

        setEnrichProgress(p => ({ ...p, batchNum, current: 0, currentDescription: 'Loading batch...' }));

        const res = await fetch('/api/transactions/enrich-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        if (!res.body) throw new Error('No stream');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let batchDone = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'started') {
                setEnrichProgress(p => ({ ...p, total: ev.total, current: 0 }));
              } else if (ev.type === 'progress') {
                setEnrichProgress(p => ({ ...p, current: ev.current, total: ev.total, currentDescription: ev.description }));
              } else if (ev.type === 'enriched') {
                totalProcessed++;
                setEnrichProgress(p => ({ ...p, totalProcessed, lastLabel: ev.label }));
              } else if (ev.type === 'failed') {
                totalFailed++;
                allFailedIdsRef.current.push(ev.id);
                setEnrichProgress(p => ({ ...p, totalFailed }));
              } else if (ev.type === 'done') {
                batchDone = true;
                const remaining: number = ev.remaining ?? 0;
                // Only continue looping for enrichAll mode
                shouldContinue = body.enrichAll === true && remaining > 0;
                setEnrichProgress(p => ({ ...p, remaining }));
                if (!shouldContinue) {
                  setEnrichProgress(p => ({ ...p, running: false }));
                  toast.success('Enrichment complete', {
                    description: `${totalProcessed} enriched · ${totalFailed} skipped`,
                  });
                  setSelectedIds([]);
                  fetchTransactions();
                }
              }
            } catch { /* skip */ }
          }
        }

        if (!batchDone) shouldContinue = false;
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error('Enrichment failed', { description: err instanceof Error ? err.message : 'Unknown error' });
      }
      setEnrichProgress(p => ({ ...p, running: false }));
      fetchTransactions();
    }

    if (controller.signal.aborted) {
      setEnrichProgress(p => ({ ...p, running: false }));
      fetchTransactions();
    }
  }, [enrichProgress.running, fetchTransactions]);

  const handleEnrichSelected = () => runEnrichment({ ids: selectedIds });
  const handleEnrichAll = () => runEnrichment({ enrichAll: true });
  const handleStopEnrich = () => {
    enrichAbortRef.current?.abort();
    setEnrichProgress(p => ({ ...p, running: false }));
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
            <Button variant="outline" onClick={handleEnrichSelected} disabled={enrichProgress.running}>
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich Selected ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" onClick={handleEnrichAll} disabled={enrichProgress.running}>
            {enrichProgress.running ? <Spinner size="sm" className="mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Enrich All Unenriched
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <StatsBar stats={stats} />

      {/* Enrichment progress panel */}
      {(enrichProgress.running || enrichProgress.batchNum > 0) && (
        <div className="rounded-lg border bg-gray-950 text-gray-100 text-xs font-mono p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              {enrichProgress.running
                ? <span className="text-yellow-400 animate-pulse">● Enriching...</span>
                : <span className="text-green-400">✓ Done</span>}
              {enrichProgress.batchNum > 1 && (
                <span className="text-blue-400">Batch {enrichProgress.batchNum}</span>
              )}
              <span className="text-gray-400">
                {enrichProgress.totalProcessed} enriched
                {enrichProgress.totalFailed > 0 && <> · <span className="text-red-400">{enrichProgress.totalFailed} skipped</span></>}
                {enrichProgress.total > 0 && <> · {enrichProgress.current}/{enrichProgress.total} this batch</>}
                {enrichProgress.running && enrichProgress.remaining > 0 && <> · <span className="text-yellow-300">{enrichProgress.remaining} remaining</span></>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {enrichProgress.running && (
                <button onClick={handleStopEnrich} className="flex items-center gap-1 text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-800 rounded text-xs">
                  <X className="h-3 w-3" /> Stop
                </button>
              )}
              {!enrichProgress.running && (
                <button onClick={() => setEnrichProgress(p => ({ ...p, batchNum: 0 }))} className="text-gray-500 hover:text-gray-300 px-1">×</button>
              )}
            </div>
          </div>
          {/* Progress bar — current batch */}
          {enrichProgress.total > 0 && (
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((enrichProgress.current / enrichProgress.total) * 100)}%` }}
              />
            </div>
          )}
          {enrichProgress.running && enrichProgress.currentDescription && (
            <div className="text-gray-400 truncate">
              Processing: <span className="text-gray-200">{enrichProgress.currentDescription}</span>
            </div>
          )}
          {enrichProgress.lastLabel && (
            <div className="text-gray-500 truncate">
              Last enriched: <span className="text-green-400">{enrichProgress.lastLabel}</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
          <Button size="sm" variant="ghost" onClick={() => setFilters({ search: '', category: '', flagged: '', enriched: '', date_from: '', date_to: '', amount_min: '', amount_max: '', withdrawal_min: '', withdrawal_max: '', page: 1 })}>
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
              {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c === 'All' ? 'all' : c}>{c}</SelectItem>)}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹ min</span>
            <Input
              type="number" min="0" placeholder="Amount min"
              className="pl-12"
              value={filters.amount_min}
              onChange={(e) => setFilters(f => ({ ...f, amount_min: e.target.value, page: 1 }))}
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹ max</span>
            <Input
              type="number" min="0" placeholder="Amount max"
              className="pl-12"
              value={filters.amount_max}
              onChange={(e) => setFilters(f => ({ ...f, amount_max: e.target.value, page: 1 }))}
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-red-400 pointer-events-none">↓ min</span>
            <Input
              type="number" min="0" placeholder="Withdrawal min"
              className="pl-12"
              value={filters.withdrawal_min}
              onChange={(e) => setFilters(f => ({ ...f, withdrawal_min: e.target.value, page: 1 }))}
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-red-400 pointer-events-none">↓ max</span>
            <Input
              type="number" min="0" placeholder="Withdrawal max"
              className="pl-12"
              value={filters.withdrawal_max}
              onChange={(e) => setFilters(f => ({ ...f, withdrawal_max: e.target.value, page: 1 }))}
            />
          </div>
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

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionsPageInner />
    </Suspense>
  );
}
