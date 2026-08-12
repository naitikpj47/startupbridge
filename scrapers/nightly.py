#!/usr/bin/env python3
"""Nightly harvest for StartupBridge.

Three passes, one scrape_runs row each:

  discovery    — walk the enabled sources, extract outbound company
                 domains, file genuinely new ones into the review queue
                 (source=scraped). Rejected domains are skipped silently.
  refresh      — re-fetch the 50 oldest scraped profiles and update
                 scraped-rank fields only (never overwriting founder or
                 premium data — provenance decides).
  housekeeping — flag dead sites, queue re-embedding for profiles whose
                 text changed, and enqueue recompute jobs.

Runs under GitHub Actions at 05:00 Asia/Manila. Standard library only —
no pip install, so the workflow starts fast and can't break on a
dependency. Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
environment; a failure spike posts to SCRAPE_ALERT_WEBHOOK_URL if set.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ALERT_WEBHOOK = os.environ.get("SCRAPE_ALERT_WEBHOOK_URL", "")
USER_AGENT = "StartupBridge-nightly/1.0"
TIMEOUT = 20
REFRESH_BATCH = 50
FAILURE_SPIKE = 5

HERE = os.path.dirname(os.path.abspath(__file__))


# ── Supabase REST helpers ───────────────────────────────────────────────

def api(method: str, path: str, body=None, headers=None) -> tuple[int, object]:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SERVICE_KEY}")
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read().decode() or "null"
            return res.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]


def start_run(source: str) -> str | None:
    status, data = api(
        "POST", "scrape_runs", {"source": source}, {"Prefer": "return=representation"}
    )
    if status >= 300 or not isinstance(data, list) or not data:
        print(f"  ! could not open scrape_runs row: {status} {data}")
        return None
    return data[0]["id"]


def finish_run(run_id: str | None, new_found: int, updated: int, failed: int, notes: str):
    if not run_id:
        return
    api(
        "PATCH",
        f"scrape_runs?id=eq.{run_id}",
        {
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "new_found": new_found,
            "updated": updated,
            "failed": failed,
            "notes": notes[:1000],
        },
    )


def enqueue(job_type: str, payload: dict):
    api("POST", "jobs", {"type": job_type, "payload": payload})


# ── Tiny YAML reader (only the shapes sources.yaml uses) ────────────────

def load_sources(path: str) -> tuple[list[dict], set[str]]:
    sources: list[dict] = []
    ignore: set[str] = set()
    section = None
    current: dict | None = None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.rstrip()
            if not line.strip() or line.strip().startswith("#"):
                continue
            if line.startswith("sources:"):
                section = "sources"
                continue
            if line.startswith("ignore_domains:"):
                if current:
                    sources.append(current)
                    current = None
                section = "ignore"
                continue
            stripped = line.strip()
            if section == "sources":
                if stripped.startswith("- "):
                    if current:
                        sources.append(current)
                    current = {}
                    stripped = stripped[2:]
                if ":" in stripped and current is not None:
                    key, _, value = stripped.partition(":")
                    value = value.strip().strip('"').strip("'")
                    current[key.strip()] = (
                        True if value == "true" else False if value == "false" else value
                    )
            elif section == "ignore" and stripped.startswith("- "):
                ignore.add(stripped[2:].strip())
    if current:
        sources.append(current)
    return sources, ignore


# ── Fetch + parse ───────────────────────────────────────────────────────

def fetch(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            if res.status >= 400:
                return None
            return res.read(2_000_000).decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001 — any failure is just a dead source
        print(f"  ! fetch failed {url}: {type(e).__name__}")
        return None


def bare_domain(url: str) -> str | None:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
    except ValueError:
        return None
    host = host.lower().removeprefix("www.").rstrip(".")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", host):
        return None
    return host


LINK_RE = re.compile(r'href=["\'](https?://[^"\'>\s]+)', re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def outbound_domains(html: str, page_url: str, ignore: set[str]) -> dict[str, str]:
    """Map bare domain → the first URL seen for it."""
    self_domain = bare_domain(page_url)
    found: dict[str, str] = {}
    for href in LINK_RE.findall(html):
        domain = bare_domain(href)
        if not domain or domain == self_domain:
            continue
        if any(domain == skip or domain.endswith("." + skip) for skip in ignore):
            continue
        found.setdefault(domain, href.split("?")[0][:500])
    return found


def page_title(html: str, fallback: str) -> str:
    match = TITLE_RE.search(html)
    if not match:
        return fallback
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(1))).strip()
    return (text.split("|")[0].split("—")[0].strip() or fallback)[:200]


# ── Pass 1: discovery ───────────────────────────────────────────────────

def discovery(sources: list[dict], ignore: set[str]) -> int:
    run_id = start_run("discovery")
    new_found = failed = 0
    notes: list[str] = []

    enabled = [s for s in sources if s.get("enabled")]
    if not enabled:
        finish_run(run_id, 0, 0, 0, "No enabled sources in sources.yaml")
        print("discovery: no enabled sources — add real listing pages to sources.yaml")
        return 0

    status, existing = api("GET", "startups?select=domain,status&domain=not.is.null")
    known = {row["domain"]: row["status"] for row in existing} if status < 300 else {}

    for source in enabled:
        html = fetch(source["url"])
        if html is None:
            failed += 1
            notes.append(f"{source['name']}: fetch failed")
            continue
        candidates = outbound_domains(html, source["url"], ignore)
        for domain, href in candidates.items():
            if domain in known:  # includes rejected — skipped silently
                continue
            known[domain] = "under_review"
            status, created = api(
                "POST",
                "startups",
                {
                    "name": domain.split(".")[0][:200],
                    "website": href,
                    "domain": domain,
                    "source": "scraped",
                    "status": "under_review",
                },
                {"Prefer": "return=representation"},
            )
            if status >= 300 or not isinstance(created, list) or not created:
                failed += 1
                continue
            api("POST", "startup_profiles", {"startup_id": created[0]["id"]})
            enqueue("enrich_startup", {"startup_id": created[0]["id"]})
            new_found += 1

    finish_run(run_id, new_found, 0, failed, "; ".join(notes) or "ok")
    print(f"discovery: {new_found} new, {failed} failed")
    return failed


# ── Pass 2: refresh ─────────────────────────────────────────────────────

def refresh() -> int:
    run_id = start_run("refresh")
    updated = failed = 0

    status, rows = api(
        "GET",
        "startups?source=eq.scraped&status=neq.rejected&select=id,website"
        f"&order=updated_at.asc&limit={REFRESH_BATCH}",
    )
    if status >= 300 or not isinstance(rows, list):
        finish_run(run_id, 0, 0, 1, f"list failed: {rows}")
        return 1

    for row in rows:
        if not row.get("website"):
            continue
        html = fetch(row["website"])
        if html is None:
            failed += 1
            # Dead site → a flag the review queue surfaces.
            api(
                "POST",
                "rpc/append_review_flags",
                {
                    "p_startup_id": row["id"],
                    "p_flags": [
                        {
                            "type": "verify_before_intro",
                            "field": "website",
                            "detail": "Website did not respond during the nightly refresh",
                            "raised_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ],
                },
            )
            continue
        # Enrichment applies provenance rules: scraped-rank data can only
        # fill nulls or replace equal-or-lower-rank values.
        enqueue("enrich_startup", {"startup_id": row["id"]})
        updated += 1

    finish_run(run_id, 0, updated, failed, f"refreshed {updated} of {len(rows)}")
    print(f"refresh: {updated} queued for re-enrichment, {failed} dead")
    return failed


# ── Pass 3: housekeeping ────────────────────────────────────────────────

def housekeeping() -> int:
    run_id = start_run("housekeeping")
    queued = failed = 0

    status, missing = api(
        "GET",
        "startup_profiles?embedding=is.null&select=startup_id&limit=100",
    )
    if status < 300 and isinstance(missing, list):
        for row in missing:
            enqueue("embed_startup", {"startup_id": row["startup_id"]})
            queued += 1
    else:
        failed += 1

    status, unscored = api(
        "GET",
        "startup_profiles?profile_text=is.null&select=startup_id&limit=100",
    )
    if status < 300 and isinstance(unscored, list):
        for row in unscored:
            enqueue("recompute_startup", {"startup_id": row["startup_id"]})
            queued += 1
    else:
        failed += 1

    finish_run(run_id, 0, queued, failed, f"queued {queued} recompute/embed jobs")
    print(f"housekeeping: {queued} jobs queued, {failed} failures")
    return failed


# ── Alerting ────────────────────────────────────────────────────────────

def alert(total_failures: int):
    message = (
        f"StartupBridge nightly harvest: {total_failures} failures "
        f"(threshold {FAILURE_SPIKE}) at {datetime.now(timezone.utc).isoformat()}"
    )
    print(f"WARNING: {message}")
    if not ALERT_WEBHOOK:
        return
    req = urllib.request.Request(
        ALERT_WEBHOOK,
        data=json.dumps({"text": message}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception as e:  # noqa: BLE001
        print(f"  ! webhook failed: {type(e).__name__}")


def main() -> int:
    if not SUPABASE_URL or not SERVICE_KEY:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        return 1

    sources, ignore = load_sources(os.path.join(HERE, "sources.yaml"))
    print(f"Loaded {len(sources)} sources, {len(ignore)} ignored domains\n")

    failures = discovery(sources, ignore) + refresh() + housekeeping()
    if failures >= FAILURE_SPIKE:
        alert(failures)
    print(f"\nTotal failures: {failures}")
    return 0  # a failure spike alerts; it does not fail the workflow


if __name__ == "__main__":
    sys.exit(main())
