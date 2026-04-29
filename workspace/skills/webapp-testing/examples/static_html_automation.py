#!/usr/bin/env python3
"""Automate a local HTML file using file:// URLs.

Usage: python static_html_automation.py <html_file> [screenshot_path]

Opens a local HTML file in Playwright, takes a screenshot,
and prints the page title and text content summary.
"""

import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright


def automate_static(html_path, screenshot_path=None):
    abs_path = os.path.abspath(html_path)
    if not os.path.exists(abs_path):
        print(f"Error: file not found: {abs_path}", file=sys.stderr)
        sys.exit(1)

    file_url = Path(abs_path).as_uri()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(file_url)
        page.wait_for_load_state("domcontentloaded")

        title = page.title()
        print(f"Title: {title}")

        if screenshot_path:
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"Screenshot saved: {screenshot_path}")

        # Print text content summary
        body_text = page.inner_text("body")
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]
        print(f"\nContent ({len(lines)} lines):")
        for line in lines[:20]:
            print(f"  {line[:100]}")
        if len(lines) > 20:
            print(f"  ... ({len(lines) - 20} more lines)")

        browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <html_file> [screenshot_path]")
        sys.exit(1)
    automate_static(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
