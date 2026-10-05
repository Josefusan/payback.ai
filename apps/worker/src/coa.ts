/**
 * Chart of accounts + the label descriptions Clef sees.
 * The `clef` text is the model's ONLY definition of each label: keep it precise and mutually exclusive.
 */
export interface Account {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "contra_revenue" | "cogs" | "expense" | "other";
  clef?: string; // present = selectable by Clef for the P&L side of a PayPal transaction
}

export const ACCOUNTS: Account[] = [
  { code: "1000", name: "Operating bank", type: "asset", clef: "Transfer between PayPal and the company's own bank account (withdrawal or top-up). Not income or expense." },
  { code: "1010", name: "PayPal Clearing", type: "asset" },
  { code: "1020", name: "PayPal Reserve / Holds", type: "asset" },
  { code: "1200", name: "Accounts Receivable", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Sales tax payable", type: "liability" },
  { code: "3000", name: "Owner's equity", type: "equity", clef: "Owner putting their own money into the business (capital contribution)." },
  { code: "3100", name: "Owner draws", type: "equity", clef: "Personal purchase or money taken out by the owner that is not a business expense (consumer electronics, streaming, groceries, personal travel)." },
  { code: "4000", name: "Product revenue", type: "revenue", clef: "Money received for digital products the company sells: templates, UI kits, courses, subscriptions to its content, tips from customers." },
  { code: "4100", name: "Services revenue", type: "revenue", clef: "Money received from clients for services/consulting work, usually tied to an invoice, SOW or project." },
  { code: "4900", name: "Refunds & returns", type: "contra_revenue", clef: "Money returned to a customer for a previous sale: refunds, chargebacks, reversals of customer payments." },
  { code: "5000", name: "Cost of goods sold", type: "cogs", clef: "Costs directly required to produce or deliver products sold: stock assets used in products, course hosting/delivery platforms." },
  { code: "6050", name: "PayPal / merchant fees", type: "expense", clef: "Payment-processing or marketplace selling fees charged to the company (PayPal, Gumroad, Stripe fees)." },
  { code: "6060", name: "Chargeback losses & dispute fees", type: "expense", clef: "Fees charged because of chargebacks or disputes." },
  { code: "6100", name: "Software & subscriptions", type: "expense", clef: "Business software and SaaS subscriptions used to run the company (design tools, productivity, cloud apps)." },
  { code: "6200", name: "Advertising & marketing", type: "expense", clef: "Paid ads, sponsorships, promotions and marketing services." },
  { code: "6300", name: "Contractors", type: "expense", clef: "Payments to freelancers/contractors for work performed for the company." },
  { code: "6900", name: "Other expense", type: "expense", clef: "Legitimate business expense that fits no other category (business travel, meals with clients, misc)." },
  { code: "7000", name: "FX gain/loss", type: "other" },
];

export const CLEF_ACCOUNT_CRITERIA: Record<string, string> = {
  ...Object.fromEntries(ACCOUNTS.filter((a) => a.clef).map((a) => [a.code, a.clef as string])),
  review: "Unclear, large or unusual purchase (e.g., equipment that may need to be capitalized), or none of the above fit.",
};

export const PRODUCT_LINES: Record<string, string> = {
  templates: "Notion/Figma templates, UI kits and template bundles, and costs of selling/marketing them",
  courses: "Online design courses and their delivery costs",
  consulting: "Client design/consulting projects and costs incurred for clients",
  none: "Not attributable to a single product line (overhead, transfers, owner activity)",
};

export function accountExists(code: string): boolean {
  return ACCOUNTS.some((a) => a.code === code);
}
