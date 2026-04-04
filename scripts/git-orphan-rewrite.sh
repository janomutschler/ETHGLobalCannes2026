#!/usr/bin/env bash
# Replace current branch history with ONE new root commit (same files as now).
# Use when a secret was committed and GitHub still sees it in old blobs.
# After: git push -f origin <branch>   (destructive on remote — coordinate with team)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean. Commit or stash first, then ensure .env.example has NO real API keys."
  exit 1
fi

branch=$(git branch --show-current)
echo "Current branch: $branch"
echo "This will DELETE all commit history locally and create one fresh commit."
read -r -p "Type YES to continue: " ok
if [ "$ok" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

git checkout --orphan "__orphan_tmp__"
git add -A
git commit -m "Initial commit"
git branch -D "$branch"
git branch -m "$branch"
git reflog expire --expire=now --all
git gc --prune=now --aggressive 2>/dev/null || git gc --prune=now

echo ""
echo "Done. Old commits (and any leaked secrets in them) are no longer on this branch."
echo "Next:  git push -f origin $branch"
echo "Also:  rotate any leaked API keys in the OpenAI dashboard (treat them as compromised)."
