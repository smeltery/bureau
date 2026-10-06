#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <base-sha> <head-sha> <github-output-file>" >&2
  exit 2
fi

base="$1"
head="$2"
output_file="$3"

if [[ "$base" =~ ^0+$ ]]; then
  base="$(git rev-list --max-parents=0 "$head")"
fi

app=false
demo=false
website=false
workflow=false

while IFS= read -r path; do
  [[ -z "$path" ]] && continue

  case "$path" in
    website/*|vercel.json)
      website=true
      ;;
  esac

  case "$path" in
    demo/*)
      app=true
      demo=true
      ;;
    browser-extension/*|api/*|scripts/*|server/*|shared/*|skills/*|ui/*|.flox/*|.githooks/*|.oxlintrc.json|.prettierignore|.prettierrc.json|bun.lock|package.json|tsconfig.json)
      app=true
      ;;
  esac

  case "$path" in
    .github/workflows/*|.github/actionlint.yaml|scripts/detect-ci-areas.sh)
      workflow=true
      ;;
  esac
done < <(git diff --name-only "$base" "$head")

{
  echo "app=$app"
  echo "demo=$demo"
  echo "website=$website"
  echo "workflow=$workflow"
} >> "$output_file"
