interface Stats {
  total: number;
  total_debits: number;
  total_credits: number;
  flagged_count: number;
  enriched_count: number;
}

interface StatsBarProps {
  stats: Stats;
}

export function StatsBar({ stats }: StatsBarProps) {
  const enrichedPct = stats.total > 0 ? Math.round((stats.enriched_count / stats.total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold">{stats.total?.toLocaleString() || 0}</div>
        <div className="text-sm text-muted-foreground mt-1">Total Transactions</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-red-600">
          &#8377;{parseFloat(String(stats.total_debits || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">Total Debits</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-green-600">
          &#8377;{parseFloat(String(stats.total_credits || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">Total Credits</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-yellow-600">{stats.flagged_count || 0}</div>
        <div className="text-sm text-muted-foreground mt-1">Flagged</div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <div className="text-2xl font-bold text-blue-600">{enrichedPct}%</div>
        <div className="text-sm text-muted-foreground mt-1">Enriched</div>
      </div>
    </div>
  );
}
