import datetime as dt
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data.json"
TIMEOUT = 30
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PicksAggregator/2.0)",
    "Accept": "application/json, application/feed+json, text/plain, */*",
}

SPORTSPICKLAB_URLS = [
    "https://sportspicklab.com/api/public/picksJSON",
    "https://sportspicklab.com/feed.json",
]

NURO_URL = "https://nuropicks.com/record/export.json"
CAPPER_URL = "https://capper.win/api/v2/list"


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


def american_to_decimal(v):
    try:
        n = float(v)
        if n > 0:
            return round(1 + n / 100, 4)
        if n < 0:
            return round(1 + 100 / abs(n), 4)
    except (TypeError, ValueError):
        pass
    return None


def first(d, keys):
    if not isinstance(d, dict):
        return None
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def normalize(rec, source):
    if not isinstance(rec, dict):
        return None

    author = first(rec, [
        "author", "tipster", "username", "capper", "creator",
        "name", "provider", "source"
    ])
    selection = first(rec, [
        "selection", "pick", "prediction", "label",
        "tip", "market_selection"
    ])
    market = first(rec, [
        "market", "market_name", "type", "bet_type"
    ])
    odds = first(rec, [
        "odds", "odd", "price", "decimal_odds", "expectedOdds"
    ])
    published = first(rec, [
        "published_at", "publishedAt", "publish_time",
        "created_at", "createdAt", "timestamp", "date",
        "posted_at"
    ])
    event_at = first(rec, [
        "event_at", "eventAt", "kickoff", "start_time", "startTime",
        "scheduled_at", "scheduledAt", "game_time", "gameTime",
        "commence_time", "commenceTime", "match_time", "matchTime"
    ])
    event = first(rec, [
        "event", "match", "fixture", "game", "description"
    ])
    sport = first(rec, [
        "sport", "sport_key", "category"
    ])
    league = first(rec, [
        "league", "competition", "tournament"
    ])
    result = first(rec, [
        "result", "status", "outcome"
    ])

    if not event:
        home = first(rec, ["home", "home_team", "homeTeam"])
        away = first(rec, ["away", "away_team", "awayTeam"])
        if home or away:
            event = f"{text(home)} — {text(away)}".strip(" —")

    if isinstance(event, dict):
        home = first(event, ["home", "home_team", "homeTeam"])
        away = first(event, ["away", "away_team", "awayTeam"])
        event = f"{text(home)} — {text(away)}".strip(" —") or text(event)

    if isinstance(selection, dict):
        selection = first(selection, [
            "label", "name", "value", "pick", "selection"
        ]) or text(selection)

    odds_n = number(odds)
    event_s = text(event)
    sel_s = text(selection)

    if not author:
        author = source

    if not sel_s:
        return None

    return {
        "source": source,
        "tipster": text(author),
        "match": event_s or "Evento no indicado",
        "pick": sel_s,
        "market": text(market),
        "odds": odds_n,
        "published_at": text(published),
        "event_at": text(event_at),
        "sport": text(sport),
        "league": text(league),
        "result": text(result),
    }


def records_from_feed(obj):
    """Extract record-like dictionaries from common JSON/feed structures."""
    if isinstance(obj, list):
        for x in obj:
            if isinstance(x, dict):
                yield x
        return

    if not isinstance(obj, dict):
        return

    for key in (
        "picks", "data", "records", "items", "results",
        "entries", "tips"
    ):
        val = obj.get(key)
        if isinstance(val, list):
            for x in val:
                if isinstance(x, dict):
                    yield x

    items = obj.get("items")
    if isinstance(items, list):
        for x in items:
            if isinstance(x, dict):
                yield x

    if any(k in obj for k in (
        "pick", "selection", "prediction", "odds", "label"
    )):
        yield obj


def source_sports_pick_lab():
    errors = []

    for url in SPORTSPICKLAB_URLS:
        try:
            data = fetch_json(url)
            out = []

            for rec in records_from_feed(data):
                if "content_text" in rec and not any(
                    k in rec for k in ("pick", "selection", "prediction", "label")
                ):
                    parsed = dict(rec)
                    parsed["selection"] = rec.get("title") or rec.get("content_text")
                    parsed["published_at"] = rec.get("date_published")
                    item = normalize(parsed, "SportsPickLab")
                else:
                    item = normalize(rec, "SportsPickLab")

                if item:
                    out.append(item)

            if out:
                return out, None

            errors.append(f"{url}: 0 records")
        except Exception as exc:
            errors.append(f"{url}: {type(exc).__name__}: {exc}")

    return [], " | ".join(errors)


def source_nuro():
    data = fetch_json(NURO_URL, {"limit": 5000})
    picks = data.get("picks", []) if isinstance(data, dict) else data
    out = []

    for rec in picks if isinstance(picks, list) else []:
        if not isinstance(rec, dict):
            continue

        mapped = dict(rec)
        mapped["author"] = rec.get("source") or "NuroPicks"
        mapped["event"] = rec.get("game")
        mapped["selection"] = rec.get("pick")
        mapped["published_at"] = rec.get("posted_at")
        mapped["event_at"] = (
            rec.get("event_at") or rec.get("eventAt")
            or rec.get("kickoff") or rec.get("start_time")
            or rec.get("startTime") or rec.get("game_time")
            or rec.get("gameTime") or rec.get("scheduled_at")
            or rec.get("scheduledAt") or rec.get("commence_time")
            or rec.get("commenceTime")
        )
        mapped["market"] = rec.get("market")
        mapped["sport"] = rec.get("sport")
        mapped["result"] = rec.get("result")

        if "odds" not in mapped and "odds_american" in rec:
            mapped["odds"] = american_to_decimal(rec.get("odds_american"))

        item = normalize(mapped, "NuroPicks")
        if item:
            out.append(item)

    return out


def source_capper():
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    out = []
    errors = []

    markets = [
        "total_goals",
        "corners",
        "match_winner",
        "double_chance",
        "handicap",
    ]

    for market in markets:
        try:
            data = fetch_json(
                CAPPER_URL,
                {"date": today, "tz": "UTC", "market": market},
            )

            countries = data.get("countries", []) if isinstance(data, dict) else []
            for country in countries:
                for league in country.get("leagues", []) or []:
                    for fixture in league.get("fixtures", []) or []:
                        predictions = fixture.get("predictions", []) or []

                        for pred in predictions:
                            if not isinstance(pred, dict):
                                continue
                            if pred.get("locked"):
                                continue

                            mapped = dict(pred)
                            mapped["event"] = (
                                fixture.get("name")
                                or fixture.get("event")
                                or fixture.get("url")
                            )
                            mapped["sport"] = "football"
                            mapped["league"] = (
                                league.get("name")
                                or fixture.get("league")
                            )
                            mapped["event_at"] = (
                                fixture.get("kickoff")
                                or fixture.get("start_time")
                                or fixture.get("startTime")
                                or fixture.get("commence_time")
                            )
                            mapped["published_at"] = (
                                pred.get("published_at")
                                or pred.get("publishedAt")
                                or pred.get("created_at")
                                or pred.get("createdAt")
                                or mapped["event_at"]
                            )
                            mapped["market"] = pred.get("market") or market

                            if not mapped.get("selection"):
                                mapped["selection"] = (
                                    pred.get("label")
                                    or pred.get("pick")
                                )

                            item = normalize(mapped, "Capper.win")
                            if item:
                                out.append(item)

        except Exception as exc:
            errors.append(f"{market}: {type(exc).__name__}: {exc}")

    return out, (" | ".join(errors) if errors else None)


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
            x["market"].lower(),
        )
        if key not in seen:
            seen.add(key)
            out.append(x)

    return out


def score(x):
    # Ranking score only. It is NOT a probability of winning.
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

    try:
        items, err = source_sports_pick_lab()
        all_items.extend(items)
        if err:
            errors["SportsPickLab"] = err
    except Exception as exc:
        errors["SportsPickLab"] = f"{type(exc).__name__}: {exc}"

    try:
        items = source_nuro()
        all_items.extend(items)
    except Exception as exc:
        errors["NuroPicks"] = f"{type(exc).__name__}: {exc}"

    try:
        items, err = source_capper()
        all_items.extend(items)
        if err:
            errors["Capper.win"] = err
    except Exception as exc:
        errors["Capper.win"] = f"{type(exc).__name__}: {exc}"

    items = dedupe(all_items)

    for x in items:
        x["filter_score"] = score(x)

    # Los 1000 publicados se conservan ordenados por fecha de publicación.
    # El TOP 5 de la web se ordena después por filter_score.
    items.sort(
        key=lambda x: (
            x["published_at"] or "",
            x["filter_score"],
        ),
        reverse=True,
    )

    published_items = items[:1000]

    payload = {
        "source": "Multi-source picks aggregator",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "ok" if published_items else "no_data",
        "count": len(published_items),
        "sources": {
            "SportsPickLab": sum(
                x["source"] == "SportsPickLab" for x in published_items
            ),
            "NuroPicks": sum(
                x["source"] == "NuroPicks" for x in published_items
            ),
            "Capper.win": sum(
                x["source"] == "Capper.win" for x in published_items
            ),
        },
        "errors": errors,
        "picks": published_items,
    }

    # Never replace a valid dataset with an empty dataset because of a
    # temporary upstream failure.
    if not items and OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            old["last_attempt"] = payload["updated_at"]
            old["errors"] = errors
            OUT.write_text(
                json.dumps(old, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print("No new picks; previous data preserved.")
            print("Source errors:", errors)
            return
        except Exception:
            pass

    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"OK records: {len(items)}")
    print("Published records:", len(published_items))
    print("Sources:", payload["sources"])
    if errors:
        print("Source errors:", errors)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FATAL:", exc, file=sys.stderr)
        sys.exit(1)
