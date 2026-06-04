#duckduckgo-search!/usr/bin/env python3
"""
DuckDuckGo Search Helper

Performs web search via ddgs library and outputs results as JSON.
Designed to be called from Node.js via child_process.

Usage:
    python3 search.py --query '<JSON-encoded query>' --max-results 5

Output:
    JSON array to stdout, each item: { "title": "...", "href": "...", "body": "..." }
    Errors written to stderr, non-zero exit code on failure.
"""

import argparse
import json
import sys
import time

MAX_RETRIES = 2
RETRY_DELAY = 1  # seconds


def main():
    parser = argparse.ArgumentParser(description="DuckDuckGo web search helper")
    parser.add_argument("--query", required=True, help="JSON-encoded search query")
    parser.add_argument("--max-results", type=int, default=5, help="Max number of results")
    args = parser.parse_args()

    try:
        query = json.loads(args.query)
    except json.JSONDecodeError as e:
        print(f"Invalid query JSON: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        from ddgs import DDGS
    except ImportError:
        try:
            from duckduckgo_search import DDGS
        except ImportError:
            print(
                "ddgs is not installed. Run: pip install ddgs",
                file=sys.stderr,
            )
            sys.exit(1)

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            with DDGS() as ddgs:
                results = []
                for r in ddgs.text(query, max_results=args.max_results):
                    results.append(
                        {
                            "title": r.get("title", ""),
                            "href": r.get("href", ""),
                            "body": r.get("body", ""),
                        }
                    )
                print(json.dumps(results, ensure_ascii=False))
            return
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * (attempt + 1))

    print(f"Search failed after {MAX_RETRIES + 1} attempts: {last_error}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
