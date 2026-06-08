# Archive Report — account-settings

**Change**: account-settings
**Project**: Selene — School-portal
**Archived**: 2026-06-04
**Mode**: hybrid (openspec + engram)
**Verdict at archive**: PASS WITH WARNINGS (1 CRITICAL: hardcoded "OK" string in DeleteAccountSection.tsx:139)
**Commit**: `92a5ca4` (27 files, 2115 insertions, 72 tests pass)

---

## Engram Observation IDs (Traceability)

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| explore | #141 | `sdd/account-settings/explore` |
| proposal | #142 | `sdd/account-settings/proposal` |
| spec | #143 | `sdd/account-settings/spec` |
| design | #144 | `sdd/account-settings/design` |
| tasks | #146 | `sdd/account-settings/tasks` |
| apply-progress | #147 | `sdd/account-settings/apply-progress` |
| verify-report | #148 | `sdd/account-settings/verify-report` |
| archive-report | (this) | `sdd/account-settings/archive-report` |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| settings | Created | New domain — `openspec/specs/settings/spec.md` created from delta spec. 10 requirements (CONF-001..CONF-010), all ADDED, none MODIFIED or REMOVED. |

Delta was all-additive (no MODIFIED/REMOVED requirements). No destructive merge was needed.

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| proposal.md | ✅ |
| specs.md | ✅ |
| design.md | ✅ |
| tasks.md | ✅ (17/18 complete; 5.4 skipped — no RNTL setup) |
| verify-report.md | ✅ |
| explore.md | ✅ |
| archive-report.md | ✅ (this file) |

---

## Source of Truth Updated

The following main spec now reflects the new behavior:
- `openspec/specs/settings/spec.md`

---

## Implementation Summary

- `/profile/settings` screen with 4 sections: Cuenta, General, Seguridad, Privacidad
- Username inline edit + optimistic update via `useUpdateProfile`
- Logout with `ConfirmDialog`
- Delete Account: double-confirm + typed phrase `ELIMINAR` + Edge Function with 4 pre-checks
- Cog icon → settings, Direcciones → `/address/form`
- i18n: `settings` namespace (es + en)
- 27 files, 2115 insertions across frontend + Edge Function
- `bun test` — 72 pass / 0 fail

---

## Known Issues at Archive

1. **CRITICAL**: Hardcoded `"OK"` in `DeleteAccountSection.tsx:139` violates CONF-007 i18n coverage. Should use `t('common:ok', 'Aceptar')`.
2. **WARNING**: CONF-005 phrase-mismatch disables submit only post-click, not via button `disabled` prop.
3. **WARNING**: Username regex stricter than spec (`{3,30}` length cap added).
4. **WARNING**: `errors.authRequired` i18n key defined but unused (401 path unmapped).
5. **WARNING**: Design said RHF+Zod, implementation uses raw `useState`.

---

## SDD Cycle Complete

The change has been fully planned (explore → propose → spec → design → tasks), implemented (apply with strict TDD), verified (PASS WITH WARNINGS), and archived.

**Next**: Ready for the next change.
