"use client"

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Play, Pause, RotateCcw, Zap, CheckCircle2, AlertCircle, X } from 'lucide-react';

interface EnrichmentStatus {
  enabled: boolean;
  status: 'idle' | 'running' | 'paused';
  processedCount: number;
  failedCount: number;
  totalUnenriched: number;
  totalTransactions: number;
  lastLabel: string | null;
  lastError: string | null;
  lastRunAt: string | null;
  failedIds: number;
}

export function EnrichmentIndicator() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [manualRunning, setManualRunning] = useState(false);
  const [manualProgress, setManualProgress] = useState<{
    current: number; total: number; processed: number; failed: number; lastLabel: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/enrichment/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 8_000);
    return () => clearInterval(interval);
  }, [poll]);

  // Poll faster during manual run
  useEffect(() => {
    if (!manualRunning) return;
    const fast = setInterval(poll, 3_000);
    return () => clearInterval(fast);
  }, [manualRunning, poll]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await fetch('/api/enrichment/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await poll();
    } finally {
      setToggling(false);
    }
  };

  const retryFailed = async () => {
    setToggling(true);
    try {
      await fetch('/api/enrichment/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetFailed: true }),
      });
      await poll();
    } finally {
      setToggling(false);
    }
  };

  const runNow = async () => {
    if (manualRunning) return;
    setManualRunning(true);
    setManualProgress({ current: 0, total: 0, processed: 0, failed: 0, lastLabel: '' });

    const controller = new AbortController();
    abortRef.current = controller;
    const allFailedIds: string[] = [];
    let totalProcessed = 0, totalFailed = 0;
    let shouldContinue = true;

    try {
      while (shouldContinue && !controller.signal.aborted) {
        const res = await fetch('/api/transactions/enrich-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrichAll: true, excludeIds: allFailedIds, limit: 50 }),
          signal: controller.signal,
        });
        if (!res.body) break;

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
                setManualProgress(p => p ? { ...p, total: ev.total } : p);
              } else if (ev.type === 'progress') {
                setManualProgress(p => p ? { ...p, current: ev.current, total: ev.total } : p);
              } else if (ev.type === 'enriched') {
                totalProcessed++;
                setManualProgress(p => p ? { ...p, processed: totalProcessed, lastLabel: ev.label } : p);
              } else if (ev.type === 'failed') {
                totalFailed++;
                allFailedIds.push(ev.id);
                setManualProgress(p => p ? { ...p, failed: totalFailed } : p);
              } else if (ev.type === 'done') {
                batchDone = true;
                shouldContinue = (ev.remaining ?? 0) > 0;
              }
            } catch { /* skip */ }
          }
        }
        if (!batchDone) shouldContinue = false;
      }
    } catch { /* aborted or error */ }

    setManualRunning(false);
    setManualProgress(null);
    await poll();
  };

  const stopManual = () => {
    abortRef.current?.abort();
    setManualRunning(false);
    setManualProgress(null);
  };

  // ── Derived state ──
  const totalTransactions = status?.totalTransactions ?? 0;
  const totalUnenriched = status?.totalUnenriched ?? 0;
  const enrichedCount = totalTransactions - totalUnenriched;
  const enrichedPct = totalTransactions > 0 ? Math.round((enrichedCount / totalTransactions) * 100) : 0;
  const allDone = totalTransactions > 0 && totalUnenriched === 0 && (status?.failedIds ?? 0) === 0;
  const isActive = manualRunning || (status?.enabled && status?.status === 'running');
  const hasIssues = (status?.failedIds ?? 0) > 0 || !!status?.lastError;

  // ── Icon color ──
  let iconColor = 'text-gray-400'; // idle / no data
  let ringClass = '';
  if (manualRunning)     { iconColor = 'text-yellow-500'; ringClass = 'animate-spin'; }
  else if (allDone)      { iconColor = 'text-green-500'; }
  else if (hasIssues)    { iconColor = 'text-red-400'; }
  else if (isActive)     { iconColor = 'text-yellow-500 animate-pulse'; }
  else if (totalUnenriched > 0 && status?.enabled) { iconColor = 'text-yellow-500'; }

  return (
    <div className="relative" ref={popoverRef}>
      {/* ── The icon button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors ${iconColor}`}
        title="Enrichment status"
      >
        <Sparkles className={`h-4 w-4 ${ringClass}`} />

        {/* Badge dot */}
        {totalTransactions > 0 && !allDone && (
          <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
            manualRunning ? 'bg-yellow-500 animate-pulse'
            : hasIssues ? 'bg-red-500'
            : isActive ? 'bg-yellow-500 animate-pulse'
            : totalUnenriched > 0 ? 'bg-yellow-500'
            : 'bg-green-500'
          }`} />
        )}
        {allDone && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-green-500" />
        )}
      </button>

      {/* ── Popover ── */}
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white rounded-lg shadow-xl border z-[100] overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold text-sm">Enrichment</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* No transactions state */}
          {totalTransactions === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No transactions yet. Upload a bank statement to get started.
            </div>
          )}

          {/* Progress section */}
          {totalTransactions > 0 && (
            <div className="px-4 py-3 space-y-3">

              {/* Overall progress */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">Overall progress</span>
                  <span className="text-xs font-semibold">{enrichedPct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${allDone ? 'bg-green-500' : isActive ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${enrichedPct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[11px] text-muted-foreground">
                  <span>{enrichedCount.toLocaleString()} enriched</span>
                  <span>{totalTransactions.toLocaleString()} total</span>
                </div>
              </div>

              {/* Status rows */}
              <div className="space-y-1.5 text-xs">
                {allDone && (
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded px-2 py-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    All transactions enriched
                  </div>
                )}

                {totalUnenriched > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Remaining</span>
                    <span className="font-medium text-foreground">{totalUnenriched.toLocaleString()}</span>
                  </div>
                )}

                {(status?.processedCount ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Auto-enriched (this cycle)</span>
                    <span className="font-medium text-green-600">+{status!.processedCount}</span>
                  </div>
                )}

                {(status?.failedIds ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-red-600">
                    <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Stuck</span>
                    <span className="font-medium">{status!.failedIds}</span>
                  </div>
                )}

                {status?.lastError && (
                  <div className="text-red-500 bg-red-50 rounded px-2 py-1.5 truncate" title={status.lastError}>
                    {status.lastError}
                  </div>
                )}

                {status?.lastLabel && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Last enriched</span>
                    <span className="font-medium text-foreground truncate ml-2 max-w-[140px]" title={status.lastLabel}>
                      {status.lastLabel}
                    </span>
                  </div>
                )}

                {status?.lastRunAt && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Last cron run</span>
                    <span className="font-medium text-foreground">
                      {timeAgo(status.lastRunAt)}
                    </span>
                  </div>
                )}

                {/* Manual run progress */}
                {manualRunning && manualProgress && (
                  <div className="bg-yellow-50 rounded px-2 py-1.5 space-y-1">
                    <div className="flex items-center justify-between font-medium text-yellow-700">
                      <span>Running now...</span>
                      <span>{manualProgress.processed + manualProgress.failed}/{manualProgress.total}</span>
                    </div>
                    {manualProgress.lastLabel && (
                      <div className="text-yellow-600 truncate">{manualProgress.lastLabel}</div>
                    )}
                    <div className="w-full bg-yellow-200 rounded-full h-1">
                      <div
                        className="h-1 rounded-full bg-yellow-500 transition-all"
                        style={{ width: manualProgress.total > 0 ? `${Math.round((manualProgress.current / manualProgress.total) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Background auto-enrich status line */}
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground border-t pt-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  status?.enabled ? 'bg-green-500' : 'bg-gray-300'
                }`} />
                Background auto-enrich: {status?.enabled ? 'on' : 'off'}
                {status?.enabled && !isActive && totalUnenriched > 0 && (
                  <span className="ml-auto text-gray-400">runs every ~1 min</span>
                )}
                {isActive && !manualRunning && (
                  <span className="ml-auto text-yellow-600 animate-pulse">running...</span>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {totalTransactions > 0 && !allDone && (
            <div className="px-4 py-2.5 bg-gray-50 border-t flex items-center gap-2">
              {!manualRunning ? (
                <button
                  onClick={runNow}
                  className="flex items-center gap-1.5 text-xs font-medium bg-yellow-500 text-white px-3 py-1.5 rounded-md hover:bg-yellow-600 transition-colors"
                >
                  <Zap className="h-3 w-3" />
                  Run now
                </button>
              ) : (
                <button
                  onClick={stopManual}
                  className="flex items-center gap-1.5 text-xs font-medium bg-red-500 text-white px-3 py-1.5 rounded-md hover:bg-red-600 transition-colors"
                >
                  <Pause className="h-3 w-3" />
                  Stop
                </button>
              )}

              {(status?.failedIds ?? 0) > 0 && !manualRunning && (
                <button
                  onClick={retryFailed}
                  disabled={toggling}
                  className="flex items-center gap-1.5 text-xs text-amber-700 border border-amber-300 bg-amber-50 px-2.5 py-1.5 rounded-md hover:bg-amber-100 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry stuck
                </button>
              )}

              <div className="ml-auto">
                {!manualRunning && (
                  status?.enabled ? (
                    <button
                      onClick={() => toggle(false)}
                      disabled={toggling}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Pause className="h-3 w-3" />
                      Pause auto
                    </button>
                  ) : (
                    <button
                      onClick={() => toggle(true)}
                      disabled={toggling}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors"
                    >
                      <Play className="h-3 w-3" />
                      Enable auto
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
