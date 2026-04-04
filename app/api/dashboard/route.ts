import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getCurrentFY() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

function getFYDates(fy: string) {
  const year = parseInt(fy.split('-')[0]);
  return { fyStart: `${year}-04-01`, fyEnd: `${year + 1}-03-31` };
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL!);
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || getCurrentFY();
  const { fyStart, fyEnd } = getFYDates(fy);

  const [agg, trend] = await Promise.all([
    sql(
      `WITH base AS (
        SELECT * FROM transactions
        WHERE user_id = $1 AND date >= $2 AND date <= $3
      ),
      income_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN category = 'Salary & Income' THEN amount END), 0)           AS salary,
          COALESCE(SUM(CASE WHEN category = 'Freelance & Work Income' THEN amount END), 0)   AS freelance,
          COALESCE(SUM(CASE WHEN category = 'Dividends & Returns' THEN amount END), 0)       AS dividends,
          COALESCE(SUM(CASE WHEN category = 'Cashback & Refund' THEN amount END), 0)         AS cashback,
          COALESCE(SUM(amount), 0)                                                            AS total
        FROM base WHERE type = 'credit'
      ),
      -- 80C instruments: ELSS/MF SIPs, life/term insurance, FD, NPS, PPF
      sec80c_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN category = 'Investments & Trading'
            AND (sub_category ILIKE '%Mutual Fund%' OR sub_category ILIKE '%ELSS%') THEN amount END), 0)   AS elss_mf,
          COALESCE(SUM(CASE WHEN category = 'Insurance'
            AND (sub_category ILIKE '%Life%' OR sub_category ILIKE '%Term%') THEN amount END), 0)          AS life_insurance,
          COALESCE(SUM(CASE WHEN category = 'Investments & Trading'
            AND (sub_category ILIKE '%Fixed Deposit%' OR sub_category ILIKE '%FD%'
                 OR sub_category ILIKE '%PPF%' OR sub_category ILIKE '%NSC%') THEN amount END), 0)         AS fd_ppf_nsc,
          COALESCE(SUM(CASE WHEN category = 'Investments & Trading'
            AND sub_category ILIKE '%NPS%' THEN amount END), 0)                                            AS nps
        FROM base WHERE type = 'debit'
      ),
      -- 80D: health insurance
      sec80d_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN category = 'Insurance'
            AND sub_category ILIKE '%Health%' THEN amount END), 0) AS health_premium
        FROM base WHERE type = 'debit'
      ),
      -- 24B: home loan EMIs (interest + principal; we track total as proxy)
      sec24b_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN category = 'EMI & Loans'
            AND (sub_category ILIKE '%Home Loan%' OR sub_category ILIKE '%Housing%') THEN amount END), 0) AS home_emi
        FROM base WHERE type = 'debit'
      ),
      -- 80E: education loan
      sec80e_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN category = 'EMI & Loans'
            AND sub_category ILIKE '%Education%' THEN amount END), 0) AS edu_emi
        FROM base WHERE type = 'debit'
      ),
      totals AS (
        SELECT
          COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0)  AS total_debits,
          COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_credits,
          COUNT(*) AS total_transactions
        FROM base
      ),
      enrichment_agg AS (
        SELECT
          COUNT(*) FILTER (WHERE enriched = true) AS enriched_count,
          COUNT(*) AS total_count
        FROM base
      )
      SELECT
        (SELECT row_to_json(income_agg) FROM income_agg)         AS income,
        (SELECT row_to_json(sec80c_agg) FROM sec80c_agg)         AS sec80c,
        (SELECT row_to_json(sec80d_agg) FROM sec80d_agg)         AS sec80d,
        (SELECT row_to_json(sec24b_agg) FROM sec24b_agg)         AS sec24b,
        (SELECT row_to_json(sec80e_agg) FROM sec80e_agg)         AS sec80e,
        (SELECT row_to_json(totals) FROM totals)                  AS totals,
        (SELECT row_to_json(enrichment_agg) FROM enrichment_agg) AS enrichment,

        -- Expense breakdown by category (debits, ordered by amount)
        (SELECT COALESCE(json_agg(e ORDER BY e.total DESC), '[]') FROM (
          SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS txn_count
          FROM base
          WHERE type = 'debit' AND category IS NOT NULL
          GROUP BY category
        ) e) AS expense_by_category,

        -- Investment sub-category breakdown
        (SELECT COALESCE(json_agg(i ORDER BY i.invested DESC), '[]') FROM (
          SELECT
            COALESCE(sub_category, 'Other') AS sub_category,
            COALESCE(merchant, '') AS platform,
            COALESCE(SUM(amount), 0) AS invested,
            COUNT(*) AS txn_count
          FROM base
          WHERE type = 'debit' AND category = 'Investments & Trading'
          GROUP BY sub_category, merchant
        ) i) AS investments,

        -- EMI breakdown by type
        (SELECT COALESCE(json_agg(em ORDER BY em.total_paid DESC), '[]') FROM (
          SELECT
            COALESCE(sub_category, 'Other Loan') AS sub_category,
            COALESCE(SUM(amount), 0) AS total_paid,
            COUNT(*) AS txn_count,
            COALESCE(AVG(amount), 0) AS avg_monthly
          FROM base
          WHERE type = 'debit' AND category = 'EMI & Loans'
          GROUP BY sub_category
        ) em) AS emi,

        -- Insurance breakdown by type
        (SELECT COALESCE(json_agg(ins ORDER BY ins.total_premium DESC), '[]') FROM (
          SELECT
            COALESCE(sub_category, 'Other Insurance') AS sub_category,
            COALESCE(SUM(amount), 0) AS total_premium,
            COUNT(*) AS payments
          FROM base
          WHERE type = 'debit' AND category = 'Insurance'
          GROUP BY sub_category
        ) ins) AS insurance`,
      [userId, fyStart, fyEnd]
    ),

    // Monthly income vs expense trend
    sql(
      `SELECT
        TO_CHAR(date_trunc('month', date), 'Mon') AS month,
        TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month_key,
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0)  AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_income
      FROM transactions
      WHERE user_id = $1 AND date >= $2 AND date <= $3
      GROUP BY date_trunc('month', date)
      ORDER BY date_trunc('month', date)`,
      [userId, fyStart, fyEnd]
    ),
  ]);

  const row = agg[0] as Record<string, unknown>;

  return NextResponse.json({
    fy,
    fyStart,
    fyEnd,
    income: row.income,
    sec80c: row.sec80c,
    sec80d: row.sec80d,
    sec24b: row.sec24b,
    sec80e: row.sec80e,
    totals: row.totals,
    enrichment: row.enrichment,
    expenseByCategory: row.expense_by_category,
    investments: row.investments,
    emi: row.emi,
    insurance: row.insurance,
    monthlyTrend: trend,
  });
}
