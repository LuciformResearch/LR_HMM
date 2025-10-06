#!/usr/bin/env bash
set -euo pipefail

# git_scrub_secrets.sh — scan, redact in working tree, and (optionally) rewrite history to remove secrets.
# Goals:
#  - Preserve local work: create a mirror backup before any history rewrite
#  - Default patterns focus on OpenAI-style keys found by GH Push Protection (e.g., sk-...)
#  - Safe by default: history rewrite requires explicit --i-know-what-i-am-doing
#
# Usage:
#   scripts/git_scrub_secrets.sh scan [<path_glob>...]
#   scripts/git_scrub_secrets.sh scrub-working [<path_glob>...]
#   scripts/git_scrub_secrets.sh scrub-history [--i-know-what-i-am-doing]
#
# Notes:
#  - scan/scrub-working can be scoped to artefacts or target files.
#  - scrub-history uses git-filter-repo with a regex replace file.
#  - A backup mirror is created in ../<repo_name>.backup.<timestamp>.git (safe to keep or delete later).

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "${ROOT_DIR}" ]]; then
  echo "Not a git repository (or no permissions)" >&2
  exit 2
fi
cd "$ROOT_DIR"

CMD=${1:-}
shift || true

# Default regex patterns (OpenAI-style keys)
DEFAULT_REGEX='sk-REDACTED'

scan() {
  local patterns=("$@")
  if [[ ${#patterns[@]} -eq 0 ]]; then
    patterns=(".")
  fi
  echo "Scanning for potential secrets (pattern: $DEFAULT_REGEX) in: ${patterns[*]}" >&2
  if command -v rg >/dev/null 2>&1; then
    rg -n --pcre2 "$DEFAULT_REGEX" -- ${patterns[@]} || true
  else
    grep -RInE "$DEFAULT_REGEX" -- ${patterns[@]} || true
  fi
}

scrub_working() {
  local patterns=("$@")
  if [[ ${#patterns[@]} -eq 0 ]]; then
    # Default to artefacts and common JSON/text
    patterns=("artefacts" "REGENERATE_CONTEXT*.md" "README.md")
  fi
  echo "Redacting secrets in working tree (pattern: $DEFAULT_REGEX) for: ${patterns[*]}" >&2
  # Gather files containing matches
  local files
  if command -v rg >/dev/null 2>&1; then
    mapfile -t files < <(rg -l --pcre2 "$DEFAULT_REGEX" -- ${patterns[@]} || true)
  else
    mapfile -t files < <(grep -RIlE "$DEFAULT_REGEX" -- ${patterns[@]} || true)
  fi
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "No matching files found; nothing to redact." >&2
    return 0
  fi
  for f in "${files[@]}"; do
    # In-place redact using perl for robust regex
    perl -0777 -pe "s/$DEFAULT_REGEX/sk-REDACTED" -i "$f"
    echo "Redacted: $f"
  done
  echo "Done. Review changes (git diff), then commit when ready." >&2
}

scrub_history() {
  local force_flag=${1:-}
  if ! command -v git-filter-repo >/dev/null 2>&1 && ! command -v git-filter-repo.py >/dev/null 2>&1; then
    echo "git-filter-repo not found. Install: https://github.com/newren/git-filter-repo" >&2
    exit 2
  fi
  if [[ "$force_flag" != "--i-know-what-i-am-doing" ]]; then
    cat >&2 <<WARN
This will rewrite git history and require force-push to remotes.
To proceed, re-run with: scrub-history --i-know-what-i-am-doing
WARN
    exit 2
  fi
  local ts
  ts=$(date +"%Y%m%d_%H%M%S")
  local repo_name
  repo_name=$(basename "$ROOT_DIR")
  local backup_dir="../${repo_name}.backup.${ts}.git"
  echo "Creating mirror backup at: $backup_dir" >&2
  git clone --mirror . "$backup_dir"

  # Prepare replace-text file for filter-repo
  local repl=./.git/filter-replace-secrets.txt
  mkdir -p .git
  cat > "$repl" <<EOF
regex:$DEFAULT_REGEX==>sk-REDACTED
EOF

  echo "Rewriting history with git-filter-repo (regex replacements)..." >&2
  if command -v git-filter-repo >/dev/null 2>&1; then
    git-filter-repo --replace-text "$repl" --force
  else
    git-filter-repo.py --replace-text "$repl" --force
  fi

  cat >&2 <<DONE
History rewritten. Next steps (manual):
  1) Verify: git log --oneline, inspect redactions
  2) Force-push remotes:
       git push --force origin HEAD:master
       git push --force github HEAD:master
  3) Keep backup mirror at $backup_dir for safety
DONE
}

case "$CMD" in
  scan)
    scan "$@" ;;
  scrub-working)
    scrub_working "$@" ;;
  scrub-history)
    scrub_history ${1:-} ;;
  *)
    cat >&2 <<USAGE
Usage:
  $0 scan [<path_glob>...]
  $0 scrub-working [<path_glob>...]
  $0 scrub-history [--i-know-what-i-am-doing]

Examples:
  $0 scan artefacts/HMM/parsed artefacts/HMM/compressed
  $0 scrub-working artefacts/HMM/parsed artefacts/HMM/compressed
  $0 scrub-history --i-know-what-i-am-doing
USAGE
    exit 2;;
esac

