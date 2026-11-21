#!/usr/bin/env bash
# Prints the next release version (no "v"), or "skip".
#
#   next-version.sh <latest tag> <labels>
#
# <latest tag> is the newest v* tag ("v0.1.0"), or empty when there is none yet.
# <labels> are the labels of the PR merged into main, separated by spaces, commas or new lines.
#   release:skip   no release
#   release:major  1.4.2 -> 2.0.0
#   release:minor  1.4.2 -> 1.5.0
#   (none)         1.4.2 -> 1.4.3
# Used by .github/workflows/release.yml; tested by scripts/next-version_test.sh.
set -euo pipefail

latest="${1:-}"
labels=" $(printf '%s' "${2:-}" | tr ',\n\t' '   ') "

case "$labels" in *" release:skip "*) echo skip; exit 0 ;; esac

if [ -z "$latest" ]; then
  echo "0.1.0"
  exit 0
fi

v="${latest#v}"
if ! [[ "$v" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "next-version: the latest tag \"$latest\" isn't vMAJOR.MINOR.PATCH" >&2
  exit 1
fi
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"

case "$labels" in
  *" release:major "*) echo "$((major + 1)).0.0" ;;
  *" release:minor "*) echo "$major.$((minor + 1)).0" ;;
  *) echo "$major.$minor.$((patch + 1))" ;;
esac
