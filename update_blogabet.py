import datetime as dt
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data.json"
TIMEOUT = 25
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; PicksAggregator/1.0)", "Accept": "application/json"}

SOURCES = {
    "SportsPickLab": "https://sportspicklab.com/api/public/picksJSON",
    "NuroPicks": "https://nuropicks.com/record/export.json?limit=500",
}

def fetch_json(url, params=None):
    r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

def text(v):
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return str(v).strip()

def number(v):
    if v is None:
        return None
    m = re.search(r"-?\d+(?:[.,]\d+)?", text(v))
    return float(m.group(0).replace(",", ".")) if m else None

def first(d, keys):
    if not isinstance(d, dict):
        return None
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None

def walk_records(obj):
    """Find list-like pick records without assuming one vendor's exact JSON schema."""
    if isinstance(obj, list):
        for x in obj:
            if isinstance(x, dict):
                yield x
    elif isinstance(obj, dict):
        for key in ("picks", "data", "records", "items", "results", "entries", "tips"):
            val = obj.get(key)
            if isinstance(val, list):
                for x in val:
                    if isinstance(x, dict):
                        yield x
        # Some feeds wrap a single record under a named object.
        for val in obj.values():
            if isinstance(val, dict):
                if any(k in val for k in ("pick", "selection", "prediction", "odds")):
                    yield val

def normalize(rec, source):
    author = first(rec, ["author", "tipster", "username", "capper", "creator", "name", "provider"])
    selection = first(rec, ["selection", "pick", "prediction", "label", "tip", "market_selection"])
    market = first(rec, ["market", "market_name", "type", "bet_type"])
    odds = first(rec, ["odds", "odd", "price", "decimal_odds"])
    published = first(rec, ["published_at", "publishedAt", "publish_time", "created_at", "createdAt", "timestamp", "date"])
    event = first(rec, ["event", "match", "fixture", "game", "description"])
    sport = first(rec, ["sport", "sport_key", "category"])
    league = first(rec, ["league", "competition", "tournament"])
    result = first(rec, ["result", "status", "outcome"])

    # Reconstruct event from common home/away fields when needed.
    if not event:
        home = first(rec, ["home", "home_team", "homeTeam"])
        away = first(rec, ["away", "away_team", "awayTeam"])
        if home or away:
            event = f"{text(home)} — {text(away)}".strip(" —")

    # Capper/Nuro/SPL records can have a nested event object.
    if isinstance(event, dict):
        home = first(event, ["home", "home_team", "homeTeam"])
        away = first(event, ["away", "away_team", "awayTeam"])
        event = f"{text(home)} — {text(away)}".strip(" —") or text(event)
    if isinstance(selection, dict):
        selection = first(selection, ["label", "name", "value", "pick"]) or text(selection)

    odds_n = number(odds)
    event_s, sel_s = text(event), text(selection)

    if not author or not sel_s:
        return None

    return {
        "source": source,
        "tipster": text(author),
        "match": event_s or "Evento no indicado",
        "pick": sel_s,
        "market": text(market),
        "odds": odds_n,
        "published_at": text(published),
        "sport": text(sport),
        "league": text(league),
        "result": text(result),
        "raw": rec,
    }

def source_sports_pick_lab():
    data = fetch_json(SOURCES["SportsPickLab"])
    return [normalize(x, "SportsPickLab") for x in walk_records(data)]

def source_nuro():
    data = fetch_json(SOURCES["NuroPicks"])
    return [normalize(x, "NuroPicks") for x in walk_records(data)]

def source_capper():
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    data = fetch_json("https://capper.win/api/v2/list", {"date": today})
    out = []
    for fixture in walk_records(data):
        preds = fixture.get("predictions")
        if not isinstance(preds, list):
            continue
        for p in preds:
            if not isinstance(p, dict) or p.get("locked"):
                continue
            merged = dict(p)
            merged["event"] = fixture.get("name") or fixture.get("event") or fixture.get("url")
            merged["sport"] = fixture.get("sport")
            merged["league"] = fixture.get("league")
            item = normalize(merged, "Capper.win")
            if item:
                out.append(item)
    return out

def dedupe(items):
    seen = set()
    out = []
    for x in items:
        key = (
            x["source"].lower(),
            x["tipster"].lower(),
            x["match"].lower(),
            x["pick"].lower(),
            x["odds"],
        )
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out

def score(x):
    # This is a ranking score, NOT a probability of winning.
    s = 45
    if x["odds"] is not None:
        s += 10
        if 1.45 <= x["odds"] <= 3.25:
            s += 8
        elif x["odds"] < 1.25 or x["odds"] > 5.0:
            s -= 6
    if x["published_at"]:
        s += 5
    if x["match"] != "Evento no indicado":
        s += 8
    if x["market"]:
        s += 5
    if x["source"] == "SportsPickLab":
        s += 5
    return max(0, min(100, s))

def main():
    all_items = []
    errors = {}

    for name, fn in (
        ("SportsPickLab", source_sports_pick_lab),
        ("NuroPicks", source_nuro),
        ("Capper.win", source_capper),
    ):
        try:
            all_items.extend([x for x in fn() if x])
        except Exception as exc:
            errors[name] = f"{type(exc).__name__}: {exc}"

    items = dedupe(all_items)
    for x in items:
        x["filter_score"] = score(x)
        x.pop("raw", None)

    items.sort(key=lambda x: (
        x["filter_score"],
        x["published_at"] or "",
    ), reverse=True)

    payload = {
        "source": "Multi-source picks aggregator",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "ok" if items else "no_data",
        "count": len(items),
        "sources": {
            "SportsPickLab": sum(x["source"] == "SportsPickLab" for x in items),
            "NuroPicks": sum(x["source"] == "NuroPicks" for x in items),
            "Capper.win": sum(x["source"] == "Capper.win" for x in items),
        },
        "errors": errors,
        "picks": items[:1000],
    }

    # Never erase a valid dataset just because every source failed transiently.
    if not items and OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        old["last_attempt"] = payload["updated_at"]
        old["errors"] = errors
        OUT.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
        print("No new picks; preserved previous data.")
        return

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK records: {len(items)}")
    print("Sources:", payload["sources"])
    if errors:
        print("Source errors:", errors)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FATAL:", exc, file=sys.stderr)
        sys.exit(1)
