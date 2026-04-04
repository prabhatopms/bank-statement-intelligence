"use client"

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Play, Pause, RotateCcw, Zap, CheckCircle2, AlertCircle } from 'lucide-react';

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

export function EnrichmentStatusBar() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [manualRunning, setManualRunning] = useState(false);
  const [manualProgress, setManualProgress] = useState<{
    current: number; total: number; processed: number; failed: number; lastLabel: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Also poll faster while manual enrichment is running
  useEffect(() => {
    if (!manualRunning) return;
    const fast = setInterval(poll, 3_000);
    return () => clearInterval(fast);
  }, [manualRunning, poll]);

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

  // Manual "Run Now" — streams enrichment directly from the browser,
  // same as the bulk enrich on transactions page but headless
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
                const remaining: number = ev.remaining ?? 0;
                shouldContinue = remaining > 0;
              }
            } catch { /* skip */ }
          }
        }
        if (!batchDone) shouldContinue = false;
      }
    } catch {
      // aborted or network error
    }

    setManualRunning(false);
    setManualProgress(null);
    await poll();
  };

  const stopManual = () => {
    abortRef.current?.abort();
    setManualRunning(false);
    setManualProgress(null);
  };

  // ── Render ──

  // While loading initial status, show a minimal skeleton
  if (!status) {
    return (
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 text-xs text-gray-500">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Loading enrichment status...
        </div>
      </div>
    );
  }

  const { enabled, totalUnenriched, totalTransactions, processedCount, failedCount, lastLabel, lastError, failedIds } = status;

  // Nothing at all — no transactions yet
  if (totalTransactions === 0) {
    return (
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 text-xs text-gray-500">
          <Sparkles className="h-4 w-4" />
          No transactions yet. Upload a bank statement to get started.
        </div>
      </div>
    );
  }

  const enrichedCount = totalTransactions - totalUnenriched;
  const enrichedPct = totalTransactions > 0 ? Math.round((enrichedCount / totalTransactions) * 100) : 0;
  const allDone = totalUnenriched === 0 && failedIds === 0;
  const isRunning = manualRunning || (enabled && status.status === 'running');

  return (
    <div className={`border-b ${allDone ? 'bg-green-950 border-green-900' : 'bg-gray-900 border-gray-800'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex items-center justify-between gap-4">

          {/* Left: status info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {allDone
              ? <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
              : <Sparkles className={`h-4 w-4 flex-shrink-0 ${isRunning ? 'text-yellow-400 animate-pulse' : enabled ? 'text-yellow-400' : 'text-gray-500'}`} />
            }

            <div className="min-w-0 flex items-center gap-2.5 text-xs flex-wrap">
              {/* Overall progress */}
              <span className={allDone ? 'text-green-300 whitespace-nowrap' : 'text-gray-300 whitespace-nowrap'}>
                <span className="font-semibold text-white">{enrichedPct}%</span> enriched
                <span className="text-gray-500 ml-1">({enrichedCount.toLocaleString()}/{totalTransactions.toLocaleString()})</span>
              </span>

              {/* Progress bar */}
              <div className="w-28 bg-gray-700 rounded-full h-1.5 flex-shrink-0">
                <div
                  className={`h-1.5 rounded-full transition-all duration-700 ${allDone ? 'bg-green-400' : isRunning ? 'bg-yellow-400' : 'bg-gray-500'}`}
                  style={{ width: `${enrichedPct}%` }}
                />
              </div>

              {/* Manual run progress */}
              {manualRunning && manualProgress && (
                <span className="text-yellow-400 whitespace-nowrap">
                  {manualProgress.processed + manualProgress.failed}/{manualProgress.total} this batch
                  {manualProgress.lastLabel && (
                    <span className="text-gray-400 ml-1 hidden lg:inline">· {manualProgress.lastLabel}</span>
                  )}
                </span>
              )}

              {/* Stats when not manually running */}
              {!manualRunning && (
                <>
                  {totalUnenriched > 0 && (
                    <span className="text-yellow-400/80 whitespace-nowrap">
                      {totalUnenriched.toLocaleString()} remaining
                    </span>
                  )}

                  {processedCount > 0 && !allDone && (
                    <span className="text-green-400/80 whitespace-nowrap hidden md:inline">
                      +{processedCount} auto-enriched
                    </span>
                  )}

                  {failedIds > 0 && (
                    <span className="text-red-400/80 whitespace-nowrap flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {failedIds} stuck
                    </span>
                  )}

                  {lastError && !isRunning && (
                    <span className="text-red-400/60 truncate hidden lg:inline" title={lastError}>
                      {lastError.slice(0, 50)}
                    </span>
                  )}
                </>
              )}

              {/* Activity indicator */}
              {allDone && <span className="text-green-400 whitespace-nowrap">All done</span>}
              {!allDone && isRunning && !manualRunning && (
                <span className="text-yellow-400/70 whitespace-nowrap hidden sm:inline">auto-enriching...</span>
              )}
              {!allDone && !isRunning && !manualRunning && enabled && totalUnenriched > 0 && (
                <span className="text-gray-600 whitespace-nowrap hidden sm:inline">next run in ~1 min</span>
              )}
              {!allDone && !enabled && !manualRunning && (
                <span className="text-gray-600 whitespace-nowrap">paused</span>
              )}
            </div>
          </div>

          {/* Right: controls — ALWAYS visible */}
          <div className="flex items-center gap-1.5 flex-shrink-0">

            {/* Run Now / Stop */}
            {!allDone && !manualRunning && (
              <button
                onClick={runNow}
                disabled={toggling}
                className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 border border-gray-700 rounded hover:border-yellow-600 transition-colors font-medium"
                title="Run enrichment now from browser"
              >
                <Zap className="h-3 w-3" />
                <span className="hidden sm:inline">Run now</span>
              </button>
            )}
            {manualRunning && (
              <button
                onClick={stopManual}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-gray-700 rounded hover:border-red-600 transition-colors"
              >
                <Pause className="h-3 w-3" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            )}

            {/* Retry failed */}
            {failedIds > 0 && !manualRunning && (
              <button
                onClick={retryFailed}
                disabled={toggling}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 border border-gray-700 rounded hover:border-amber-600 transition-colors"
                title="Clear stuck list and retry"
              >
                <RotateCcw className="h-3 w-3" />
                <span className="hidden sm:inline">Retry</span>
              </button>
            )}

            {/* Background toggle — pause/resume the cron */}
            {!allDone && !manualRunning && (
              enabled ? (
                <button
                  onClick={() => toggle(false)}
                  disabled={toggling}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 px-2 py-1 border border-gray-700 rounded hover:border-red-700 transition-colors"
                  title="Pause background auto-enrichment"
                >
                  <Pause className="h-3 w-3" />
                  <span className="hidden sm:inline">Auto: on</span>
                </button>
              ) : (
                <button
                  onClick={() => toggle(true)}
                  disabled={toggling}
                  className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 px-2 py-1 border border-gray-700 rounded hover:border-green-600 transition-colors"
                  title="Resume background auto-enrichment"
                >
                  <Play className="h-3 w-3" />
                  <span className="hidden sm:inline">Auto: off</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
