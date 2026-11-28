#!/usr/bin/env bash
# Labels a Finding issue from its form answers: `finding`, one `priority:*`, one `area:*`.
# Answers that do not match a Finding form option leave that label group untouched, and
# the script comments once (marked <!-- label-finding:missing-answers -->) naming the
# heading and its valid options.
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

marker='<!-- label-finding:missing-answers -->'

# label=option text, in the order of .github/ISSUE_TEMPLATE/finding.yml.
priority_table=(
  "priority:critical=Critical (money, data loss, or production broken)"
  "priority:high=High (wrong behavior users will hit)"
  "priority:medium=Medium (edge case or degraded experience)"
  "priority:low=Low (cleanup, tooling, docs)"
)
area_table=(
  "area:payments=Payments and payouts"
  "area:orders=Orders and shipments"
  "area:mobile=Mobile app"
  "area:admin-web=Admin web"
  "area:edge-functions=Edge Functions"
  "area:database=Database"
  "area:tooling=Dependencies and tooling"
  "area:docs=Docs"
)

body="$(gh issue view "$issue" --json body -q .body)"
current="$(gh issue view "$issue" --json labels -q '.labels[].name')"

has_heading() {
  awk -v heading="### $1" '{ sub(/\r$/, "") } $0 == heading { found = 1; exit } END { exit !found }' <<<"$body"
}

# Prints the first non-empty line after the "### <heading>" line of the form body.
answer() {
  awk -v heading="### $1" '{ sub(/\r$/, "") } found && NF { print; exit } $0 == heading { found = 1 }' <<<"$body"
}

# Prints the label whose option text equals the answer, or nothing.
lookup() {
  local wanted="$1" row
  shift
  for row in "$@"; do
    if [[ "${row#*=}" == "$wanted" ]]; then
      echo "${row%%=*}"
      return 0
    fi
  done
}

priority="$(lookup "$(answer Priority)" "${priority_table[@]}")"
area="$(lookup "$(answer Area)" "${area_table[@]}")"

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

if ! $dry_run && ((${#add[@]} + ${#remove[@]})); then
  args=()
  ((${#add[@]})) && args+=(--add-label "$(join "${add[@]}")")
  ((${#remove[@]})) && args+=(--remove-label "$(join "${remove[@]}")")
  gh issue edit "$issue" "${args[@]}" >/dev/null
fi

# Headings whose answer matched no option.
unmatched=()
[[ -n "$priority" ]] || unmatched+=(Priority)
[[ -n "$area" ]] || unmatched+=(Area)
((${#unmatched[@]})) || exit 0

# Captured first: a gh failure stops the script instead of reading as "no marker".
comments="$(gh issue view "$issue" --json comments -q '.comments[].body')"
if grep -qF "$marker" <<<"$comments"; then
  echo "#$issue: missing-answers comment already posted"
  exit 0
fi

comment() {
  local heading row
  echo "$marker"
  echo "The issue labeler could not read every answer it needs from this issue body:"
  echo
  for heading in "${unmatched[@]}"; do
    if has_heading "$heading"; then
      echo "- The \`### $heading\` answer is not one of the options."
    else
      echo "- The \`### $heading\` heading is missing."
    fi
  done
  echo
  echo "Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes."
  for heading in "${unmatched[@]}"; do
    local -n table="${heading,,}_table"
    echo
    echo "\`### $heading\`:"
    echo
    for row in "${table[@]}"; do
      echo "- ${row#*=}"
    done
  done
}

if $dry_run; then
  echo "#$issue: would comment:"
  comment
  exit 0
fi

comment | gh issue comment "$issue" --body-file - >/dev/null
echo "#$issue: commented on missing answers"
