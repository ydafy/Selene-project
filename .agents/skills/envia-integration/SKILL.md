---
name: envia-integration
description: 'Trigger: Envia fulfillment, shipping rates, labels, tracking, shipment cancellation, order cancellation, carriers, pickups, addresses. Use current official Envia documentation first.'
license: Apache-2.0
metadata:
  author: 'school-portal'
  version: '1.0'
---

## Activation Contract

Load for any Envia fulfillment planning, implementation, review, or debugging involving rates, labels, tracking, shipment or order cancellation, carriers, pickups, or addresses.

## Hard Rules

- Before planning or coding, fetch `https://docs.envia.com/llms.txt`, identify the relevant official page, then fetch and read that page's `.md` version. Remote Envia documentation is authoritative; never copy or cache `llms.txt` in this repository.
- Do not configure Envia MCP, add credentials, or make Envia API calls merely to research documentation.
- Keep Envia tokens server-only. Never expose or log them in clients, source, tests, or diagnostics.
- Treat label generation and provider cancellation as consequential operations: use Envia sandbox first and obtain explicit maintainer confirmation immediately before production label purchase or cancellation.
- Preserve repository invariants: shipments are seller-scoped operational and financial boundaries; reconstruct and authorize server-side; make callbacks and retries idempotent; do not commit financial cancellation until required provider and Stripe outcomes succeed.

## Decision Gates

| Situation                                            | Required action                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Docs do not define the operation or carrier behavior | Stop and ask for clarification; do not infer a payload or state transition.                             |
| Label purchase or cancellation                       | Verify authorization, stored server-side data, idempotency, sandbox behavior, and current confirmation. |
| Address, carrier, service, or pickup support varies  | Read the relevant Envia `.md` reference and use its current identifiers and required fields.            |

## Execution Steps

1. Fetch `https://docs.envia.com/llms.txt` live.
2. Select the focused official documentation page and read its `.md` page before inspecting implementation details.
3. Then read the applicable OpenSpec contract, shared database types, implementation, and tests; reconcile any difference in favor of current remote provider documentation and repository safety invariants.
4. Record the documentation URLs consulted and validate sandbox behavior before proposing production operations.

## Output Contract

Report the consulted Envia `.md` URLs, the confirmed provider behavior, applicable repository invariants, and any production confirmation still required.

## References

- `../../../AGENTS.md` — repository security, financial, Supabase, and fulfillment invariants.
- `../../../openspec/specs/shipments/spec.md` — current shipment product contract.
