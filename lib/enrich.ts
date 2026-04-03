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

// Main categories
export const CATEGORIES = [
  'Food & Dining',
  'Transport & Travel',
  'Shopping',
  'Bills & Utilities',
  'Subscriptions & Entertainment',
  'Investments & Trading',
  'Dividends & Returns',
  'EMI & Loans',
  'Insurance',
  'Salary & Income',
  'Freelance & Work Income',
  'Personal Transfer — Friend/Family',
  'Splitwise & Shared Expenses',
  'Household Help & Staff',
  'Housing & Society',
  'Healthcare',
  'Education',
  'Wallet & Prepaid Top-up',
  'ATM & Cash',
  'Bank Charges & Fees',
  'Government & Tax',
  'Cashback & Refund',
  'Other',
];

// Sub-categories mapped to each main category (for reference in prompt)
const SUB_CATEGORY_MAP: Record<string, string[]> = {
  'Food & Dining': ['Food Delivery (Swiggy/Zomato/Dunzo)', 'Restaurant / Cafe / Dining Out', 'Grocery & Supermarket', 'Quick Commerce (Blinkit/Zepto/Instamart)'],
  'Transport & Travel': ['Cab / Auto / Bike Taxi (Ola/Uber/Rapido)', 'Metro / Bus / Public Transport', 'Train Ticket', 'Flight Ticket', 'Hotel / Accommodation', 'Fuel', 'Parking', 'Delhi Transport / IOCL'],
  'Shopping': ['Online Shopping (Amazon/Flipkart)', 'Clothing & Fashion', 'Electronics & Gadgets', 'Household Items', 'Books & Stationery', 'Other Retail'],
  'Bills & Utilities': ['Electricity Bill', 'Mobile Recharge / Postpaid Bill', 'Internet / Broadband / DTH', 'Water / Gas Bill', 'LPG Cylinder'],
  'Subscriptions & Entertainment': ['OTT Streaming (Netflix/Hotstar/Prime)', 'YouTube Premium', 'Apple One / Apple TV+', 'iCloud / Cloud Storage', 'Gaming', 'Music (Spotify/Gaana)', 'App Subscriptions', 'Movie Ticket'],
  'Investments & Trading': ['Mutual Fund SIP (Groww/Zerodha/Upstox)', 'Stock Purchase', 'Crypto', 'Fixed Deposit', 'Recurring Deposit', 'Gold / SGBs', 'NPS'],
  'Dividends & Returns': ['Stock Dividend', 'Mutual Fund Dividend/Returns', 'FD Interest', 'Gold Bond Interest'],
  'EMI & Loans': ['Home Loan EMI', 'Car Loan EMI', 'Personal Loan EMI', 'Education Loan EMI', 'Gold Loan (Muthoot/Manappuram)', 'Credit Card Bill Payment', 'BNPL Repayment'],
  'Insurance': ['Life Insurance Premium', 'Health Insurance Premium', 'Vehicle Insurance Premium', 'Term Insurance'],
  'Salary & Income': ['Monthly Salary (NEFT/RTGS)', 'Bonus / Incentive', 'Pension'],
  'Freelance & Work Income': ['Client Payment / Project Fee', 'PayPal / Foreign Remittance', 'Consulting Fee', 'Business Income'],
  'Personal Transfer — Friend/Family': ['Sent to Friend', 'Received from Friend', 'Sent to Family Member', 'Received from Family', 'Unknown Individual UPI'],
  'Splitwise & Shared Expenses': ['Splitwise Settlement', 'Group Trip Settlement', 'Bill Split'],
  'Household Help & Staff': ['Maid / Domestic Help', 'Cook / Chef', 'Driver', 'Security / Guard', 'Nanny / Babysitter', 'Other Domestic Staff'],
  'Housing & Society': ['Rent Payment', 'Society / Maintenance Charges', 'Property Tax', 'Parking Charges (Society)', 'Home Services (Plumber/Electrician)', 'Interior / Renovation'],
  'Healthcare': ['Doctor / Consultation', 'Pharmacy / Medicine', 'Lab Test / Diagnostics', 'Hospital Bill', 'Dental', 'Optical / Glasses'],
  'Education': ['School / College Fees', 'Online Course / EdTech', 'Books & Study Material', 'Coaching / Tuition'],
  'Wallet & Prepaid Top-up': ['Paytm Wallet Top-up', 'PhonePe Wallet', 'Amazon Pay Wallet', 'Metro Card / FASTag Recharge'],
  'ATM & Cash': ['ATM Withdrawal', 'Cash Deposit', 'Cash Advance'],
  'Bank Charges & Fees': ['Account Maintenance Fee', 'SMS / Alert Charges', 'Cheque Bounce Fee', 'NEFT / IMPS Processing Fee', 'Forex Markup'],
  'Government & Tax': ['Income Tax / TDS', 'GST Payment', 'Challan / Fine', 'Government Fee'],
  'Cashback & Refund': ['Cashback Received', 'Refund from Merchant', 'Reward Redemption'],
  'Other': ['Unclear / Unable to Determine'],
};

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
  const subCatExamples = Object.entries(SUB_CATEGORY_MAP)
    .map(([cat, subs]) => `  "${cat}": ${subs.slice(0, 3).join(' / ')}`)
    .join('\n');

  const prompt = `You are analyzing an Indian bank transaction. Your goal is to make it easy for a layperson to understand exactly what happened.

Transaction details:
- Raw bank description: "${tx.description}"
- Amount: ₹${tx.amount} (${tx.type === 'debit' ? 'Debit — money going OUT' : 'Credit — money coming IN'})
- Transaction mode from bank: ${tx.mode || 'Not specified'}
- Counterparty on bank record: ${tx.counterparty || 'Not specified'}
- UPI VPA (if any): ${tx.upi_id || 'N/A'}

Key patterns to recognise in Indian bank descriptions:
- "UPI-SWIGGY" / "UPI-ZOMATO" / "DUNZO" = food delivery
- "UPI-RAPIDO" / "UPI-OLACABS" / "UPI-UBER" = cab/transport
- "ACH/Groww" / "SYRMAGROWW" = Groww mutual fund/stock investment
- "ACH/NMDC" / "ACH/LT FOODS" / "ACH/GESL" / "ACH/Muthoot" with credit = dividend income
- "ACH D- TATA AIA" = insurance premium debit
- "NEFT-CITIN...UIPATH" or similar with large credit = salary
- "NEFT-CITIN...PAYPAL" = PayPal foreign income
- "appleservices.b" / "APPLAMP" / "billdeskpg.appl" = Apple subscription (iCloud/Apple One/App Store)
- "MSI/YOUTUBE" = YouTube Premium
- "UPI/airtelcommonpoo" = Airtel postpaid/broadband bill
- "BIL/ONL/..." = online bill payment (electricity/water)
- "ecoworld-buildi" = society maintenance
- "PAYTMADDMONEY" / "POS...PAYTM" = Paytm wallet top-up
- "REV_INSTA ALERT" = reversed bank alert charge
- "Splitwise" in description = expense splitting
- Named individuals via UPI (e.g. "mssugandhi", "Sushmita Gupta", "Jitendra K") with small-medium recurring amounts = likely household help (maid, cook, driver) or personal transfer
- "BHARATPE" in UPI = merchant via BharatPe terminal (small shop)
- "ACH D-" prefix = NACH auto-debit (EMI, insurance, SIP)

Categories to choose from (pick EXACTLY one):
${CATEGORIES.join(' | ')}

Sub-category examples per category:
${subCatExamples}

Return ONLY a raw JSON object — no markdown, no code fences, no explanation:
{
  "label": "3-7 word plain-English label. Be specific. E.g.: 'Swiggy food delivery', 'Maid Sushmita salary', 'HDFC credit card bill', 'Groww mutual fund SIP', 'Apple iCloud subscription', 'UiPath salary April', 'NMDC dividend', 'Tata AIA insurance premium', 'Rapido auto ride', 'Society maintenance charge', 'YouTube Premium', 'Splitwise settlement', 'Paytm wallet top-up', 'Transfer to friend Rahul'",
  "merchant": "Clean merchant or person name. For food apps use: Swiggy / Zomato / Dunzo. For cab: Ola / Uber / Rapido. For investments: Groww / Zerodha. For individuals use their name from description. For BharatPe terminals use the shop/merchant name if visible.",
  "website": "Official website only if confident (swiggy.in, zomato.com, amazon.in, groww.in, apple.com, airtel.in). Empty string if unsure.",
  "category": "Exactly one from the list above",
  "sub_category": "Specific sub-type from the examples above, or write your own if none fit",
  "transaction_type": "UPI Payment | NEFT | IMPS | RTGS | ACH/NACH Auto-debit | ACH Credit | ATM Withdrawal | Cash Deposit | Salary Credit | Dividend Credit | Bill Payment | Card Payment | Wallet Top-up | Refund | Cashback | Standing Instruction | Other",
  "recipient_type": "Individual | Business | Investment Platform | Bank/NBFC | Insurance Company | Government | Self/Own Account | Wallet",
  "payment_app": "GPay | PhonePe | Paytm | Amazon Pay | BHIM | CRED | Groww | Zerodha | Upstox | BharatPe | WhatsApp Pay | Apple Pay | Airtel Money | Other. Empty string if not applicable.",
  "flagged": ${tx.flagged ?? false},
  "flag_reason": "Non-empty ONLY if genuinely suspicious: unknown large credit, possible fraud, test transactions. Empty string for normal transactions.",
  "notes": "One clear sentence a layperson can understand. Include: what it is, who sent/received, how. E.g.: 'Monthly SIP of ₹3,000 debited to Groww for mutual fund investment via NACH auto-debit' or 'Maid salary paid to Sushmita Gupta via PhonePe UPI' or 'Salary of ₹3.84L credited from UiPath Robotic Process Automation via NEFT' or 'Apple iCloud 50GB subscription charged via UPI mandate'"
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
