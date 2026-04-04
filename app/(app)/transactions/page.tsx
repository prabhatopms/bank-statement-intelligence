"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Download, Sparkles, Search, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TransactionsTable } from '@/components/TransactionsTable';
import { StatsBar } from '@/components/StatsBar';
import { CATEGORIES, SUB_CATEGORY_MAP } from '@/lib/enrich';

// ─── FY helpers ───────────────────────────────────────────────────────────────
const FY_OPTIONS = [
  { label: 'All time', value: 'all' },
  { label: 'FY 2026-27', value: '2026-27' },
  { label: 'FY 2025-26', value: '2025-26' },
  { label: 'FY 2024-25', value: '2024-25' },
  { label: 'FY 2023-24', value: '2023-24' },
  { label: 'FY 2022-23', value: '2022-23' },
];

function fyToDates(fy: string): { date_from: string; date_to: string } {
  if (fy === 'all' || !fy) return { date_from: '', date_to: '' };
  const year = parseInt(fy.split('-')[0]);
  return { date_from: `${year}-04-01`, date_to: `${year + 1}-03-31` };
}

function datesToFY(date_from: string, date_to: string): string {
  if (!date_from && !date_to) return 'all';
  for (const { value } of FY_OPTIONS.filter(f => f.value !== 'all')) {
    const { date_from: s, date_to: e } = fyToDates(value);
    if (date_from === s && date_to === e) return value;
  }
  return 'custom';
}

// ─── types ────────────────────────────────────────────────────────────────────
interface Filters {
  search: string;
  category: string;
  sub_category: string;
  type: string;        // '' | 'debit' | 'credit'
  flagged: string;
  enriched: string;
  date_from: string;
  date_to: string;
  amount_min: string;
  amount_max: string;
  page: number;
}

const EMPTY_FILTERS: Filters = {
  search: '', category: '', sub_category: '', type: '',
  flagged: '', enriched: '', date_from: '', date_to: '',
  amount_min: '', amount_max: '', page: 1,
};

interface EnrichProgress {
  running: boolean;
  current: number;
  total: number;
  currentDescription: string;
  lastLabel: string;
  totalProcessed: number;
  totalFailed: number;
  batchNum: number;
  remaining: number;
}

// ─── main component ───────────────────────────────────────────────────────────
function TransactionsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState({ total: 0, total_debits: 0, total_credits: 0, flagged_count: 0, enriched_count: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const allFailedIdsRef = useRef<string[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress>({
    running: false, current: 0, total: 0, currentDescription: '', lastLabel: '',
    totalProcessed: 0, totalFailed: 0, batchNum: 0, remaining: 0,
  });

  // Initialize filters from URL params
  const [filters, setFilters] = useState<Filters>({
    search:       searchParams.get('search') || '',
    category:     searchParams.get('category') || '',
    sub_category: searchParams.get('sub_category') || '',
    type:         searchParams.get('type') || '',
    flagged:      searchParams.get('flagged') || '',
    enriched:     searchParams.get('enriched') || '',
    date_from:    searchParams.get('date_from') || '',
    date_to:      searchParams.get('date_to') || '',
    amount_min:   searchParams.get('amount_min') || '',
    amount_max:   searchParams.get('amount_max') || '',
    page: parseInt(searchParams.get('page') || '1'),
  });

  // Sync filters → URL whenever they change
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search)       params.set('search', filters.search);
    if (filters.category)     params.set('category', filters.category);
    if (filters.sub_category) params.set('sub_category', filters.sub_category);
    if (filters.type)         params.set('type', filters.type);
    if (filters.flagged)      params.set('flagged', filters.flagged);
    if (filters.enriched)     params.set('enriched', filters.enriched);
    if (filters.date_from)    params.set('date_from', filters.date_from);
    if (filters.date_to)      params.set('date_to', filters.date_to);
    if (filters.amount_min)   params.set('amount_min', filters.amount_min);
    if (filters.amount_max)   params.set('amount_max', filters.amount_max);
    if (filters.page > 1)     params.set('page', String(filters.page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search)       params.set('search', filters.search);
      if (filters.category)     params.set('category', filters.category);
      if (filters.sub_category) params.set('sub_category', filters.sub_category);
      if (filters.type)         params.set('type', filters.type);
      if (filters.flagged)      params.set('flagged', filters.flagged);
      if (filters.enriched)     params.set('enriched', filters.enriched);
      if (filters.date_from)    params.set('date_from', filters.date_from);
      if (filters.date_to)      params.set('date_to', filters.date_to);
      if (filters.amount_min)   params.set('amount_min', filters.amount_min);
      if (filters.amount_max)   params.set('amount_max', filters.amount_max);
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

  const setFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(f => ({ ...f, [key]: value, page: 1 }));
  }, []);

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  // Compute derived state
  const currentFY = datesToFY(filters.date_from, filters.date_to);
  const subCategoryOptions = filters.category ? (SUB_CATEGORY_MAP[filters.category] || []) : [];

  // Count active non-search filters
  const activeFilterKeys: (keyof Filters)[] = ['category', 'sub_category', 'type', 'flagged', 'enriched', 'date_from', 'amount_min', 'amount_max'];
  const activeCount = activeFilterKeys.filter(k => filters[k]).length;

  // Active filter chip definitions
  const chips: { label: string; key: keyof Filters; pairKey?: keyof Filters }[] = [];
  if (filters.date_from || filters.date_to) {
    const fyLabel = FY_OPTIONS.find(f => f.value === currentFY)?.label;
    chips.push({
      label: fyLabel && currentFY !== 'custom' ? fyLabel
        : `${filters.date_from || '?'} → ${filters.date_to || '?'}`,
      key: 'date_from', pairKey: 'date_to',
    });
  }
  if (filters.category)     chips.push({ label: filters.category, key: 'category' });
  if (filters.sub_category) chips.push({ label: filters.sub_category, key: 'sub_category' });
  if (filters.type)         chips.push({ label: filters.type === 'debit' ? 'Debits only' : 'Credits only', key: 'type' });
  if (filters.enriched)     chips.push({ label: filters.enriched === 'true' ? 'Enriched' : 'Not enriched', key: 'enriched' });
  if (filters.flagged)      chips.push({ label: filters.flagged === 'true' ? 'Flagged' : 'Not flagged', key: 'flagged' });
  if (filters.amount_min || filters.amount_max) {
    chips.push({
      label: `₹${filters.amount_min || '0'} – ${filters.amount_max ? '₹' + filters.amount_max : '∞'}`,
      key: 'amount_min', pairKey: 'amount_max',
    });
  }

  // ── Enrichment ──────────────────────────────────────────────────────────────
  const runEnrichment = useCallback(async (body: { ids?: string[]; enrichAll?: boolean }) => {
    if (enrichProgress.running) return;
    const controller = new AbortController();
    enrichAbortRef.current = controller;
    allFailedIdsRef.current = [];
    setEnrichProgress({ running: true, current: 0, total: 0, currentDescription: 'Starting...', lastLabel: '', totalProcessed: 0, totalFailed: 0, batchNum: 0, remaining: 0 });

    let totalProcessed = 0, totalFailed = 0, shouldContinue = true, batchNum = 0;

    try {
      while (shouldContinue && !controller.signal.aborted) {
        batchNum++;
        const requestBody = body.enrichAll
          ? { enrichAll: true, excludeIds: allFailedIdsRef.current, limit: 100 }
          : body;
        setEnrichProgress(p => ({ ...p, batchNum, current: 0, currentDescription: 'Loading batch...' }));

        const res = await fetch('/api/transactions/enrich-bulk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody), signal: controller.signal,
        });
        if (!res.body) throw new Error('No stream');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', batchDone = false;

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
                shouldContinue = body.enrichAll === true && remaining > 0;
                setEnrichProgress(p => ({ ...p, remaining }));
                if (!shouldContinue) {
                  setEnrichProgress(p => ({ ...p, running: false }));
                  toast.success('Enrichment complete', { description: `${totalProcessed} enriched · ${totalFailed} skipped` });
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
      if (!controller.signal.aborted) toast.error('Enrichment failed', { description: err instanceof Error ? err.message : 'Unknown error' });
      setEnrichProgress(p => ({ ...p, running: false }));
      fetchTransactions();
    }
    if (controller.signal.aborted) {
      setEnrichProgress(p => ({ ...p, running: false }));
      fetchTransactions();
    }
  }, [enrichProgress.running, fetchTransactions]);

  const handleStopEnrich = () => {
    enrichAbortRef.current?.abort();
    setEnrichProgress(p => ({ ...p, running: false }));
  };

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">View and manage all extracted transactions</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.length > 0 && (
            <Button variant="outline" onClick={() => runEnrichment({ ids: selectedIds })} disabled={enrichProgress.running}>
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich Selected ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" onClick={() => runEnrichment({ enrichAll: true })} disabled={enrichProgress.running}>
            {enrichProgress.running ? <Spinner size="sm" className="mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Enrich All Unenriched
          </Button>
          <Button variant="outline" onClick={() => window.open('/api/transactions/export', '_blank')}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <StatsBar stats={stats} />

      {/* ── Enrichment progress panel ── */}
      {(enrichProgress.running || enrichProgress.batchNum > 0) && (
        <div className="rounded-lg border bg-gray-950 text-gray-100 text-xs font-mono p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              {enrichProgress.running
                ? <span className="text-yellow-400 animate-pulse">● Enriching...</span>
                : <span className="text-green-400">✓ Done</span>}
              {enrichProgress.batchNum > 1 && <span className="text-blue-400">Batch {enrichProgress.batchNum}</span>}
              <span className="text-gray-400">
                {enrichProgress.totalProcessed} enriched
                {enrichProgress.totalFailed > 0 && <> · <span className="text-red-400">{enrichProgress.totalFailed} skipped</span></>}
                {enrichProgress.total > 0 && <> · {enrichProgress.current}/{enrichProgress.total} this batch</>}
                {enrichProgress.running && enrichProgress.remaining > 0 && <> · <span className="text-yellow-300">{enrichProgress.remaining} remaining</span></>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {enrichProgress.running && (
                <button onClick={handleStopEnrich} className="flex items-center gap-1 text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-800 rounded">
                  <X className="h-3 w-3" /> Stop
                </button>
              )}
              {!enrichProgress.running && (
                <button onClick={() => setEnrichProgress(p => ({ ...p, batchNum: 0 }))} className="text-gray-500 hover:text-gray-300 px-1">×</button>
              )}
            </div>
          </div>
          {enrichProgress.total > 0 && (
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((enrichProgress.current / enrichProgress.total) * 100)}%` }} />
            </div>
          )}
          {enrichProgress.running && enrichProgress.currentDescription && (
            <div className="text-gray-400 truncate">Processing: <span className="text-gray-200">{enrichProgress.currentDescription}</span></div>
          )}
          {enrichProgress.lastLabel && (
            <div className="text-gray-500 truncate">Last enriched: <span className="text-green-400">{enrichProgress.lastLabel}</span></div>
          )}
        </div>
      )}

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-lg border">

        {/* Row 1: Search + FY (always visible) */}
        <div className="p-3 flex gap-2 items-center border-b">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search descriptions, merchants, notes..."
              className="pl-9"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
            />
            {filters.search && (
              <button onClick={() => setFilter('search', '')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* FY selector */}
          <Select
            value={currentFY}
            onValueChange={v => {
              const { date_from, date_to } = fyToDates(v);
              setFilters(f => ({ ...f, date_from, date_to, page: 1 }));
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {FY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              {currentFY === 'custom' && <SelectItem value="custom">Custom range</SelectItem>}
            </SelectContent>
          </Select>

          {/* More filters toggle */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors ${
              showAdvanced || activeCount > 0
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-muted-foreground hover:border-gray-300 hover:text-foreground'
            }`}
          >
            Filters
            {activeCount > 0 && (
              <span className="bg-blue-600 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">{activeCount}</span>
            )}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Row 2: Advanced filters (collapsible) */}
        {showAdvanced && (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 border-b">
            {/* Category */}
            <Select value={filters.category || 'all'} onValueChange={v => {
              const cat = v === 'all' ? '' : v;
              setFilters(f => ({ ...f, category: cat, sub_category: '', page: 1 }));
            }}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Sub-category — only enabled when category is selected */}
            <Select
              value={filters.sub_category || 'all'}
              onValueChange={v => setFilter('sub_category', v === 'all' ? '' : v)}
              disabled={!filters.category}
            >
              <SelectTrigger className={!filters.category ? 'opacity-40' : ''}>
                <SelectValue placeholder={filters.category ? 'Sub-category' : 'Select category first'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sub-categories</SelectItem>
                {subCategoryOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Type */}
            <Select value={filters.type || 'all'} onValueChange={v => setFilter('type', v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transactions</SelectItem>
                <SelectItem value="debit">Debits (money out)</SelectItem>
                <SelectItem value="credit">Credits (money in)</SelectItem>
              </SelectContent>
            </Select>

            {/* Status */}
            <Select
              value={filters.enriched ? `enriched:${filters.enriched}` : filters.flagged ? `flagged:${filters.flagged}` : 'all'}
              onValueChange={v => {
                const enriched = v.startsWith('enriched:') ? v.split(':')[1] : '';
                const flagged  = v.startsWith('flagged:')  ? v.split(':')[1] : '';
                setFilters(f => ({ ...f, enriched, flagged, page: 1 }));
              }}
            >
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="enriched:true">Enriched</SelectItem>
                <SelectItem value="enriched:false">Not enriched</SelectItem>
                <SelectItem value="flagged:true">Flagged</SelectItem>
              </SelectContent>
            </Select>

            {/* Amount range */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹</span>
                <Input type="number" min="0" placeholder="Min" className="pl-5 text-xs"
                  value={filters.amount_min} onChange={e => setFilter('amount_min', e.target.value)} />
              </div>
              <span className="text-muted-foreground text-xs flex-shrink-0">–</span>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹</span>
                <Input type="number" min="0" placeholder="Max" className="pl-5 text-xs"
                  value={filters.amount_max} onChange={e => setFilter('amount_max', e.target.value)} />
              </div>
            </div>

            {/* Custom date pickers — only shown when FY = custom */}
            {currentFY === 'custom' && (
              <>
                <Input type="date" value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} />
                <Input type="date" value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} />
              </>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {(chips.length > 0 || filters.search) && (
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
            {chips.map((chip, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {chip.label}
                <button
                  onClick={() => {
                    const updates: Partial<Filters> = { [chip.key]: '', page: 1 };
                    if (chip.pairKey) (updates as Record<string, unknown>)[chip.pairKey] = '';
                    // Also clear sub_category when clearing category
                    if (chip.key === 'category') updates.sub_category = '';
                    setFilters(f => ({ ...f, ...updates }));
                  }}
                  className="hover:text-blue-900 ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {(chips.length > 0) && (
              <button onClick={resetFilters} className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="xl" />
        </div>
      ) : (
        <TransactionsTable
          transactions={transactions}
          pagination={pagination}
          onPageChange={page => setFilters(f => ({ ...f, page }))}
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
