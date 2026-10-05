# PayPal JavaScript SDK v6 (buyer-side checkout)

Docs: https://developer.paypal.com/sdk/js/ · Only needed if the product takes payments in-app (e.g., "pay this invoice" page, seeding demo sales). For the back office, Invoicing v2 hosted pay pages often suffice.

## Load
```html
<script src="https://www.sandbox.paypal.com/web-sdk/v6/core"></script>   <!-- sandbox -->
```

## Initialize
```js
// Option A — client ID (recommended)
const sdk = await window.paypal.createInstance({
  clientId: "SANDBOX_CLIENT_ID",
  components: ["paypal-payments"],          // also: "venmo-payments", "paypal-messages", "fastlane", "googlepay-payments", "applepay-payments"
  pageType: "checkout",
});
// Option B — browser-safe client token (required for Fastlane)
// server: POST /v1/oauth2/token with grant_type=client_credentials, response_type=client_token, domains[]=<your origin>
```

## Eligibility + session
```js
const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
if (methods.isEligible("paypal")) {
  const session = sdk.createPayPalOneTimePaymentSession({
    async onApprove({ orderId }) { await fetch(`/api/orders/${orderId}/capture`, { method: "POST" }); },
    onCancel() {}, onError(err) { console.error(err); },
  });
  document.querySelector("paypal-button").addEventListener("click", async () => {
    await session.start({ presentationMode: "auto" }, createOrder()); // createOrder() resolves { orderId }
  });
}
```
- Web components: `<paypal-button>`, `<paypal-pay-later-button>`, `<paypal-credit-button>`.
- Other sessions: `createPayLaterOneTimePaymentSession`, `createPayPalCreditOneTimePaymentSession`.
- **v6 difference:** `createOrder` must resolve to `{ orderId: "..." }` (not a bare string).

## Server endpoints we expose (Worker)
- `POST /api/orders` → `POST /v2/checkout/orders` → `{ orderId }`
- `POST /api/orders/:id/capture` → `POST /v2/checkout/orders/{id}/capture`
- (Fastlane only) `GET /api/paypal/client-token`
