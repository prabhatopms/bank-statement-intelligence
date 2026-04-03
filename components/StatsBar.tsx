interface Stats {
  total: number;
  total_debits: number;
  total_credits: number;
  flagged_count: number;
  enriched_count: number;
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
      <p className={`text-xl font-bold mt-1 ${color ?? 'text-foreground'}`}>{value}</p>
    </div>
  );
}

export function StatsBar({ stats }: { stats: Stats }) {
  const enrichedPct = stats.total > 0 ? Math.round((stats.enriched_count / stats.total) * 100) : 0;
  const fmtINR = (n: number) => `₹${parseFloat(String(n || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <StatCard title="Total Transactions" value={stats.total?.toLocaleString() || 0} />
      <StatCard title="Total Debits" value={fmtINR(stats.total_debits)} color="text-red-600" />
      <StatCard title="Total Credits" value={fmtINR(stats.total_credits)} color="text-green-600" />
      <StatCard title="Flagged" value={stats.flagged_count || 0} color="text-yellow-600" />
      <StatCard title="Enriched" value={`${enrichedPct}%`} color="text-blue-600" />
    </div>
  );
}
