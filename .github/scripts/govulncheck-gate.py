"""Fails when govulncheck finds a vulnerability that devdeck's code calls, unless it is on the allow list.

Usage: govulncheck -format json ./... | python3 govulncheck-gate.py <allow-list file>

govulncheck's own text mode exits 3 for exactly the findings this script counts (a finding whose trace starts at a
function devdeck calls); `-format json` always exits 0, so the decision is made here. Vulnerabilities in modules
that are required but not called are only listed, as in text mode.
"""
import json
import sys


def stream(text):
    """Yields the JSON values govulncheck prints one after another."""
    decoder, i = json.JSONDecoder(), 0
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            return
        value, i = decoder.raw_decode(text, i)
        yield value


def allowed(path):
    ids = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                ids[line.split()[0]] = line
    return ids


def main():
    allow = allowed(sys.argv[1])
    called = {}
    for value in stream(sys.stdin.read()):
        finding = value.get("finding")
        if not finding:
            continue
        trace = finding.get("trace") or [{}]
        if trace[0].get("function"):
            called.setdefault(finding["osv"], trace[0].get("module", "?") + "@" + trace[0].get("version", "?"))

    blocking = {osv: where for osv, where in called.items() if osv not in allow}
    for osv, where in sorted(called.items()):
        if osv in allow:
            print(f"allowed: {osv} in {where}: {allow[osv]}")
    for osv, where in sorted(blocking.items()):
        print(f"::error::{osv} in {where}: https://pkg.go.dev/vuln/{osv}")
    if blocking:
        print(f"{len(blocking)} vulnerabilities that the code calls are not on the allow list.")
        return 1
    print(f"No vulnerabilities that the code calls, apart from {len(called)} allowed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
