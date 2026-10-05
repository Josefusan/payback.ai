#!/usr/bin/env bash
# Prints an export line for a PayPal SANDBOX access token (~9h). Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from your shell.
# Usage: eval "$(bash scripts/paypal-token.sh)"
set -euo pipefail
: "${PAYPAL_CLIENT_ID:?set PAYPAL_CLIENT_ID (sandbox)}"
: "${PAYPAL_CLIENT_SECRET:?set PAYPAL_CLIENT_SECRET (sandbox)}"
token=$(curl -sS -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -u "${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}" \
  -d "grant_type=client_credentials" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "export PAYPAL_ACCESS_TOKEN=${token}"
echo "export PAYPAL_SANDBOX_ACCESS_TOKEN=${token}"
