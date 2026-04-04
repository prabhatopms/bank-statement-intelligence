"use client"

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Wallet, PiggyBank, ExternalLink, Info } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

// ─── types ───────────────────────────────────────────────────────────────────
interface DashboardData {
  fy: string;
  fyStart: string;
  fyEnd: string;
  income: { salary: number; freelance: number; dividends: number; cashback: number; total: number };
  sec80c: { elss_mf: number; life_insurance: number; fd_ppf_nsc: number; nps: number };
  sec80d: { health_premium: number };
  sec24b: { home_emi: number };
  sec80e: { edu_emi: number };
  totals: { total_debits: number; total_credits: number; total_transactions: number };
  enrichment: { enriched_count: number; total_count: number };
  expenseByCategory: { category: string; total: number; txn_count: number }[];
  investments: { sub_category: string; platform: string; invested: number; txn_count: number }[];
  emi: { sub_category: string; total_paid: number; txn_count: number; avg_monthly: number }[];
  insurance: { sub_category: string; total_premium: number; payments: number }[];
  monthlyTrend: { month: string; month_key: string; total_expense: number; total_income: number }[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmtINR = (n: number) =>
  '₹' + parseFloat(String(n || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const fmtINRFull = (n: number) =>
  '₹' + parseFloat(String(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const n = (v: unknown) => parseFloat(String(v || 0));

// Available Indian financial years (Apr–Mar)
const FY_OPTIONS = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];

const EXPENSE_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
  '#f59e0b', '#6366f1', '#10b981', '#ef4444', '#84cc16',
  '#06b6d4', '#a855f7',
];

// Categories that are financial commitments, not lifestyle spending
const NON_LIFESTYLE = new Set([
  'Investments & Trading', 'EMI & Loans', 'Insurance',
  'Wallet & Prepaid Top-up', 'Personal Transfer — Friend/Family',
  'ATM & Cash', 'Bank Charges & Fees', 'Dividends & Returns',
  'Cashback & Refund', 'Salary & Income', 'Freelance & Work Income',
]);

// ─── sub-components ───────────────────────────────────────────────────────────

function KpiCard({ title, value, subtitle, color, icon }: {
  title: string; value: string; subtitle?: string;
  color?: string; icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border p-5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</span>
        <span className="text-muted-foreground/60">{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${color ?? 'text-foreground'}`}>{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function TaxBar({ label, section, utilized, limit, breakdown, drillUrl, note }: {
  label: string; section: string; utilized: number; limit: number | null;
  breakdown?: { name: string; value: number }[];
  drillUrl: string; note?: string;
}) {
  const router = useRouter();
  const pct = limit ? Math.min((utilized / limit) * 100, 100) : 0;
  const remaining = limit ? Math.max(limit - utilized, 0) : null;
  const taxSaved = Math.round(Math.min(utilized, limit ?? utilized) * 0.30 * 1.04);
  const barColor = pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-500';

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{section}</span>
          <p className="font-semibold text-sm mt-1">{label}</p>
        </div>
        <button
          onClick={() => router.push(drillUrl)}
          className="text-muted-foreground hover:text-blue-600 flex-shrink-0 mt-0.5"
          title="View transactions"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{fmtINR(utilized)}</span>
          {limit && <span>Limit: {fmtINR(limit)}</span>}
        </div>
        {limit && (
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {breakdown && breakdown.length > 0 && (
        <div className="space-y-1">
          {breakdown.filter(b => b.value > 0).map(b => (
            <div key={b.name} className="flex justify-between text-xs text-muted-foreground">
              <span>{b.name}</span>
              <span className="font-medium text-foreground">{fmtINR(b.value)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t text-xs">
        <span className="text-green-700 font-medium">~{fmtINR(taxSaved)} tax saved <span className="text-muted-foreground font-normal">(30% slab)</span></span>
        {remaining !== null && remaining > 0 && (
          <span className="text-amber-600">{fmtINR(remaining)} unused</span>
        )}
        {remaining === 0 && <span className="text-green-600 font-medium">Limit fully utilised</span>}
      </div>

      {note && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          {note}
        </p>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [fy, setFy] = useState(() => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
  });
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (selectedFy: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?fy=${selectedFy}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(fy); }, [fy, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size="xl" />
      </div>
    );
  }

  if (!data) return null;

  const income = data.income;
  const totals = data.totals;
  const enrichment = data.enrichment;
  const enrichedPct = enrichment.total_count > 0
    ? Math.round((enrichment.enriched_count / enrichment.total_count) * 100)
    : 0;

  // 80C: ELSS/MF + life insurance + FD/PPF/NSC + NPS (cap at ₹1.5L)
  const s80c = data.sec80c;
  const s80cTotal = n(s80c.elss_mf) + n(s80c.life_insurance) + n(s80c.fd_ppf_nsc) + n(s80c.nps);

  // NPS 80CCD(1B): we assume NPS investment qualifies for extra ₹50K (cannot distinguish from data alone)
  const nps80ccd1b = Math.min(n(s80c.nps), 50000);

  // 80D: health insurance (₹25K limit — actual limit depends on age/family, showing ₹25K default)
  const s80dTotal = n(data.sec80d.health_premium);

  // 24B: home loan total EMI (proxy for interest; actual interest is ~60-80% of EMI early on)
  const s24bTotal = n(data.sec24b.home_emi);

  // 80E: education loan
  const s80eTotal = n(data.sec80e.edu_emi);

  const netSavings = n(totals.total_credits) - n(totals.total_debits);
  const savingsRate = n(totals.total_credits) > 0
    ? Math.round((netSavings / n(totals.total_credits)) * 100)
    : 0;

  // Expense categories (lifestyle only for the chart/breakdown)
  const lifestyleExpenses = (data.expenseByCategory || []).filter(e => !NON_LIFESTYLE.has(e.category));
  const totalLifestyleExpense = lifestyleExpenses.reduce((s, e) => s + n(e.total), 0);

  // Investment total
  const totalInvested = (data.investments || []).reduce((s, i) => s + n(i.invested), 0);

  // EMI total monthly (avg across types)
  const monthlyEMI = (data.emi || []).reduce((s, e) => s + n(e.avg_monthly), 0);

  return (
    <div className="space-y-8 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Financial Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            FY {data.fy} · {fmtINR(n(totals.total_transactions))} transactions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">Financial Year</label>
          <select
            value={fy}
            onChange={e => setFy(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {FY_OPTIONS.map(f => (
              <option key={f} value={f}>FY {f}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Enrichment banner ── */}
      {enrichedPct < 100 && enrichment.total_count > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-800">
              {enrichment.total_count - enrichment.enriched_count} of {enrichment.total_count} transactions not yet categorised ({100 - enrichedPct}%)
            </p>
            <p className="text-amber-700 mt-0.5">
              Tax deduction figures and category breakdowns may be incomplete.
            </p>
          </div>
          <button
            onClick={() => router.push('/transactions?enriched=false')}
            className="text-xs text-amber-700 border border-amber-300 rounded px-2 py-1 hover:bg-amber-100 whitespace-nowrap"
          >
            Enrich now →
          </button>
        </div>
      )}

      {/* ── Income KPI cards ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
          Income — FY {data.fy}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            title="Salary & Income"
            value={fmtINR(n(income.salary))}
            subtitle="Head: Salaries (Sec 17)"
            color="text-green-700"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiCard
            title="Freelance / Business"
            value={fmtINR(n(income.freelance))}
            subtitle="Head: PGBP or Other Sources"
            color="text-blue-700"
            icon={<Wallet className="h-4 w-4" />}
          />
          <KpiCard
            title="Dividends & Returns"
            value={fmtINR(n(income.dividends))}
            subtitle="Head: Other Sources"
            color="text-purple-700"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiCard
            title="Gross Income"
            value={fmtINR(n(income.total))}
            subtitle={`Savings rate: ${savingsRate > 0 ? savingsRate : 0}%`}
            color="text-foreground"
            icon={<PiggyBank className="h-4 w-4" />}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard
            title="Total Expenses (Debits)"
            value={fmtINR(n(totals.total_debits))}
            subtitle="All outflows including investments"
            color="text-red-600"
            icon={<TrendingDown className="h-4 w-4" />}
          />
          <KpiCard
            title="Net Savings"
            value={fmtINR(Math.abs(netSavings))}
            subtitle={netSavings >= 0 ? 'Credits exceed debits' : 'Debits exceed credits'}
            color={netSavings >= 0 ? 'text-green-700' : 'text-red-600'}
            icon={<PiggyBank className="h-4 w-4" />}
          />
          <KpiCard
            title="Lifestyle Spend"
            value={fmtINR(totalLifestyleExpense)}
            subtitle="Excluding investments, EMIs, insurance"
            color="text-orange-600"
            icon={<TrendingDown className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* ── Tax Planning ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
            Tax Deductions &amp; Instruments — Chapter VI-A
          </h2>
          <span className="text-[10px] text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded">
            Estimates based on enriched transaction categories
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TaxBar
            label="ELSS / MF SIP · Life Insurance · PPF · FD · NPS"
            section="Sec 80C"
            utilized={s80cTotal}
            limit={150000}
            breakdown={[
              { name: 'ELSS / Mutual Fund SIPs', value: n(s80c.elss_mf) },
              { name: 'Life / Term Insurance', value: n(s80c.life_insurance) },
              { name: 'FD / PPF / NSC', value: n(s80c.fd_ppf_nsc) },
              { name: 'NPS (via 80C)', value: Math.max(n(s80c.nps) - nps80ccd1b, 0) },
            ]}
            drillUrl="/transactions?category=Investments+%26+Trading"
            note="Only ELSS, 5-yr tax-saver FD, LIC, PPF, NSC, NPS, EPF qualify. Stocks/regular FDs do not."
          />

          <TaxBar
            label="Additional NPS Contribution"
            section="Sec 80CCD(1B)"
            utilized={nps80ccd1b}
            limit={50000}
            drillUrl="/transactions?category=Investments+%26+Trading"
            note="Extra ₹50,000 deduction over and above ₹1.5L 80C limit for NPS contributions."
          />

          <TaxBar
            label="Health Insurance Premium"
            section="Sec 80D"
            utilized={s80dTotal}
            limit={25000}
            breakdown={[
              { name: 'Self / Family premium', value: s80dTotal },
            ]}
            drillUrl="/transactions?category=Insurance"
            note="₹25K for self/family. ₹50K if senior citizen. Additional ₹25–50K for parents' policy."
          />

          <TaxBar
            label="Home Loan EMI (total)"
            section="Sec 24B"
            utilized={s24bTotal}
            limit={200000}
            drillUrl="/transactions?category=EMI+%26+Loans"
            note="Sec 24B allows ₹2L deduction on home loan INTEREST only for self-occupied property. EMI includes principal — actual interest is typically 50–70% of EMI."
          />

          {s80eTotal > 0 && (
            <TaxBar
              label="Education Loan Repayment"
              section="Sec 80E"
              utilized={s80eTotal}
              limit={null}
              drillUrl="/transactions?category=EMI+%26+Loans"
              note="Deduction on interest paid (not principal). No upper limit. Available for 8 years from first repayment."
            />
          )}

          {/* 80G placeholder */}
          <div className="bg-white rounded-lg border border-dashed p-4 space-y-2 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">Sec 80G / 80TTA</span>
              <p className="font-semibold text-sm mt-1">Donations &amp; Savings Interest</p>
              <p className="text-xs text-muted-foreground mt-2">
                80G (charitable donations) and 80TTA (savings account interest, ₹10K limit) are not auto-detectable from transaction data.
              </p>
            </div>
            <button
              onClick={() => router.push('/transactions?category=Government+%26+Tax')}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-2"
            >
              View tax-related transactions <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Monthly Trend ── */}
      {data.monthlyTrend.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
            Monthly Cash Flow — FY {data.fy}
          </h2>
          <div className="bg-white rounded-lg border p-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthlyTrend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`}
                  tick={{ fontSize: 11 }}
                  width={60}
                />
                <Tooltip
                  formatter={(value, name) => [
                    fmtINRFull(Number(value)),
                    name === 'total_income' ? 'Income' : 'Expenses',
                  ]}
                />
                <Legend formatter={v => v === 'total_income' ? 'Income' : 'Expenses'} />
                <Bar dataKey="total_income" fill="#22c55e" radius={[3, 3, 0, 0]} name="total_income" />
                <Bar dataKey="total_expense" fill="#ef4444" radius={[3, 3, 0, 0]} name="total_expense" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── Expense Breakdown ── */}
      {data.expenseByCategory.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
            Spending Breakdown
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Donut chart */}
            <div className="bg-white rounded-lg border p-4">
              <p className="text-sm font-medium mb-2">By category (debits)</p>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={data.expenseByCategory.slice(0, 12)}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    onClick={(d) => {
                      const cat = (d as unknown as { category: string }).category;
                      if (cat) router.push(`/transactions?category=${encodeURIComponent(cat)}`);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {data.expenseByCategory.slice(0, 12).map((_, i) => (
                      <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmtINR(Number(v))} />
                  <Legend
                    formatter={v => v.length > 22 ? v.slice(0, 22) + '…' : v}
                    wrapperStyle={{ fontSize: '11px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Ranked list */}
            <div className="bg-white rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium mb-3">All categories</p>
              {data.expenseByCategory.map((e, i) => {
                const totalAll = data.expenseByCategory.reduce((s, c) => s + n(c.total), 0);
                const pct = totalAll > 0 ? (n(e.total) / totalAll) * 100 : 0;
                return (
                  <button
                    key={e.category}
                    className="w-full text-left hover:bg-gray-50 rounded px-1 -mx-1 py-1"
                    onClick={() => router.push(`/transactions?category=${encodeURIComponent(e.category)}`)}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium truncate flex-1">{e.category}</span>
                      <span className="text-muted-foreground ml-2 whitespace-nowrap">
                        {fmtINR(n(e.total))} · {e.txn_count} txns
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1">
                      <div
                        className="h-1 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Investments ── */}
      {data.investments && data.investments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
            Investment Portfolio — FY {data.fy}
          </h2>
          <div className="bg-white rounded-lg border divide-y">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Total Invested</span>
              <span className="text-lg font-bold text-blue-700">{fmtINR(totalInvested)}</span>
            </div>
            {data.investments.map((inv, i) => (
              <button
                key={i}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                onClick={() => router.push(`/transactions?category=${encodeURIComponent('Investments & Trading')}`)}
              >
                <div>
                  <p className="text-sm font-medium">{inv.sub_category}</p>
                  {inv.platform && inv.platform !== inv.sub_category && (
                    <p className="text-xs text-muted-foreground">{inv.platform}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtINR(n(inv.invested))}</p>
                  <p className="text-xs text-muted-foreground">{inv.txn_count} transactions</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── EMI & Insurance ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* EMI tracker */}
        {data.emi && data.emi.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
              Loans &amp; EMI Tracker
            </h2>
            <div className="bg-white rounded-lg border divide-y">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Avg monthly EMI burden</span>
                <span className="font-bold text-red-600">{fmtINR(monthlyEMI)}</span>
              </div>
              {data.emi.map((e, i) => (
                <button
                  key={i}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                  onClick={() => router.push(`/transactions?category=${encodeURIComponent('EMI & Loans')}`)}
                >
                  <div>
                    <p className="text-sm font-medium">{e.sub_category}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.txn_count} payments · avg {fmtINR(n(e.avg_monthly))}/mo
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{fmtINR(n(e.total_paid))}</p>
                    <p className="text-xs text-muted-foreground">this FY</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Insurance */}
        {data.insurance && data.insurance.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
              Insurance Premiums
            </h2>
            <div className="bg-white rounded-lg border divide-y">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Total premiums paid</span>
                <span className="font-bold text-purple-700">
                  {fmtINR(data.insurance.reduce((s, ins) => s + n(ins.total_premium), 0))}
                </span>
              </div>
              {data.insurance.map((ins, i) => {
                const is80D = ins.sub_category?.toLowerCase().includes('health');
                const is80C = ins.sub_category?.toLowerCase().includes('life') || ins.sub_category?.toLowerCase().includes('term');
                return (
                  <button
                    key={i}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                    onClick={() => router.push(`/transactions?category=${encodeURIComponent('Insurance')}`)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{ins.sub_category}</p>
                        {is80D && <Badge variant="outline" className="text-[10px] py-0">80D</Badge>}
                        {is80C && <Badge variant="outline" className="text-[10px] py-0">80C</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{ins.payments} payments this FY</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{fmtINR(n(ins.total_premium))}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ── Empty state ── */}
      {n(totals.total_transactions) === 0 && (
        <div className="text-center py-16 text-muted-foreground border rounded-lg bg-white">
          <p className="font-medium">No transactions found for FY {data.fy}</p>
          <p className="text-sm mt-1">Upload bank statements and extract transactions to see your dashboard.</p>
          <button
            onClick={() => router.push('/documents')}
            className="mt-4 text-blue-600 text-sm hover:underline"
          >
            Go to Documents →
          </button>
        </div>
      )}

    </div>
  );
}
