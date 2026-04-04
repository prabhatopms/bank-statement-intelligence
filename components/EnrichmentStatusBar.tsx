"use client"

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Play, Pause, RotateCcw, X, CheckCircle2 } from 'lucide-react';

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
  const [dismissed, setDismissed] = useState(false);
  const [toggling, setToggling] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/enrichment/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 10_000); // poll every 10s
    return () => clearInterval(interval);
  }, [poll]);

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

  if (!status || dismissed) return null;

  const { enabled, totalUnenriched, totalTransactions, processedCount, failedCount, lastLabel, lastError, failedIds } = status;
  const enrichedCount = totalTransactions - totalUnenriched;
  const enrichedPct = totalTransactions > 0 ? Math.round((enrichedCount / totalTransactions) * 100) : 0;

  // Nothing to show if everything is enriched and no failures
  if (totalUnenriched === 0 && failedCount === 0 && !status.status) return null;

  // All done — show a brief success state then hide
  if (totalUnenriched === 0 && failedIds === 0) {
    return (
      <div className="bg-green-50 border-b border-green-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            <span>All {totalTransactions.toLocaleString()} transactions enriched</span>
            {processedCount > 0 && (
              <span className="text-green-600/70">({processedCount} this session)</span>
            )}
          </div>
          <button onClick={() => setDismissed(true)} className="text-green-600 hover:text-green-800">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const isRunning = enabled && status.status === 'running';

  return (
    <div className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex items-center justify-between gap-4">

          {/* Left: status info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Sparkles className={`h-4 w-4 flex-shrink-0 ${enabled ? 'text-yellow-400' : 'text-gray-500'}`} />

            <div className="min-w-0 flex items-center gap-2 text-xs">
              {/* Progress */}
              <span className="text-gray-300 whitespace-nowrap">
                <span className="font-medium text-white">{enrichedPct}%</span> enriched
                <span className="text-gray-500 ml-1">
                  ({enrichedCount}/{totalTransactions})
                </span>
              </span>

              {/* Progress bar */}
              <div className="w-24 bg-gray-700 rounded-full h-1.5 flex-shrink-0 hidden sm:block">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${enabled ? 'bg-yellow-400' : 'bg-gray-500'}`}
                  style={{ width: `${enrichedPct}%` }}
                />
              </div>

              {totalUnenriched > 0 && (
                <span className="text-yellow-400/80 whitespace-nowrap hidden md:inline">
                  {totalUnenriched} remaining
                </span>
              )}

              {processedCount > 0 && (
                <span className="text-green-400/80 whitespace-nowrap hidden lg:inline">
                  +{processedCount} done
                </span>
              )}

              {failedIds > 0 && (
                <span className="text-red-400/80 whitespace-nowrap hidden md:inline">
                  {failedIds} stuck
                </span>
              )}

              {/* Current activity */}
              {isRunning && lastLabel && (
                <span className="text-gray-500 truncate hidden xl:inline">
                  Last: <span className="text-gray-400">{lastLabel}</span>
                </span>
              )}

              {lastError && !isRunning && (
                <span className="text-red-400/70 truncate hidden lg:inline" title={lastError}>
                  Error: {lastError.slice(0, 40)}
                </span>
              )}

              {isRunning && (
                <span className="text-yellow-400 animate-pulse whitespace-nowrap">
                  ● auto-enriching
                </span>
              )}
              {enabled && !isRunning && totalUnenriched > 0 && (
                <span className="text-gray-500 whitespace-nowrap">
                  waiting for next run...
                </span>
              )}
              {!enabled && totalUnenriched > 0 && (
                <span className="text-gray-500 whitespace-nowrap">paused</span>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {failedIds > 0 && (
              <button
                onClick={retryFailed}
                disabled={toggling}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 border border-gray-700 rounded hover:border-amber-600 transition-colors"
                title="Retry stuck transactions"
              >
                <RotateCcw className="h-3 w-3" />
                <span className="hidden sm:inline">Retry</span>
              </button>
            )}

            {enabled ? (
              <button
                onClick={() => toggle(false)}
                disabled={toggling}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 px-2 py-1 border border-gray-700 rounded hover:border-red-700 transition-colors"
                title="Pause auto-enrichment"
              >
                <Pause className="h-3 w-3" />
                <span className="hidden sm:inline">Pause</span>
              </button>
            ) : (
              <button
                onClick={() => toggle(true)}
                disabled={toggling}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 px-2 py-1 border border-gray-700 rounded hover:border-green-600 transition-colors"
                title="Resume auto-enrichment"
              >
                <Play className="h-3 w-3" />
                <span className="hidden sm:inline">Resume</span>
              </button>
            )}

            <button
              onClick={() => setDismissed(true)}
              className="text-gray-600 hover:text-gray-400 px-1"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
