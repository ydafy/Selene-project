#!/usr/bin/env bash
# Labels a Finding issue from its form answers: `finding`, one `priority:*`, one `area:*`.
# Answers that do not match a Finding form option leave that label group untouched.
# Usage: label-finding.sh [--dry-run] <issue-number>
# Runs from .github/workflows/issue-labels.yml; also usable locally with an authenticated gh.
set -euo pipefail

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
  shift
fi
issue="${1:?usage: label-finding.sh [--dry-run] <issue-number>}"
if [[ ! "$issue" =~ ^[0-9]+$ ]]; then
  echo "issue number must be numeric: $issue" >&2
  exit 2
fi

body="$(gh issue view "$issue" --json body -q .body)"
current="$(gh issue view "$issue" --json labels -q '.labels[].name')"

# Prints the first non-empty line after the "### <heading>" line of the form body.
answer() {
  awk -v heading="### $1" '{ sub(/\r$/, "") } found && NF { print; exit } $0 == heading { found = 1 }' <<<"$body"
}

priority_label() {
  case "$1" in
    "Critical (money, data loss, or production broken)") echo "priority:critical" ;;
    "High (wrong behavior users will hit)") echo "priority:high" ;;
    "Medium (edge case or degraded experience)") echo "priority:medium" ;;
    "Low (cleanup, tooling, docs)") echo "priority:low" ;;
  esac
}

area_label() {
  case "$1" in
    "Payments and payouts") echo "area:payments" ;;
    "Orders and shipments") echo "area:orders" ;;
    "Mobile app") echo "area:mobile" ;;
    "Admin web") echo "area:admin-web" ;;
    "Edge Functions") echo "area:edge-functions" ;;
    "Database") echo "area:database" ;;
    "Dependencies and tooling") echo "area:tooling" ;;
    "Docs") echo "area:docs" ;;
  esac
}

priority="$(priority_label "$(answer Priority)")"
area="$(area_label "$(answer Area)")"

add=()
remove=()
has_label() { grep -qxF "$1" <<<"$current"; }
has_label finding || add+=(finding)

# Keeps exactly one label of the group: adds the wanted one, removes the others.
sync_group() {
  local prefix="$1" wanted="$2" name
  [[ -n "$wanted" ]] || return 0
  has_label "$wanted" || add+=("$wanted")
  while IFS= read -r name; do
    [[ "$name" == "$prefix"* && "$name" != "$wanted" ]] && remove+=("$name")
  done <<<"$current"
  return 0
}
sync_group "priority:" "$priority"
sync_group "area:" "$area"

join() { local IFS=,; echo "$*"; }
echo "#$issue: priority=${priority:-unmatched} area=${area:-unmatched} add=[$(join "${add[@]}")] remove=[$(join "${remove[@]}")]"

if $dry_run || ((${#add[@]} + ${#remove[@]} == 0)); then
  exit 0
fi

args=()
((${#add[@]})) && args+=(--add-label "$(join "${add[@]}")")
((${#remove[@]})) && args+=(--remove-label "$(join "${remove[@]}")")
gh issue edit "$issue" "${args[@]}" >/dev/null
