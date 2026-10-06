#!/usr/bin/env python3
"""Machine-checkable definition of done for docs/13-build-plan.md (§7). Stdlib only.

Usage:
    python evals/dod.py T-INT-001            # one task
    python evals/dod.py --gate G0            # every exit check of a gate
    python evals/dod.py --list               # encoded task ids and gates

Exit 0 = all checks pass, 1 = a check failed, 2 = id not encoded yet.
A task's status may flip to `done` only when this exits 0. Results go to evals/out/dod.json.

Check kinds:
    ("cmd", argv, cwd, expect_exit)        run a command
    ("exists", path)                       file or directory exists
    ("absent", path, regex)                regex does not match the file
    ("json", path, dotted_key, expected)   evals/out/*.json assertion
    ("boot", argv, cwd, url, timeout_s)    long-running server answers 200 on url, then is stopped
"""
from __future__ import annotations

import json
import re
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evals" / "out"
W = "apps/worker"

TSC = ("cmd", ["npx", "tsc", "--noEmit"], W, 0)
VITEST = ("cmd", ["npx", "vitest", "run"], W, 0)

TASKS: dict[str, list[tuple]] = {
    "T-INT-001": [
        TSC, VITEST,
        ("absent", f"{W}/src/index.ts", r"\.prepare\(|\.get\(\"/|\.post\(\"/"),
        ("exists", f"{W}/src/routes"),
    ],
    "T-INT-002": [
        ("exists", "packages/contracts/api.ts"),
        ("exists", "packages/contracts/fixtures.ts"),
        ("cmd", ["npx", "vitest", "run", "src/contracts.test.ts"], W, 0),
    ],
    "T-INT-003": [
        ("exists", f"{W}/src/env.ts"),
        ("cmd", ["grep", "-q", "T-INT-003", "docs/decisions.md"], ".", 0),
    ],
    "T-INT-004": [
        ("exists", "docs/13-build-plan.md"),
        ("cmd", ["grep", "-q", "^## Eval snapshot", "docs/status.md"], ".", 0),
    ],
    "T-L2-002": [
        TSC, VITEST,
        ("exists", f"{W}/src/decision-provider.ts"),
        ("exists", f"{W}/test/fixtures/clef"),
        ("cmd", ["grep", "-q", "fallback-llm", f"{W}/src/decision-provider.ts"], ".", 0),
        ("cmd", ["npx", "vitest", "run", "src/decision-provider.test.ts"], W, 0),
    ],
    "T-L4-001": [
        ("cmd", ["npm", "run", "build"], "apps/web", 0),
        ("cmd", ["npx", "vitest", "run"], "apps/web", 0),
        ("exists", "apps/web/src/components/LedgerGrid.tsx"),
        ("exists", "apps/web/src/data/ledger.ts"),
    ],
}

GATES: dict[str, list[tuple]] = {
    "G0": [
        ("cmd", ["npx", "wrangler", "d1", "migrations", "apply", "payback", "--local"], W, 0),
        ("boot", ["npx", "wrangler", "dev", "--local", "--port", "8799"], W, "http://localhost:8799/api/health", 60),
        *TASKS["T-INT-001"], *TASKS["T-INT-002"],
        ("exists", "docs/13-build-plan.md"),
        ("exists", "evals/dod.py"),
    ],
}


def run_check(c: tuple) -> tuple[bool, str]:
    kind = c[0]
    if kind == "cmd":
        _, argv, cwd, expect = c
        p = subprocess.run(argv, cwd=ROOT / cwd, capture_output=True, text=True)
        tail = (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
        return p.returncode == expect, f"{' '.join(argv)} → exit {p.returncode} {tail[0][:120]}"
    if kind == "exists":
        return (ROOT / c[1]).exists(), c[1]
    if kind == "absent":
        _, path, rx = c
        hit = re.search(rx, (ROOT / path).read_text())
        return hit is None, f"{path} !~ /{rx}/" + (f" (found {hit.group(0)!r})" if hit else "")
    if kind == "json":
        _, path, key, expected = c
        f = ROOT / path
        if not f.exists():
            return False, f"{path} missing"
        val = json.loads(f.read_text())
        for k in key.split("."):
            val = val.get(k) if isinstance(val, dict) else None
        return val == expected, f"{path}:{key} == {expected!r} (got {val!r})"
    if kind == "boot":
        _, argv, cwd, url, timeout = c
        p = subprocess.Popen(argv, cwd=ROOT / cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    with urllib.request.urlopen(url, timeout=2) as r:
                        return r.status == 200, f"{url} → {r.status}"
                except OSError:
                    if p.poll() is not None:
                        return False, f"{' '.join(argv)} exited {p.returncode} before serving"
                    time.sleep(1)
            return False, f"{url} not up after {timeout}s"
        finally:
            subprocess.run(["kill", "-TERM", f"-{p.pid}"], capture_output=True)
    raise ValueError(f"unknown check kind {kind}")


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--list":
        print("tasks:", " ".join(sorted(TASKS)), "\ngates:", " ".join(sorted(GATES)))
        return 0
    target = argv[1] if argv[0] == "--gate" and len(argv) > 1 else argv[0]
    checks = GATES.get(target) if argv[0] == "--gate" else TASKS.get(target)
    if checks is None:
        print(f"{target}: dod not encoded yet — add it to evals/dod.py before marking it done")
        return 2
    results = []
    for c in checks:
        ok, detail = run_check(c)
        results.append({"ok": ok, "kind": c[0], "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {c[0]:<6} {detail}")
    passed = all(r["ok"] for r in results)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dod.json").write_text(json.dumps({"target": target, "pass": passed, "checks": results}, indent=2))
    print(f"{target}: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
