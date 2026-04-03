import { TrendingUp, BarChart3, PieChart, ArrowUpRight, Info } from 'lucide-react';

export default function InvestmentsPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-green-600" />
          Investments
        </h1>
        <p className="text-muted-foreground mt-1">
          Track your investment portfolio derived from bank statement transactions
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 space-y-1">
          <p className="font-medium">Coming soon</p>
          <p>
            Once your transactions are enriched, this page will automatically surface your investment activity —
            SIPs, mutual fund purchases, stock trades, dividends, and returns — aggregated by platform and asset class.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: <BarChart3 className="h-8 w-8 text-blue-500" />,
            title: 'Portfolio Overview',
            desc: 'Total invested, current value, and returns across all platforms (Groww, Zerodha, Upstox, etc.)',
          },
          {
            icon: <PieChart className="h-8 w-8 text-purple-500" />,
            title: 'Asset Allocation',
            desc: 'Breakdown by asset class — mutual funds, stocks, gold, FDs, NPS — from your transaction history.',
          },
          {
            icon: <ArrowUpRight className="h-8 w-8 text-green-500" />,
            title: 'SIP Tracker',
            desc: 'Monthly SIP investments tracked over time, with amount and frequency from ACH/NACH debits.',
          },
        ].map(card => (
          <div key={card.title} className="bg-white rounded-lg border p-5 opacity-60 space-y-3">
            {card.icon}
            <h3 className="font-semibold">{card.title}</h3>
            <p className="text-sm text-muted-foreground">{card.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">How it will work</h2>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">1</span>
            <span>Upload your bank statements on the <strong className="text-foreground">Documents</strong> page and extract transactions.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">2</span>
            <span>Enrich transactions on the <strong className="text-foreground">Transactions</strong> page — AI will categorise investment activity automatically.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">3</span>
            <span>This page will aggregate all transactions in the <strong className="text-foreground">Investments & Trading</strong> and <strong className="text-foreground">Dividends & Returns</strong> categories into a portfolio view.</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
