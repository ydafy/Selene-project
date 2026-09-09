# Research: confirm-shipment

```yaml
schema: gentle-ai.sdd-research/v1
revision: 1
outcome: blocked
change: confirm-shipment
accessed_at: 2026-09-02
admission:
  requested_classes:
    - documentation
    - open-web
  observed_exact_grants:
    documentation: []
    open-web: []
  result: denied
  reason: >-
    No exact runtime grant admits the requested documentation or open-web
    evidence classes. Official URLs named in the request define allowed sources,
    but do not grant evidence-access capability.
questions:
  - id: stripe-completion-source
    lane: Stripe Connect transfer/payout/reconciliation semantics
    question: >-
      Does explicit buyer confirmation versus automatic completion 48 hours
      after carrier-recorded delivery produce a provider-level difference for
      Stripe Connect transfer, payout, or reconciliation semantics?
  - id: stripe-completion-audit
    lane: Stripe Connect transfer/payout/reconciliation semantics
    question: >-
      What completion-source evidence must Selene persist, and should Stripe
      transfer metadata, description, or idempotency distinguish completion
      source?
  - id: envia-delivered-semantics
    lane: Envia tracking delivery semantics
    question: >-
      What Envia event/status is canonical for delivered, how timestamps,
      duplicates, and ordering behave, and which timestamp should populate
      Selene delivered_at?
  - id: envia-auto-completion-clock
    lane: Envia tracking delivery semantics
    question: >-
      Should automatic completion be measured from the provider event time or
      from Selene ingestion time?
source_policy:
  allowed_sources:
    - Stripe official documentation under the URLs supplied in the request
    - Envia official documentation index and directly linked official Markdown pages
  sources: []
validated_claims: []
contradictions: []
uncertainty:
  - >-
    All provider questions remain unknown because documentation and open-web
    evidence access was denied before source collection.
limitations:
  - >-
    Local adapter inspection cannot establish external provider semantics and
    is not substituted for official provider documentation.
  - >-
    No provider API calls, sandbox operations, deployments, or application-code
    changes were performed.
product_choices:
  authoritative: false
  confirmed_by_maintainer:
    - Buyer confirmation is permitted only after shipment status is delivered.
    - Automatic completion occurs 48 hours after carrier-recorded delivery when the buyer does not confirm.
    - shipments.buyer_confirmed_at records explicit buyer confirmation; automatic completion leaves it null and requires separate audit evidence.
    - Post-dispute reconfirmation is deferred to a future change.
    - Quote economics and the MXN 30 buffer are excluded.
recovery:
  required_before_proposal: >-
    Re-enter selected research with an exact runtime documentation or open-web
    grant, then collect only the allowed official Stripe and Envia sources,
    map each provider claim to source IDs, and replace this blocked revision.
proposal_ready: false
```

## Result

Research is blocked at evidence admission. No provider claims are made in this
artifact. The selected request and confirmed product choices are retained only
for recovery; they are not provider evidence.
