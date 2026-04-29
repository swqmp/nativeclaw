#!/usr/bin/env python3
"""Capture browser console logs during automation.

Usage: python console_logging.py <url> [wait_seconds]

Navigates to a URL, captures all console output (log, warn, error),
and prints them grouped by type.
"""

import sys
from playwright.sync_api import sync_playwright


def capture_console(url, wait_seconds=3):
    logs = {"log": [], "warning": [], "error": [], "info": [], "other": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def on_console(msg):
            bucket = msg.type if msg.type in logs else "other"
            logs[bucket].append(msg.text)

        page.on("console", on_console)

        # Also capture uncaught errors
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        page.goto(url)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(wait_seconds * 1000)

        total = sum(len(v) for v in logs.values())
        print(f"Console messages captured: {total}")

        for level in ["error", "warning", "log", "info", "other"]:
            msgs = logs[level]
            if msgs:
                print(f"\n=== {level.upper()} ({len(msgs)}) ===")
                for msg in msgs:
                    print(f"  {msg[:200]}")

        if errors:
            print(f"\n=== UNCAUGHT ERRORS ({len(errors)}) ===")
            for err in errors:
                print(f"  {err[:200]}")

        browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <url> [wait_seconds]")
        sys.exit(1)
    url = sys.argv[1]
    wait = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    capture_console(url, wait)
