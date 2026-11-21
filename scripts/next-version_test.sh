#!/usr/bin/env bash
# Table test for next-version.sh. Run: bash scripts/next-version_test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() { # name, latest tag, labels, want
  got="$(bash "$here/next-version.sh" "$2" "$3" 2>/dev/null)" || got="error"
  if [ "$got" = "$4" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: got \"$got\", want \"$4\""
    fail=1
  fi
}

check "no label is a patch"             v0.1.0  ""                          0.1.1
check "minor"                           v0.1.9  "release:minor"             0.2.0
check "major"                           v0.4.2  "release:major"             1.0.0
check "major wins over minor"           v1.2.3  "release:minor,release:major" 2.0.0
check "skip wins over everything"       v1.2.3  "release:major release:skip" skip
check "other labels are ignored"        v1.2.3  "dependencies,ui"           1.2.4
check "labels on separate lines"        v1.2.3  $'ui\nrelease:minor'         1.3.0
check "a label that only looks similar" v1.2.3  "release:minor-ish"         1.2.4
check "first release"                   ""      ""                          0.1.0
check "first release, skipped"          ""      "release:skip"              skip
check "numbers above 9"                 v0.9.19 ""                          0.9.20
check "a tag that isn't a version"      agent-dev-3 ""                      error

exit "$fail"
