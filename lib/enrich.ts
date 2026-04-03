import sql from '@/lib/db';

export interface EnrichResult {
  label: string;
  merchant: string;
  website: string;
  category: string;
  sub_category: string;
  transaction_type: string;
  recipient_type: string;
  payment_app: string;
  flagged: boolean;
  flag_reason: string;
  notes: string;
}

interface TxInput {
  id: string;
  description: string;
  amount: number | string;
  currency: string;
  type: string;
  mode?: string | null;
  counterparty?: string | null;
  upi_id?: string | null;
  reference_number?: string | null;
  flagged?: boolean;
  flag_reason?: string | null;
}

const CATEGORIES = [
  'Food & Dining', 'Travel & Transport', 'Shopping', 'Utilities & Bills',
  'Healthcare', 'Entertainment', 'Finance & Investment', 'Income & Salary',
  'Personal Transfer', 'EMI & Loans', 'ATM & Cash', 'Subscriptions',
  'Insurance', 'Education', 'Government & Tax', 'Other',
];

async function geminiText(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set');
  const BASE = 'https://generativelanguage.googleapis.com';
  for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (text) return text;
  }
  throw new Error('Gemini enrichment failed — check GOOGLE_GENERATIVE_AI_API_KEY');
}

export async function enrichTransaction(tx: TxInput): Promise<EnrichResult> {
  const prompt = `You are analyzing an Indian bank transaction. Extract rich details so the account holder can easily understand what this transaction is about.

Transaction details:
- Raw bank description: "${tx.description}"
- Amount: ₹${tx.amount} (${tx.type === 'debit' ? 'Debit / Money going OUT' : 'Credit / Money coming IN'})
- Transaction mode: ${tx.mode || 'Unknown'}
- Counterparty name on bank record: ${tx.counterparty || 'Not specified'}
- UPI ID (if any): ${tx.upi_id || 'N/A'}

Return ONLY a raw JSON object with NO markdown, no explanation, no code fences:
{
  "label": "3-6 word human label, e.g.: 'Swiggy food delivery', 'Maid salary January', 'HDFC credit card bill', 'Rent payment to landlord', 'Amazon shopping', 'Electricity bill BSES', 'GPay transfer to Rahul', 'PhonePe recharge Jio', 'SIP Axis Mutual Fund', 'ATM cash withdrawal'",
  "merchant": "Cleaned merchant or recipient name. For UPI to individual, use the person name from counterparty or UPI ID. For businesses use their proper brand name.",
  "website": "Official website URL only if you are confident (e.g. swiggy.com, zomato.com, amazon.in). Empty string if unknown.",
  "category": "Pick exactly one: ${CATEGORIES.join(' | ')}",
  "sub_category": "More specific, e.g.: Food Delivery, Grocery, Restaurant, Cafe, Cab/Taxi, Auto, Metro, Bus, Train Ticket, Flight, Hotel, Online Shopping, Clothing, Electronics, Household Items, Electricity Bill, Mobile Recharge, Internet/Broadband, Water Bill, Gas Bill, Doctor Visit, Pharmacy, Hospital, Lab Test, OTT Subscription, Movie Ticket, Gaming, Mutual Fund/SIP, Stocks/Shares, FD/RD, Salary, Freelance Income, Business Income, Rent Payment, Domestic Help Salary, Property Tax, Home Loan EMI, Car Loan EMI, Personal Loan EMI, Credit Card Bill, ATM Withdrawal, Cash Deposit, School/College Fees, Insurance Premium, GPay/PhonePe Self Transfer, etc.",
  "transaction_type": "Pick one: UPI Payment | NEFT | IMPS | RTGS | ATM Withdrawal | Cash Deposit | Salary Credit | EMI Debit | Interest Credit | Cashback | Refund | Bill Payment | Bank Transfer | Card Payment | Cheque | Standing Instruction | Other",
  "recipient_type": "Pick one: Individual | Business | Bank/NBFC | Government | Self/Own Account",
  "payment_app": "Payment app if identifiable from description or UPI ID: GPay | PhonePe | Paytm | Amazon Pay | BHIM | CRED | Groww | Zerodha | Upstox | Jupiter | Fi Money | Slice | Other. Empty string if not identifiable.",
  "flagged": ${tx.flagged ? 'true' : 'false'},
  "flag_reason": "Non-empty string ONLY if suspicious (unusually large unexplained amount, unknown source, potential fraud, test/dummy transactions). Otherwise empty string.",
  "notes": "One complete sentence in plain English for a layperson. Include what it is, who to/from, and how paid. E.g.: 'Monthly home loan EMI of ₹28,500 paid to HDFC Bank via NACH auto-debit' or 'Paid ₹450 for groceries at More Supermarket via PhonePe UPI' or 'Salary credited from ABC Technologies Pvt Ltd via NEFT'"
}`;

  const raw = await geminiText(prompt);
  const cleaned = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: Partial<EnrichResult> = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Return minimal defaults if JSON parsing fails
  }

  return {
    label:            typeof parsed.label === 'string' && parsed.label ? parsed.label : tx.description.slice(0, 60),
    merchant:         typeof parsed.merchant === 'string' && parsed.merchant ? parsed.merchant : (tx.counterparty || tx.description),
    website:          typeof parsed.website === 'string' ? parsed.website : '',
    category:         typeof parsed.category === 'string' && parsed.category ? parsed.category : 'Other',
    sub_category:     typeof parsed.sub_category === 'string' ? parsed.sub_category : '',
    transaction_type: typeof parsed.transaction_type === 'string' && parsed.transaction_type ? parsed.transaction_type : (tx.mode || 'Other'),
    recipient_type:   typeof parsed.recipient_type === 'string' && parsed.recipient_type ? parsed.recipient_type : 'Unknown',
    payment_app:      typeof parsed.payment_app === 'string' ? parsed.payment_app : '',
    flagged:          typeof parsed.flagged === 'boolean' ? parsed.flagged : (tx.flagged ?? false),
    flag_reason:      typeof parsed.flag_reason === 'string' ? parsed.flag_reason : (tx.flag_reason ?? ''),
    notes:            typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

export async function saveEnrichResult(txId: string, userId: string, result: EnrichResult) {
  await sql`
    UPDATE transactions SET
      enriched         = true,
      label            = ${result.label},
      merchant         = ${result.merchant},
      website          = ${result.website},
      category         = ${result.category},
      sub_category     = ${result.sub_category},
      transaction_type = ${result.transaction_type},
      recipient_type   = ${result.recipient_type},
      payment_app      = ${result.payment_app},
      flagged          = ${result.flagged},
      flag_reason      = ${result.flag_reason || null},
      notes            = ${result.notes},
      enrich_source    = 'ai',
      enriched_at      = now()
    WHERE id = ${txId} AND user_id = ${userId}
  `;
}
