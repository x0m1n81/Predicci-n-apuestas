import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data.json"
URL = os.getenv("BLOGABET_URL", "https://blogabet.com/tips")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}


def number(value):
    if value is None:
        return None
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value))
    return float(match.group(0).replace(",", ".")) if match else None


def text_of(node):
    return " ".join(node.stripped_strings)


def first(node, selectors):
    for selector in selectors:
        found = node.select_one(selector)
        if found:
            value = text_of(found)
            if value:
                return value
    return ""


def parse(html):
    soup = BeautifulSoup(html, "html.parser")
    results = []

    # Blogabet's markup can change. Try several likely containers.
    selectors = [
        "article",
        ".tip",
        ".pick",
        ".feed-item",
        ".tip-item",
        "[class*='tip-']",
        "[class*='pick-']",
    ]

    seen_nodes = set()
    nodes = []
    for selector in selectors:
        for node in soup.select(selector):
            marker = id(node)
            if marker not in seen_nodes:
                seen_nodes.add(marker)
                nodes.append(node)

    for node in nodes:
        raw = text_of(node)
        if len(raw) < 15:
            continue

        odds_match = re.search(
            r"(?:odds?|cuota)\s*[:=]?\s*(\d+(?:[.,]\d+)?)",
            raw,
            re.I,
        )
        odds = number(odds_match.group(1)) if odds_match else None

        # Accept cards containing betting terminology, but don't require a
        # particular class name because Blogabet's frontend may change it.
        if not re.search(r"\b(odds?|cuota|stake|pick|tip|bet)\b", raw, re.I):
            continue

        tipster = first(
            node,
            [
                ".username",
                ".tipster",
                ".author",
                "[class*='username']",
                "[class*='tipster']",
                "[class*='author']",
            ],
        )
        event = first(
            node,
            [
                ".event",
                ".match",
                ".fixture",
                "[class*='event']",
                "[class*='match']",
                "[class*='fixture']",
            ],
        )
        market = first(
            node,
            [
                ".market",
                ".selection",
                ".pick",
                "[class*='market']",
                "[class*='selection']",
            ],
        )

        links = [a.get("href", "") for a in node.find_all("a", href=True)]
        source_url = next(
            (u for u in links if "blogabet.com" in u),
            URL,
        )

        if not event:
            event = raw[:180]
        if not market:
            market = raw[:240]

        results.append(
            {
                "tipster": tipster or "Blogabet",
                "match": event,
                "pick": market,
                "odds": odds,
                "source_url": source_url,
            }
        )

    clean = []
    seen = set()
    for item in results:
        key = (
            item["tipster"],
            item["match"],
            item["pick"],
            item["odds"],
        )
        if key not in seen:
            seen.add(key)
            clean.append(item)

    return clean[:500]


def main():
    response = requests.get(
        URL,
        headers=HEADERS,
        timeout=30,
        allow_redirects=True,
    )
    response.raise_for_status()

    picks = parse(response.text)
    if not picks:
        raise RuntimeError(
            "Blogabet respondió, pero no se encontraron picks. "
            "La página puede estar cargando los datos mediante JavaScript o haber cambiado su estructura."
        )

    payload = {
        "source": "Blogabet /tips",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "ok",
        "count": len(picks),
        "picks": picks,
    }

    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("OK records:", len(picks))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ERROR:", exc, file=sys.stderr)
        # Never replace valid historical data with an empty result.
        sys.exit(1)
