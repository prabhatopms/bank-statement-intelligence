import { StatsCard } from '@/lib/apollo-wind';

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
  const fmtINR = (n: number) => `₹${parseFloat(String(n || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <StatsCard
        title="Total Transactions"
        value={stats.total?.toLocaleString() || 0}
      />
      <StatsCard
        title="Total Debits"
        value={fmtINR(stats.total_debits)}
        variant="danger"
      />
      <StatsCard
        title="Total Credits"
        value={fmtINR(stats.total_credits)}
        variant="success"
      />
      <StatsCard
        title="Flagged"
        value={stats.flagged_count || 0}
        variant="warning"
      />
      <StatsCard
        title="Enriched"
        value={`${enrichedPct}%`}
        variant="primary"
      />
    </div>
  );
}
