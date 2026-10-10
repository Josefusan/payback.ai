#!/usr/bin/env node
/**
 * Capture REAL dashboard state from the deployed Payback.ai Worker, at 1920x1080, for the demo film.
 *
 * Nothing here is authored by hand: every pixel comes from the live app rendered in Chrome. The only
 * thing this script types into the app is the reviewer name and the admin token (which the page renders
 * as a masked password field), and it deletes / never screenshots the token value in the clear.
 *
 * Usage:
 *   node video/capture-dashboard.mjs pre        # before any mutation
 *   node video/capture-dashboard.mjs approve    # drives Review queue -> approve item with an override
 *   node video/capture-dashboard.mjs dial       # drives the autonomy dial -> Set threshold
 *   node video/capture-dashboard.mjs post       # screens after the actions above
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const BASE = process.env.PAYBACK_BASE ?? "https://payback.clarktechventures.workers.dev";
const OUT = path.resolve(import.meta.dirname, "captures");
const TOKEN = process.env.PAYBACK_ADMIN_TOKEN ?? "";
const PHASE = process.argv[2] ?? "pre";

/** The review item the script names: the order whose buyer text tried to instruct the agent. */
const INJECTION_REF = process.env.PAYBACK_INJECTION_REF ?? "87M6127029325142K";

fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale: "en-US",
  reducedMotion: "reduce",
});
// Deterministic chrome: dark theme, sidebar expanded, no stale token in storage while we shoot the
// screens that are not the decision form.
await context.addInitScript(() => {
  try {
    localStorage.setItem("payback.theme", "dark");
    localStorage.setItem("payback.sidebar.collapsed", "0");
    localStorage.removeItem("payback.adminToken");
    localStorage.removeItem("payback.reviewer");
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();

/** Wait for every in-flight read to have painted its live badge. */
async function settle() {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="data-source"]').length > 0, null, { timeout: 45000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="data-source"]')].every((el) => el.getAttribute("data-source") === "live"),
    null,
    { timeout: 45000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

async function shot(name, { full = false } = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full, animations: "disabled" });
  const { size } = fs.statSync(file);
  log(`  · ${name}.png (${Math.round(size / 1024)} KB${full ? ", full page" : ""})`);
}

async function nav(label) {
  const button = page.getByRole("button", { name: label });
  // The header renders the *current* screen as a non-interactive span, so a nav that would be a no-op
  // has no button to click.
  if (await button.count()) await button.click();
  else log(`  · ${label} is already the active screen`);
  await settle();
}

async function boot() {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await settle();
}

async function scrollToTop() {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

async function scrollTo(y) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(350);
}

/* ────────────────────────────────────────────────────────────── after */
/** The state the approve phase left behind, screenshotted on its own so a re-run is never needed. */
async function phaseAfter() {
  log("phase: after");
  await boot();
  await nav("Ledger");
  await shot("ledger-after");
  await shot("ledger-after-full", { full: true });
  await nav("Managerial dashboard");
  const y = await page.evaluate(() => window.scrollY);
  const rBox = await page.locator('[data-testid="reconciliation-tile"]').first().boundingBox();
  if (rBox) await scrollTo(Math.max(0, Math.round(y + rBox.y - 80)));
  await shot("reconcile-after");
  await scrollToTop();
  const bBox = await page.locator('[data-testid="budget-widget"]').first().boundingBox();
  if (bBox) await scrollTo(Math.max(0, Math.round(await page.evaluate(() => window.scrollY) + bBox.y - 90)));
  await shot("budget-variance-after");
  await nav("Audit trail");
  await page.waitForSelector('[data-testid="audit-events"]', { timeout: 30000 });
  await shot("audit-mid");
  await shot("audit-mid-full", { full: true });
}

/* ─────────────────────────────────────────────────────────────── pre */
async function phasePre() {
  log("phase: pre");
  await boot();
  await shot("ledger");
  await shot("ledger-full", { full: true });

  // Drill through the refund line's journal entry to the real PayPal sandbox transaction.
  const drill = page.locator('[data-testid^="drill-"]').first();
  if (await drill.count()) {
    await drill.click();
    await page.waitForSelector('[data-testid="source-drawer"]', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot("ledger-drill");
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator('[data-testid="source-drawer"] button').first().click().catch(() => {});
    await page.waitForTimeout(500);
  } else {
    log("  ! no drill-through row found on the ledger");
  }

  await nav("Managerial dashboard");
  await shot("managerial-top");
  const box = async (sel) => {
    const el = page.locator(sel).first();
    if (!(await el.count())) return null;
    return await el.boundingBox();
  };
  const budgetBox = await box('[data-testid="budget-widget"]');
  if (budgetBox) await scrollTo(Math.max(0, Math.round(await page.evaluate(() => window.scrollY)) + budgetBox.y - 90));
  await shot("budget-variance");

  await scrollToTop();
  const dialBox = await box('[data-testid="confidence-dial"]');
  if (dialBox) {
    const y = await page.evaluate(() => window.scrollY);
    await scrollTo(Math.max(0, Math.round(y + dialBox.y - 70)));
  }
  await shot("dial-before");
  await shot("managerial-full", { full: true });

  await scrollToTop();
  await nav("Review queue");
  const item = page.locator(`button:has(code:text-is("${INJECTION_REF}"))`).first();
  if (await item.count()) {
    await item.click();
    await page.waitForTimeout(700);
  } else {
    log(`  ! review item ${INJECTION_REF} not found in the queue`);
  }
  await shot("review-list");
  await shot("review-queue-full", { full: true });

  // The detail pane makes the page tall, so pan the window by hand: a 16:9 camera needs smooth
  // intermediate offsets, not just the top and the bottom.
  await shot("review-detail-top");
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  if (tall > 1080) {
    await scrollTo(Math.round(tall - 1080));
    await shot("review-detail-bottom");
    await scrollTo(Math.round((tall - 1080) / 2) + 120);
    await shot("review-detail-mid");
    await scrollToTop();
  } else {
    log(`  ! review detail page is only ${tall}px tall; no bottom pan`);
  }
  await shot("review-full", { full: true });

  await nav("Audit trail");
  await page.waitForSelector('[data-testid="audit-events"]', { timeout: 30000 });
  await shot("audit-top");
  await shot("audit-full", { full: true });
}

/* ─────────────────────────────────────────────────────────── approve */
async function phaseApprove() {
  log("phase: approve");
  if (!TOKEN) throw new Error("PAYBACK_ADMIN_TOKEN is required for the approve phase");
  await boot();
  await nav("Review queue");
  const item = page.locator(`button:has(code:text-is("${INJECTION_REF}"))`).first();
  if (!(await item.count())) throw new Error(`review item ${INJECTION_REF} is not in the queue`);
  await item.click();
  await page.waitForTimeout(700);

  // The decision form: an account override away from the model's own choice, plus the reviewer's name.
  await page.selectOption("#review-decision", "4000");
  await page.fill("#review-name", "Joseph");
  await page.fill("#review-token", TOKEN);
  await page.waitForTimeout(400);
  const detail = page.locator(".panel--detail").first();
  await detail.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
  await shot("review-approve-form");

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  // The success banner is replaced when the queue reloads, so grab it as soon as it exists.
  await page.waitForSelector('[data-testid="decision-result"]', { timeout: 30000 }).catch(() => log("  ! decision-result banner never appeared"));
  await shot("review-approved");
  await page.waitForTimeout(2500);
  await shot("review-after");

  // The token is left in localStorage by the app; scrub it so no later frame can ever show it.
  await page.evaluate(() => localStorage.removeItem("payback.adminToken"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle();
  await nav("Ledger");
  await shot("ledger-after");
  await nav("Managerial dashboard");
  await scrollToTop();
  const y = await page.evaluate(() => window.scrollY);
  const rBox = await page.locator('[data-testid="reconciliation-tile"]').first().boundingBox();
  if (rBox) await scrollTo(Math.max(0, Math.round(y + rBox.y - 80)));
  await shot("reconcile-after");
  await nav("Audit trail");
  await page.waitForSelector('[data-testid="audit-events"]', { timeout: 30000 });
  await shot("audit-mid");
  await shot("audit-mid-full", { full: true });
}

/* ────────────────────────────────────────────────────────────── dial */
async function phaseDial() {
  log("phase: dial");
  if (!TOKEN) throw new Error("PAYBACK_ADMIN_TOKEN is required for the dial phase");
  await boot();
  await nav("Managerial dashboard");
  const y = await page.evaluate(() => window.scrollY);
  const dialBox = await page.locator('[data-testid="confidence-dial"]').first().boundingBox();
  const dialY = Math.max(0, Math.round(y + dialBox.y - 70));
  await scrollTo(dialY);

  // Move the dial up a notch and commit it — a real PUT whose row lands on the audit chain.
  const before = Number(await page.locator('[data-testid="dial-slider"]').inputValue());
  const target = Math.min(0.99, Math.round((before + 0.05) * 100) / 100);
  await page.locator('[data-testid="dial-slider"]').evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, target);
  await page.waitForTimeout(500);
  await shot("dial-dragged");

  await page.fill("#dial-token", TOKEN);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Set threshold" }).click();
  await page.waitForSelector('[data-testid="dial-saved"]', { timeout: 30000 }).catch(() => log("  ! dial-saved never appeared"));
  await shot("dial-set");
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.removeItem("payback.adminToken"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await settle();
  await nav("Audit trail");
  await page.waitForSelector('[data-testid="audit-events"]', { timeout: 30000 });
  await shot("audit-after-dial");
  await shot("audit-after-dial-full", { full: true });
}

/* ────────────────────────────────────────────────────────────── post */
async function phasePost() {
  log("phase: post");
  await boot();
  await nav("Managerial dashboard");
  await shot("managerial-post");
  await shot("managerial-post-full", { full: true });
  await nav("Audit trail");
  await page.waitForSelector('[data-testid="audit-events"]', { timeout: 30000 });
  await shot("audit-final");
  await shot("audit-final-full", { full: true });
  await nav("Review queue");
  await shot("review-post");
}

const phases = { pre: phasePre, approve: phaseApprove, after: phaseAfter, dial: phaseDial, post: phasePost };
if (!phases[PHASE]) throw new Error(`unknown phase ${PHASE}`);
try {
  await phases[PHASE]();
  log("done");
} finally {
  await browser.close();
}
