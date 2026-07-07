# Admin Payments Page — Discontinued

**Status**: DISCARDED / SUPERSEDED / NO LONGER ACTIVE  
**Last active**: 2026-06-01 (planned; never implemented as production behavior)  
**Archive date**: 2026-06-15

> This spec exists solely as an audit trail. The admin payments module was discarded/removed from the repository by user decision. Nothing in this document represents active, implemented, or expected product behavior.

## Removed Capability

### Requirement: Admin Payments Page Module

The previously planned `admin-payments-page` capability is no longer active. The module was discarded/removed from the repository by user decision and SHALL NOT be treated as a successfully delivered payments feature.

**Reason**: User decision superseded the planned implementation; the module is no longer part of the active product scope.

**Migration**: Archived as `DISCARDED / SUPERSEDED / NO LONGER ACTIVE`. See `openspec/changes/archive/2026-06-15-admin-payments-page/` for full historical artifacts. The legacy PAY-001–PAY-012 requirements (listing, KPI cards, BBVA file generation, CLABE validation, name sanitization, bank code mapping, status transitions, audit logging, DB view, DataTable i18n, formatCurrency consistency, rejection with reason) were never implemented and must not be treated as active product requirements.

#### Scenario: Archive records discontinued status

- GIVEN the `admin-payments-page` change is archived
- WHEN future agents inspect the OpenSpec history
- THEN they see that the module was discarded by user decision
- AND they do not treat the legacy implementation tasks as completed production functionality

#### Scenario: Active repository remains unchanged

- GIVEN this archive is artifact-only
- WHEN the archive is complete
- THEN no application code was modified or restored
