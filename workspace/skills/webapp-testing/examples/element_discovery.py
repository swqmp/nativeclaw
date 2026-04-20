#!/usr/bin/env python3
"""Discover buttons, links, and inputs on a page.

Usage: python element_discovery.py <url> [screenshot_path]

Navigates to a URL, waits for networkidle, then prints all
interactive elements found on the page.
"""

import sys
from playwright.sync_api import sync_playwright


def discover_elements(url, screenshot_path=None):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        page.wait_for_load_state("networkidle")

        if screenshot_path:
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"Screenshot saved: {screenshot_path}")

        # Buttons
        buttons = page.locator("button").all()
        print(f"\n=== Buttons ({len(buttons)}) ===")
        for btn in buttons:
            text = btn.inner_text().strip()[:80]
            print(f"  [{btn.get_attribute('class') or ''}] {text or '(no text)'}")

        # Links
        links = page.locator("a[href]").all()
        print(f"\n=== Links ({len(links)}) ===")
        for link in links:
            text = link.inner_text().strip()[:60]
            href = link.get_attribute("href") or ""
            print(f"  {text or '(no text)'} → {href[:80]}")

        # Inputs
        inputs = page.locator("input, textarea, select").all()
        print(f"\n=== Inputs ({len(inputs)}) ===")
        for inp in inputs:
            tag = inp.evaluate("el => el.tagName.toLowerCase()")
            itype = inp.get_attribute("type") or ""
            name = inp.get_attribute("name") or inp.get_attribute("id") or ""
            placeholder = inp.get_attribute("placeholder") or ""
            print(f"  <{tag}> type={itype} name={name} placeholder={placeholder}")

        browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <url> [screenshot_path]")
        sys.exit(1)
    url = sys.argv[1]
    ss = sys.argv[2] if len(sys.argv) > 2 else None
    discover_elements(url, ss)
