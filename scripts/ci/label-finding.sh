#!/usr/bin/env bash
# Labels a Finding issue from its form answers: `finding`, one `priority:*`, one `area:*`.
# An answer is the non-empty lines between its "### " heading and the next one; it matches
# only when it is exactly one line equal to a Finding form option. An answer that does not
# match leaves that label group untouched, and the script comments once (marked
# <!-- label-finding:missing-answers -->) naming the heading and its valid options.
# Usage: label-finding.sh [--dry-run] <issue-number>
# Runs from .github/workflows/issue-labels.yml; also usable locally with an authenticated gh.
# Only marker comments by LABEL_FINDING_BOT_LOGIN (default github-actions, the login gh
# reports for github.token) count as already posted; set it when running as another user.
# Written for bash 3.2 and later.
set -euo pipefail

export LABEL_FINDING_BOT_LOGIN="${LABEL_FINDING_BOT_LOGIN:-github-actions}"

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

# Prints the non-empty lines between the "### <heading>" line and the next "### " line.
answer() {
  awk -v heading="### $1" '{ sub(/\r$/, "") } found && /^### / { exit } found && NF { print } $0 == heading { found = 1 }' <<<"$body"
}

# Prints the label of the heading's table rows (passed after it) that the answer
# matches, or `missing`, `many` (several lines), or `unmatched`.
resolve() {
  local heading="$1" lines row
  shift
  if ! has_heading "$heading"; then
    echo missing
    return 0
  fi
  lines="$(answer "$heading")"
  if [[ "$lines" == *$'\n'* ]]; then
    echo many
    return 0
  fi
  for row in "$@"; do
    if [[ -n "$lines" && "${row#*=}" == "$lines" ]]; then
      echo "${row%%=*}"
      return 0
    fi
  done
  echo unmatched
}

priority_result="$(resolve Priority "${priority_table[@]}")"
area_result="$(resolve Area "${area_table[@]}")"
is_label() { [[ "$1" == *:* ]]; }
priority=""
area=""
is_label "$priority_result" && priority="$priority_result"
is_label "$area_result" && area="$area_result"

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
# ${a[@]+"${a[@]}"} expands an empty array without tripping set -u on bash before 4.4.
echo "#$issue: priority=${priority:-unmatched} area=${area:-unmatched} add=[$(join ${add[@]+"${add[@]}"})] remove=[$(join ${remove[@]+"${remove[@]}"})]"

if ! $dry_run && ((${#add[@]} + ${#remove[@]})); then
  args=()
  ((${#add[@]})) && args+=(--add-label "$(join ${add[@]+"${add[@]}"})")
  ((${#remove[@]})) && args+=(--remove-label "$(join ${remove[@]+"${remove[@]}"})")
  gh issue edit "$issue" "${args[@]}" >/dev/null
fi

# Headings whose answer matched no option.
unmatched=()
[[ -n "$priority" ]] || unmatched+=(Priority)
[[ -n "$area" ]] || unmatched+=(Area)
((${#unmatched[@]})) || exit 0

# Captured first: a gh failure stops the script instead of reading as "no marker".
# gh's jq reads the login from the environment, so the body never reaches the query.
comments="$(gh issue view "$issue" --json comments --jq '.comments[] | select(.author.login == env.LABEL_FINDING_BOT_LOGIN) | .body')"
if grep -qF "$marker" <<<"$comments"; then
  echo "#$issue: missing-answers comment already posted"
  exit 0
fi

comment() {
  local heading result row
  echo "$marker"
  echo "The issue labeler could not read every answer it needs from this issue body:"
  echo
  for heading in "${unmatched[@]}"; do
    case "$heading" in
      Priority) result="$priority_result" ;;
      Area) result="$area_result" ;;
    esac
    case "$result" in
      missing) echo "- The \`### $heading\` heading is missing." ;;
      many) echo "- The \`### $heading\` heading must keep exactly one option." ;;
      *) echo "- The \`### $heading\` answer is not one of the options." ;;
    esac
  done
  echo
  echo "Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes."
  for heading in "${unmatched[@]}"; do
    echo
    echo "\`### $heading\`:"
    echo
    case "$heading" in
      Priority) for row in "${priority_table[@]}"; do echo "- ${row#*=}"; done ;;
      Area) for row in "${area_table[@]}"; do echo "- ${row#*=}"; done ;;
    esac
  done
}

if $dry_run; then
  echo "#$issue: would comment:"
  comment
  exit 0
fi

comment | gh issue comment "$issue" --body-file - >/dev/null
echo "#$issue: commented on missing answers"
