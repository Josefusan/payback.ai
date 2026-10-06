#!/usr/bin/env python3
"""Production architecture audit — mechanical layer for docs/14-production-audit.md. Stdlib only.

Runs the deterministic boundary/pillar checks and writes evals/out/audit.json. Metrics the script
cannot judge mechanically are marked `manual` for the architecture-auditor agent, which may raise a
metric above its floor only with cited evidence, and may not drop below the floor without naming the
evidence that contradicts a check.

Ladder + pillars: .claude/skills/production-architecture-audit/references/{boundary-ladder,audit-pillars}.md
Payback reading:  .../references/payback-reading.md

Usage: python evals/architecture_audit.py [--json]
Exit 0 always (a low score is a finding, not a script error); --json prints the report.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evals" / "out"
W = "apps/worker/src"


def _read(rel: str) -> str:
    f = ROOT / rel
    return f.read_text(errors="replace") if f.exists() else ""


def _files(pattern: str) -> dict[str, str]:
    return {str(f.relative_to(ROOT)): f.read_text(errors="replace") for f in sorted(ROOT.glob(pattern)) if f.is_file()}


def _hits(files: dict[str, str], rx: str) -> list[str]:
    pat = re.compile(rx)
    out: list[str] = []
    for name, text in files.items():
        for m in pat.finditer(text):
            out.append(f"{name}:{text[: m.start()].count(chr(10)) + 1}")
    return out


# ── check functions: return (ok, evidence) ────────────────────────────────────────────────
def mount_only():
    t = _read(f"{W}/index.ts")
    h = re.findall(r'\.(?:get|post|put|delete|all)\(\s*["\']/', t) + re.findall(r"\.prepare\(", t)
    return (not h), "index.ts mounts only" if not h else f"index.ts holds {len(h)} route/SQL statement(s)"


def route_no_sql():
    routes = _files(f"{W}/routes/*.ts")
    h = _hits(routes, r"\.prepare\(|env\.DB\.batch")
    return (not h), "no SQL in route modules" if not h else "SQL in routes: " + ", ".join(sorted(h))


def no_cross_domain_import():
    business = {"ledger", "clef", "coa", "money", "policy", "decision-provider", "reports", "reconcile", "audit"}
    bad = [n for n, t in _files(f"{W}/*.ts").items() if n.rsplit("/", 1)[-1][:-3] in business and re.search(r'from "\./paypal"', t)]
    return (not bad), "no business module imports the PayPal adapter" if not bad else "adapter leak: " + ", ".join(bad)


def central_error_handler():
    ok = bool(re.search(r"onError\(", _read(f"{W}/index.ts")))
    return ok, "app.onError registered" if ok else "no app.onError() in index.ts"


def cents_columns():
    t = "\n".join(_files("apps/worker/migrations/*.sql").values())
    ok = "amount_cents" in t and "debit_cents" in t
    return ok, "money stored as integer cents" if ok else "money columns are not integer cents"


def indexes():
    h = _hits(_files("apps/worker/migrations/*.sql"), r"CREATE (?:UNIQUE )?INDEX")
    return (len(h) >= 3), f"{len(h)} index(es) in migrations"


def append_only():
    h = _hits(_files("apps/worker/migrations/*.sql"), r"RAISE\(ABORT")
    return (len(h) >= 1), f"{len(h)} append-only trigger(s)" if h else "no append-only triggers"


def expand_contract():
    h = _hits(_files("apps/worker/migrations/*.sql"), r"DROP\s+(?:COLUMN|TABLE)")
    return (not h), "migrations additive (no DROP)" if not h else "destructive DDL: " + ", ".join(h)


def contracts_dto():
    ok = (ROOT / "packages/contracts/api.ts").exists()
    return ok, "packages/contracts/api.ts present"


def idempotency():
    ok = "PayPal-Request-Id" in _read(f"{W}/paypal.ts") and "idempotencyKey" in _read(f"{W}/policy.ts")
    return ok, "idempotency keys on money movement" if ok else "missing PayPal-Request-Id or idempotencyKey"


def request_validation():
    h = _hits(_files(f"{W}/routes/*.ts"), r"zod|valibot|safeParse|\.parse\(")
    return (bool(h)), "request schema validation in routes" if h else "no request validation in routes"


def rate_limit():
    h = _hits(_files(f"{W}/*.ts"), r"rate.?limit|RateLimit")
    return (bool(h)), "rate limiting present" if h else "no rate limiting"


def stateless_no_map():
    h = _hits(_files(f"{W}/routes/*.ts"), r"new Map[<(]")
    return (not h), "no module-scoped Map in routes" if not h else "in-memory Map in routes (resets per isolate): " + ", ".join(h)


def timeouts():
    ok = bool(re.search(r"signal:|AbortSignal\.timeout", _read(f"{W}/paypal.ts")))
    return ok, "outbound calls carry a timeout" if ok else "no fetch timeout / circuit breaker in paypal.ts"


def queue_worker():
    ok = "consumers" in _read("apps/worker/wrangler.jsonc") and "queue:" in _read(f"{W}/index.ts")
    return ok, "queue producer + consumer configured" if ok else "no queue consumer wired"


def cron():
    ok = "crons" in _read("apps/worker/wrangler.jsonc")
    return ok, "scheduled sync via cron" if ok else "no cron trigger"


def web_ssot():
    for cand in ("apps/web/src/store", "apps/web/src/state", "apps/web/src/data"):
        if (ROOT / cand).exists():
            return True, f"{cand}/ present"
    return False, "no client state dir (apps/web/src/store)"


CHECKS = {
    "mount_only": mount_only, "route_no_sql": route_no_sql, "no_cross_domain_import": no_cross_domain_import,
    "central_error_handler": central_error_handler, "cents": cents_columns, "indexes": indexes,
    "append_only": append_only, "expand_contract": expand_contract, "contracts_dto": contracts_dto,
    "idempotency": idempotency, "validation": request_validation, "rate_limit": rate_limit,
    "stateless_no_map": stateless_no_map, "timeouts": timeouts, "queue_worker": queue_worker,
    "cron": cron, "web_ssot": web_ssot,
}

# Each metric: (id, name, machine checks). Same three metric names per pillar (audit-pillars.md).
PILLARS = [
    ("P1", "Separation of Concerns", [
        ("P1.1", "Architecture Alignment", ["mount_only", "route_no_sql", "no_cross_domain_import"]),
        ("P1.2", "Operational Implementation", ["mount_only", "route_no_sql"]),
        ("P1.3", "Failure Mode Preparedness", ["central_error_handler"]),
    ]),
    ("P2", "Data Modeling & Persistence", [
        ("P2.1", "Architecture Alignment", ["cents", "indexes"]),
        ("P2.2", "Operational Implementation", ["indexes", "append_only"]),
        ("P2.3", "Failure Mode Preparedness", ["append_only"]),
    ]),
    ("P3", "State Management", [
        ("P3.1", "Architecture Alignment", ["web_ssot"]),
        ("P3.2", "Operational Implementation", ["web_ssot"]),
        ("P3.3", "Failure Mode Preparedness", []),
    ]),
    ("P4", "APIs and Interfaces", [
        ("P4.1", "Architecture Alignment", ["contracts_dto"]),
        ("P4.2", "Operational Implementation", ["idempotency", "validation"]),
        ("P4.3", "Failure Mode Preparedness", ["rate_limit", "idempotency"]),
    ]),
    ("P5", "Data Migrations & Versioning", [
        ("P5.1", "Architecture Alignment", ["expand_contract"]),
        ("P5.2", "Operational Implementation", ["expand_contract", "append_only"]),
        ("P5.3", "Failure Mode Preparedness", ["expand_contract"]),
    ]),
    ("P6", "Scalability & Resilience", [
        ("P6.1", "Architecture Alignment", ["queue_worker", "cron"]),
        ("P6.2", "Operational Implementation", ["queue_worker", "cron"]),
        ("P6.3", "Failure Mode Preparedness", ["timeouts", "stateless_no_map"]),
    ]),
]


def floor_for(checks: list[str]) -> tuple[int | None, list[dict]]:
    if not checks:
        return None, []
    results = []
    for name in checks:
        ok, evidence = CHECKS[name]()
        results.append({"check": name, "ok": ok, "evidence": evidence})
    passed = sum(1 for r in results if r["ok"])
    score = 5 if passed == len(results) else (3 if passed else 1)
    return score, results


def detect_level() -> dict:
    mount = mount_only()[0]
    no_sql = route_no_sql()[0]
    dto = contracts_dto()[0]
    if not mount and not no_sql:
        level, why = 0, "SQL and handlers live outside any boundary"
    elif not (mount and no_sql):
        level, why = 1, "boundaries exist but SQL still runs in route modules"
    else:
        level = 2 if dto else 1
        why = "domains own tables; routes call the interface; DTO contract present" if dto else "boundary present but no DTO contract"
    return {"level": level, "target": 2, "why": why}


def main(argv: list[str]) -> int:
    report = {"generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
              "ladder": detect_level(), "pillars": [], "total": 0, "manual_metrics": 0}

    for pid, pname, metrics in PILLARS:
        pillar = {"id": pid, "name": pname, "metrics": [], "score": 0, "target": 12}
        for mid, mname, checks in metrics:
            score, results = floor_for(checks)
            pillar["metrics"].append({"id": mid, "name": mname, "manual": score is None, "floor": score, "checks": results})
            if score is None:
                report["manual_metrics"] += 1
            else:
                pillar["score"] += score
                report["total"] += score
        pillar["complete"] = all(not m["manual"] for m in pillar["metrics"])
        pillar["priority"] = "High" if pillar["score"] < 9 else ("Med" if pillar["score"] < 12 else "Low")
        report["pillars"].append(pillar)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "audit.json").write_text(json.dumps(report, indent=2) + "\n")

    lad = report["ladder"]
    print(f"LADDER  level {lad['level']} (target {lad['target']}) — {lad['why']}")
    for p in report["pillars"]:
        flags = "".join("·" if m["manual"] else ("+" if m["floor"] == 5 else ("~" if m["floor"] == 3 else "-")) for m in p["metrics"])
        print(f"{p['id']} {p['name']:<32} {p['score']:>2}/15  {p['priority']:<4} [{flags}]")
        for m in p["metrics"]:
            bad = [c["evidence"] for c in m["checks"] if not c["ok"]]
            tag = "manual" if m["manual"] else f"floor {m['floor']}"
            print(f"    {m['id']} {m['name']:<30} {tag:<8}" + (f"  ✗ {bad[0]}" if bad else ""))
    print(f"mechanical total {report['total']}/90  ({report['manual_metrics']} metric(s) need the auditor)")
    print("artefact: evals/out/audit.json")
    if "--json" in argv:
        print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
