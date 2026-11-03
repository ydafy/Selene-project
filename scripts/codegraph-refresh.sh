#!/usr/bin/env sh
# Keeps the local CodeGraph index (.codegraph/, gitignored) current from the Git hooks,
# because the native Gentle codegraph tool has no file watcher. A worktree without an
# index gets one built; otherwise only the changed files are synced. It runs in the
# background so Git never waits, and does nothing when codegraph is not installed.
command -v codegraph >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

if [ -f "$root/.codegraph/codegraph.db" ]; then
  set -- sync -q "$root"
else
  set -- init -y "$root"
fi

(codegraph "$@" </dev/null >/dev/null 2>&1 &)
exit 0
