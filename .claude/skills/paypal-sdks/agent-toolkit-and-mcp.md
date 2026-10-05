# PayPal Agent Toolkit, MCP server, and AI-Toolkit plugin

## Agent Toolkit (function-calling tools for LLM agents)
Docs: https://docs.paypal.ai/developer/tools/ai/agent-toolkit-quickstart
```bash
npm install @paypal/agent-toolkit        # TS (Node ≥18)
pip install paypal-agent-toolkit         # Python ≥3.11
```
Frameworks: Vercel AI SDK, OpenAI Agents SDK, LangChain, CrewAI, Amazon Bedrock, MCP.
```ts
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
const paypal = new PayPalAgentToolkit({
  clientId: env.PAYPAL_CLIENT_ID,
  clientSecret: env.PAYPAL_CLIENT_SECRET,
  configuration: {
    actions: {
      invoices: { create: true, list: true, send: true, sendReminder: true, cancel: false },
      disputes: { list: true, get: true },
      orders: { create: true, get: true },
    },
    context: { sandbox: true },
  },
});
// with Vercel AI SDK: generateText({ model, tools: paypal.getTools(), prompt })
```
> Exact action key names vary by version — check the package README/types before relying on them. Enable the **minimum** actions per agent (least privilege). On Workers, try `nodejs_compat`; if it fails, use our REST client.

## Tool catalog (MCP / toolkit) — https://docs.paypal.ai/developer/tools/ai/agent-tools-ref
- **Invoices:** create_invoice, list_invoices, get_invoice, send_invoice, send_invoice_reminder, cancel_sent_invoice, generate_invoice_qr_code
- **Orders:** create_order, get_order, pay_order
- **Refunds:** create_refund, get_refund
- **Disputes:** list_disputes, get_dispute, accept_dispute_claim
- **Shipment:** create_shipment_tracking, get_shipment_tracking, update_shipment_tracking
- **Catalog:** create_product, list_product, show_product_details
- **Subscriptions:** create_subscription_plan, list_subscription_plans, show_subscription_plan_details, create_subscription, show_subscription_details, update_subscription, cancel_subscription
- **Reporting:** list_transaction, get_merchant_insights
- **Remote-only commerce:** search_product, create_cart, checkout_cart
- **Not covered:** Payouts, Balances, webhook verification → REST.

## MCP server
- Remote: sandbox `https://mcp.sandbox.paypal.com` (transports `/sse`, `/http` streamable) · production `https://mcp.paypal.com` (**never** in this project)
- Local: `npx -y @paypal/mcp --tools=all` with env `PAYPAL_ACCESS_TOKEN`, `PAYPAL_ENVIRONMENT=SANDBOX`
- Our project config: `.mcp.json` (server `paypal-sandbox`). Token comes from `scripts/paypal-token.sh` → `export PAYPAL_ACCESS_TOKEN=...` (expires ~9h).

## PayPal AI-Toolkit (Claude Code plugin, dev-time)
Repo: https://github.com/paypal/AI-Toolkit (Apache-2.0)
```
/plugin install paypal@claude-plugins-official
/reload-plugins
# or: git clone https://github.com/paypal/AI-Toolkit.git && claude --plugin-dir /path/to/AI-Toolkit
```
Needs `PAYPAL_SANDBOX_ACCESS_TOKEN` in the user's `~/.claude/settings.json` `env` (human sets it; agents never write secrets).
Commands: `/paypal:setup`, `/paypal:doctor [symptom]`, `/paypal:explain-error <CODE>`, `/paypal:sandbox [topic]`, `/paypal:test-accounts [topic]`. Skill `paypal-best-practices` auto-injects API/auth/webhook/sandbox guidance.

## Agent safety pattern for money-moving tools
```
LLM/agent proposes action ──► Clef decision (noul: "is this action consistent with policy & evidence?")
                         ──► policy.ts (amount limits, allow-listed payees, rate limits)
                         ──► human approval if above autonomous limit
                         ──► PayPal call with PayPal-Request-Id ──► audit_log row
```
Never pass raw payment notes/invoice memos into an agent's *instructions*; they go into Clef `state` as quoted data.
