#!/usr/bin/env python3
"""Deterministic rules-compliance checks for the PayPal AI Hackathon submission.

Maps to Official Rules §4 (docs/01-official-rules.md). Stdlib only.

Usage:
    python evals/checks.py                       # run from repo root
    python evals/checks.py --github OWNER/REPO   # also check public visibility + detected license (unauthenticated API)
    python evals/checks.py --json                # machine output only

Exit code 1 if any HARD check fails.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evals" / "out"
DEADLINE_UTC = dt.datetime(2026, 11, 12, 20, 0, tzinfo=dt.timezone.utc)  # Nov 12 2026 12:00 PST
PERIOD_START_UTC = dt.datetime(2026, 10, 1, 16, 0, tzinfo=dt.timezone.utc)  # Oct 1 2026 09:00 PDT

CODE_DIRS = ["apps", "scripts"]
# T-INT-007 / docs/14-production-audit.md §AUD-7: routes are transport; SQL lives in the domain modules.
ROUTE_SQL_GLOB = "apps/worker/src/routes/*.ts"
ROUTE_SQL_PATTERN = r"\.prepare\(|env\.DB\.batch\("
CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".json", ".jsonc", ".toml", ".sql"}
SKIP_DIRS = {"node_modules", ".git", "dist", ".wrangler", "out", "__pycache__", ".next"}

PAYPAL_CAPABILITIES = {
    "Transaction Search": r"/v1/reporting/transactions",
    "Balances": r"/v1/reporting/balances",
    "Invoicing v2": r"/v2/invoicing/",
    "Payouts": r"/v1/payments/payouts",
    "Disputes": r"/v1/customer/disputes",
    "Orders v2": r"/v2/checkout/orders",
    "Refunds": r"/v2/payments/captures/[^\s\"'`]*refund|/refund\b",
    "Webhook verification": r"/v1/notifications/verify-webhook-signature",
    "Subscriptions": r"/v1/billing/subscriptions|/v1/billing/plans",
    "Agent Toolkit": r"@paypal/agent-toolkit|paypal_agent_toolkit",
    "PayPal MCP": r"@paypal/mcp|mcp\.sandbox\.paypal\.com",
    "JS SDK v6": r"web-sdk/v6",
    "Server SDK": r"@paypal/paypal-server-sdk",
}
AI_PATTERNS = {
    "Cloudflare Clef": r"@cf/cloudflare/clef",
    "Workers AI binding": r"\bAI\.run\(",
    "Anthropic": r"api\.anthropic\.com|@anthropic-ai/sdk|anthropic\b",
    "OpenAI": r"api\.openai\.com|from\s+['\"]openai['\"]",
    "AG Studio agents": r"directLlmRunner|delegate_to",
}
SECRET_PATTERNS = {
    "PayPal access token": r"A21AA[A-Za-z0-9_\-]{30,}",
    "Anthropic key": r"sk-ant-[A-Za-z0-9_\-]{20,}",
    "OpenAI key": r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}",
    "GitHub token": r"\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}",
    "AWS key": r"\bAKIA[0-9A-Z]{16}\b",
    "Private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "Generic secret assignment": r"(?i)\b(?:client_secret|secret|api_key|apikey|token|password)\b\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{24,}['\"]",
}
FORBIDDEN_TRACKED = [".env", ".dev.vars", "apps/worker/.dev.vars", ".env.local"]
LICENSE_MARKERS = {
    "MIT": "Permission is hereby granted, free of charge",
    "Apache-2.0": "Apache License",
    "BSD": "Redistribution and use in source and binary forms",
    "MPL-2.0": "Mozilla Public License",
    "GPL": "GNU GENERAL PUBLIC LICENSE",
}
README_SECTIONS = {
    # id: (regex over headings/body, hard?)
    "what_it_does": (r"(?im)^#+\s*(overview|what it does|about)", False),
    "paypal_usage": (r"(?i)paypal", True),
    "ai_usage": (r"(?i)\b(ai|clef|model|agent)\b", True),
    "tools_used": (r"(?im)^#+\s*.*tools", True),
    "setup_run": (r"(?im)^#+\s*.*(run it|setup|getting started|quick ?start|install)", True),
    "testing_access": (r"(?im)^#+\s*.*(testing|test access|credentials|judges)", True),
    "demo_video": (r"(?i)(youtube\.com|youtu\.be|demo video)", True),
    "license": (r"(?im)^#+\s*license", False),
    "built_during_period": (r"(?i)(submission period|built during|hackathon period)", False),
    "architecture": (r"(?im)^#+\s*architecture", False),
}


class Results:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, cid: str, title: str, status: str, hard: bool, detail: str, rule: str) -> None:
        self.items.append({"id": cid, "title": title, "status": status, "hard": hard, "detail": detail, "rule": rule})

    @property
    def hard_failures(self) -> list[dict]:
        return [i for i in self.items if i["hard"] and i["status"] == "FAIL"]


def tracked_files() -> list[Path]:
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        files = [ROOT / line for line in out.splitlines() if line]
        if files:
            return files
    except Exception:
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            files.append(Path(dirpath) / f)
    return files


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def code_files(files: list[Path]) -> list[Path]:
    res = []
    for f in files:
        rel = f.relative_to(ROOT)
        if rel.parts and rel.parts[0] in CODE_DIRS and f.suffix in CODE_EXT and not (set(rel.parts) & SKIP_DIRS):
            res.append(f)
    return res


def check_license(r: Results) -> None:
    lic = next((ROOT / n for n in ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"] if (ROOT / n).exists()), None)
    if not lic:
        r.add("license_file", "Open-source LICENSE at repo root", "FAIL", True, "No LICENSE file found", "§4 Submission Req. 4")
        return
    text = read(lic)
    kind = next((k for k, m in LICENSE_MARKERS.items() if m in text), None)
    r.add("license_file", "Open-source LICENSE at repo root", "PASS" if kind else "FAIL", True,
          f"{lic.name}: {kind or 'unrecognized license text'}", "§4 Submission Req. 4")


def check_readme(r: Results) -> None:
    readme = ROOT / "README.md"
    text = read(readme)
    if not text:
        r.add("readme", "README exists", "FAIL", True, "README.md missing", "§4 Submission Req. 2-4")
        return
    for sid, (pattern, hard) in README_SECTIONS.items():
        ok = re.search(pattern, text) is not None
        status = "PASS" if ok else ("FAIL" if hard else "WARN")
        if sid == "demo_video" and ok and "PLACEHOLDER" in text.upper():
            status = "PENDING"
        r.add(f"readme_{sid}", f"README covers: {sid.replace('_', ' ')}", status, hard, "found" if ok else "missing", "§4 Submission Req.")


def check_paypal(r: Results, files: list[Path]) -> None:
    blob = "\n".join(read(f) for f in code_files(files))
    used = [name for name, pat in PAYPAL_CAPABILITIES.items() if re.search(pat, blob)]
    n = len(used)
    status = "PASS" if n >= 4 else ("WARN" if n >= 1 else "FAIL")
    r.add("paypal_integration", "PayPal developer platform integrated (target >=4 capabilities)", status, True,
          f"{n} found: {', '.join(used) or 'none'}", "§4 Project Req. / Stage One")
    live_hits = []
    for f in code_files(files):
        for i, line in enumerate(read(f).splitlines(), 1):
            if re.search(r"api-m\.paypal\.com|//mcp\.paypal\.com|www\.paypal\.com/web-sdk", line) and "LIVE_FORBIDDEN" not in line:
                live_hits.append(f"{f.relative_to(ROOT)}:{i}")
    r.add("sandbox_only", "Only PayPal SANDBOX endpoints in code", "FAIL" if live_hits else "PASS", True,
          ", ".join(live_hits[:10]) or "no live endpoints", "§4 Project Req. (sandbox)")


def check_ai(r: Results, files: list[Path]) -> None:
    blob = "\n".join(read(f) for f in code_files(files))
    used = [name for name, pat in AI_PATTERNS.items() if re.search(pat, blob)]
    r.add("ai_integration", "AI tool/model integrated in code", "PASS" if used else "FAIL", True,
          ", ".join(used) or "none", "§4 Project Req. / Stage One")


def check_secrets(r: Results, files: list[Path]) -> None:
    hits = []
    for f in files:
        rel = f.relative_to(ROOT)
        if set(rel.parts) & SKIP_DIRS or f.suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".ico", ".lock"}:
            continue
        if rel.name == "checks.py":
            continue
        text = read(f)
        for name, pat in SECRET_PATTERNS.items():
            for m in re.finditer(pat, text):
                snippet = m.group(0)
                # Synthetic values are not secrets: test fixtures/placeholders are exempt (a real
                # token never contains these markers).
                if re.search(r"(?i)(your_|example|placeholder|xxxx|changeme|fixture|<)", snippet):
                    continue
                hits.append(f"{rel} [{name}]")
    tracked = [p for p in FORBIDDEN_TRACKED if (ROOT / p) in set(files)]
    status = "FAIL" if hits or tracked else "PASS"
    detail = "; ".join(hits[:10] + [f"tracked env file: {t}" for t in tracked]) or "clean"
    r.add("no_secrets", "No secrets / env files committed", status, True, detail, "Security; §4 Testing (sandbox creds via instructions)")
    r.add("env_example", ".env.example present", "PASS" if (ROOT / ".env.example").exists() else "WARN", False,
          "", "§4 Testing (setup instructions)")


def check_video(r: Results) -> None:
    meta = ROOT / "submission" / "video.json"
    if not meta.exists():
        r.add("video", "Demo video metadata (submission/video.json)", "PENDING", True, "file missing", "§4 Submission Req. 5")
        return
    try:
        data = json.loads(read(meta))
    except json.JSONDecodeError as e:
        r.add("video", "Demo video metadata", "FAIL", True, f"invalid JSON: {e}", "§4 Submission Req. 5")
        return
    url = data.get("youtube_url") or ""
    dur = data.get("duration_seconds")
    vis = (data.get("visibility") or "").lower()
    if not url or "PLACEHOLDER" in url.upper():
        r.add("video", "Demo video on YouTube, public, < 3:00", "PENDING", True, "not uploaded yet", "§4 Submission Req. 5")
        return
    problems = []
    if not re.match(r"^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[\w\-]{6,}", url):
        problems.append("not a YouTube URL")
    if not isinstance(dur, (int, float)) or dur >= 180:
        problems.append(f"duration {dur}s must be < 180s")
    elif dur > 170:
        problems.append(f"duration {dur}s is within 10s of the limit (target <= 170)")
    if vis != "public":
        problems.append(f"visibility '{vis}' must be public")
    for k in ("no_copyrighted_music", "no_third_party_trademarks", "shows_working_project"):
        if data.get(k) is not True:
            problems.append(f"{k} not attested")
    r.add("video", "Demo video on YouTube, public, < 3:00", "FAIL" if problems else "PASS", True,
          "; ".join(problems) or url, "§4 Submission Req. 5")


def check_submission_text(r: Results) -> None:
    desc = ROOT / "submission" / "devpost-description.md"
    text = read(desc)
    if not text:
        r.add("devpost_text", "Devpost text description draft", "WARN", False, "missing", "§4 Submission Req. 2")
        return
    need = {"PayPal": r"(?i)paypal", "AI": r"(?i)\b(ai|clef|model)\b", "Tools": r"(?im)^#+.*tools", "Audience": r"(?i)(for |audience|who)"}
    missing = [k for k, p in need.items() if not re.search(p, text)]
    r.add("devpost_text", "Devpost description covers PayPal, AI, tools, audience", "WARN" if missing else "PASS", False,
          ("missing: " + ", ".join(missing)) if missing else "ok", "§4 Submission Req. 2")


def check_tests(r: Results, files: list[Path]) -> None:
    tests = [f for f in files if re.search(r"\.test\.(ts|tsx|js)$|test_.*\.py$", f.name)]
    r.add("tests", "Automated tests present", "PASS" if tests else "WARN", False, f"{len(tests)} test files", "Judging: Tech Implementation")


def check_route_no_sql(r: Results) -> None:
    """AUD-7: no file under apps/worker/src/routes/ may contain SQL (`.prepare(`, `env.DB.batch(`)."""
    hits = []
    for f in sorted(ROOT.glob(ROUTE_SQL_GLOB)):
        rel = f.relative_to(ROOT)
        for i, line in enumerate(read(f).splitlines(), 1):
            if re.search(ROUTE_SQL_PATTERN, line):
                hits.append(f"{rel}:{i}")
    detail = (f"{len(hits)} SQL statement(s) in route modules: " + ", ".join(hits[:10]) if hits
              else "no .prepare( / env.DB.batch( under apps/worker/src/routes/")
    r.add("route_no_sql", "No SQL in route modules (routes are transport)", "FAIL" if hits else "PASS", True,
          detail, "docs/14-production-audit.md §AUD-7; Judging: Tech Implementation")


def check_new_project(r: Results) -> None:
    try:
        out = subprocess.run(["git", "log", "--reverse", "--format=%cI", "--max-parents=0"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout.split()
        first = dt.datetime.fromisoformat(out[0]) if out else None
    except Exception:
        first = None
    if first is None:
        r.add("new_project", "Project created/updated during Submission Period", "PENDING", False, "no git history available", "§4 New & Existing")
    else:
        ok = first >= PERIOD_START_UTC
        r.add("new_project", "Project created during Submission Period", "PASS" if ok else "WARN", False,
              f"first commit {first.isoformat()}" + ("" if ok else " — pre-existing: README must explain significant updates"), "§4 New & Existing")


def check_github(r: Results, slug: str) -> None:
    url = f"https://api.github.com/repos/{slug}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "hackathon-checks"}), timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        status = "FAIL" if e.code == 404 else "WARN"
        r.add("github_public", "GitHub repo is public", status, True, f"HTTP {e.code} (404 = private or missing)", "§4 Submission Req. 4")
        return
    except Exception as e:  # network
        r.add("github_public", "GitHub repo is public", "PENDING", True, f"could not reach GitHub: {e}", "§4 Submission Req. 4")
        return
    r.add("github_public", "GitHub repo is public", "PASS" if not data.get("private") else "FAIL", True, data.get("html_url", ""), "§4 Submission Req. 4")
    spdx = (data.get("license") or {}).get("spdx_id")
    r.add("github_license", "License detected by GitHub (About section)", "PASS" if spdx and spdx != "NOASSERTION" else "FAIL", True,
          spdx or "none", "§4 Submission Req. 4")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--github", help="OWNER/REPO to check visibility + license via GitHub API")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    files = tracked_files()
    r = Results()
    check_license(r)
    check_readme(r)
    check_paypal(r, files)
    check_ai(r, files)
    check_secrets(r, files)
    check_video(r)
    check_submission_text(r)
    check_tests(r, files)
    check_route_no_sql(r)
    check_new_project(r)
    if args.github:
        check_github(r, args.github)

    now = dt.datetime.now(dt.timezone.utc)
    left = DEADLINE_UTC - now
    summary = {
        "generated_at": now.isoformat(),
        "deadline_utc": DEADLINE_UTC.isoformat(),
        "time_left_hours": round(left.total_seconds() / 3600, 1),
        "hard_failures": len(r.hard_failures),
        "pending": sum(1 for i in r.items if i["status"] == "PENDING"),
        "results": r.items,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "checks.json").write_text(json.dumps(summary, indent=2))

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ ", "PENDING": "⏳"}
        print(f"Rules compliance checks — {summary['time_left_hours']}h until deadline\n")
        for i in r.items:
            print(f"{icon[i['status']]} {'[HARD] ' if i['hard'] else ''}{i['title']}: {i['detail']}  ({i['rule']})")
        print(f"\nHard failures: {summary['hard_failures']} · Pending: {summary['pending']} · Report: evals/out/checks.json")
    return 1 if r.hard_failures else 0


if __name__ == "__main__":
    sys.exit(main())
