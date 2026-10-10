import { useEffect, useState } from "react";

import type { BudgetLine, CoaAccount } from "../../../../packages/contracts/api";
import { ApiError, loadCoa, readAdminToken, writeAdminToken } from "../data/api";
import { putBudgetLine, type BudgetWriteInput } from "../data/budgets";
import { formatCents } from "../format";

/** Exactly the account types the worker will accept a budget for — the P&L types the variance report judges. */
const BUDGETABLE_TYPES = new Set<CoaAccount["type"]>(["revenue", "contra_revenue", "cogs", "expense"]);

/** Mirrors the worker's period guard so the button cannot ask for something that would come back 400. */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The current UTC month, matching the report's default period. */
function currentUtcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Parse a dollar amount from the form into integer cents, or null when it is not a usable amount.
 * Strict on purpose: `1.5`, `-3`, `$1 0` and `1.234` are all rejected rather than rounded into a
 * plausible-looking but wrong plan.
 */
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export interface BudgetEntryProps {
  /** Called after a successful write, so the screen can reload the variance this plan feeds. */
  onSaved?: (budget: BudgetLine) => void;
  /** Injectable for tests; defaults to the live `PUT /api/budgets` writer. */
  submit?: (input: BudgetWriteInput, token: string) => Promise<BudgetLine>;
  /** Injectable for tests; defaults to the current UTC month. */
  defaultPeriod?: string;
  /** Injectable for tests; defaults to the chart of accounts read from the worker. */
  accounts?: CoaAccount[];
  /** Injectable for tests; defaults to the token persisted in localStorage. */
  initialToken?: string;
}

/**
 * BudgetEntry (T-L4-005): the missing half of budget-vs-actual — being able to state the plan at all.
 *
 * The seeded budgets made the report render but gave the user no way to change them, which is the
 * difference between a demo and a product. The amount is entered in dollars and converted to integer
 * cents here; the worker stores it as the account's natural magnitude, so what is typed is what the
 * report measures against. Every accepted write lands on the hash-chained audit log, so the plan's
 * history is attributable.
 */
export function BudgetEntry({ onSaved, submit = putBudgetLine, defaultPeriod, accounts: injectedAccounts, initialToken }: BudgetEntryProps = {}) {
  // The chart of accounts, read from the worker only when it is not injected. Filtered to the P&L types
  // the worker accepts, so the picker offers exactly what a write will not reject.
  const [coa, setCoa] = useState<CoaAccount[] | null>(null);
  useEffect(() => {
    if (injectedAccounts) return;
    let cancelled = false;
    void loadCoa().then((loaded) => {
      if (!cancelled) setCoa(loaded.data);
    });
    return () => {
      cancelled = true;
    };
  }, [injectedAccounts]);
  const accounts = (injectedAccounts ?? coa ?? []).filter((account) => BUDGETABLE_TYPES.has(account.type));

  const [draftPeriod, setDraftPeriod] = useState<string | null>(null);
  const [accountCode, setAccountCode] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState(() => initialToken ?? readAdminToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    writeAdminToken(token);
  }, [token]);

  const period = draftPeriod ?? defaultPeriod ?? currentUtcMonth();
  const cents = parseAmountToCents(amount);
  const ready = !busy && token.trim() !== "" && PERIOD_PATTERN.test(period) && accountCode !== "" && cents !== null;

  async function commit() {
    if (!ready || cents === null) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const written = await submit({ period, account_code: accountCode, amount_cents: cents, by: "dashboard", note: null }, token.trim());
      setSaved(`Set ${written.account_code} to ${formatCents(written.amount_cents)} for ${written.period}.`);
      setAmount("");
      // Reload the variance on the screen, so the write is visible immediately rather than on next mount.
      onSaved?.(written);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="widget" aria-labelledby="budget-entry-heading" data-testid="budget-entry">
      <header className="widget__head">
        <h2 className="widget__title" id="budget-entry-heading">
          Set a budget
        </h2>
      </header>
      <p className="muted">
        Enter or replace the plan for one account in a month. Revenue is the amount you expect to earn and
        cost the amount you expect to spend, both positive; every write is recorded on the audit chain.
      </p>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="budget-period">
            Period
          </label>
          <input
            id="budget-period"
            className="field__input"
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM"
            value={period}
            onChange={(e) => setDraftPeriod(e.target.value)}
            data-testid="budget-period"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="budget-account">
            Account
          </label>
          <select
            id="budget-account"
            className="field__input"
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            data-testid="budget-account"
          >
            <option value="">Select an account…</option>
            {accounts.map((account) => (
              <option key={account.code} value={account.code}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="budget-amount">
            Amount (USD)
          </label>
          <input
            id="budget-amount"
            className="field__input"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="budget-amount"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="budget-token">
            Admin token
          </label>
          <input
            id="budget-token"
            className="field__input"
            type="password"
            value={token}
            autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
            data-testid="budget-token"
          />
        </div>
        <button type="button" className="btn btn--primary" onClick={commit} disabled={!ready} data-testid="budget-save">
          {busy ? "Saving…" : "Save budget"}
        </button>
      </div>

      {error ? (
        <p className="muted" role="alert" data-testid="budget-error">
          {error}
        </p>
      ) : null}
      {saved && !busy ? (
        <p className="muted" data-testid="budget-saved">
          {saved}
        </p>
      ) : null}
    </section>
  );
}
