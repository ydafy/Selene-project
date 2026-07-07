# Delta for Admin Payments Page — Discontinued

## ADDED Requirements

_(None. This change is intentionally discontinued and must not be archived as an active implemented capability.)_

## MODIFIED Requirements

_(None.)_

## REMOVED Requirements

### Requirement: Admin Payments Page Module

The previously planned `admin-payments-page` capability is no longer active. The module was discarded/removed from the repository by user decision and SHALL NOT be treated as a successfully delivered payments feature.

**Reason**: User decision superseded the planned implementation; the module is no longer part of the active product scope.

**Migration**: Archive this change as `DISCARDED / SUPERSEDED / NO LONGER ACTIVE`. Do not sync the legacy PAY-001–PAY-012 requirements into active product expectations as implemented behavior.

#### Scenario: Archive records discontinued status

- GIVEN the `admin-payments-page` change is archived
- WHEN future agents inspect the OpenSpec history
- THEN they see that the module was discarded by user decision
- AND they do not treat the legacy implementation tasks as completed production functionality

#### Scenario: Active repository remains unchanged

- GIVEN this archive repair is artifact-only
- WHEN the repair is complete
- THEN no application code is modified or restored
