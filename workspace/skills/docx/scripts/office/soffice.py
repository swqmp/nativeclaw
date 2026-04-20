#!/usr/bin/env python3
"""LibreOffice wrapper for document conversion.

Handles finding the soffice binary across platforms and running conversions.

Usage:
    python soffice.py --headless --convert-to docx document.doc
    python soffice.py --headless --convert-to pdf document.docx
"""

import sys
import os
import subprocess
import shutil


def find_soffice():
    """Find the LibreOffice soffice binary."""
    # Check PATH first
    soffice = shutil.which("soffice")
    if soffice:
        return soffice

    # Common locations
    candidates = [
        # macOS
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        os.path.expanduser("~/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        # Linux
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "/snap/bin/soffice",
        "/usr/bin/libreoffice",
        # Windows
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]

    for path in candidates:
        if os.path.isfile(path):
            return path

    return None


def main():
    soffice = find_soffice()
    if not soffice:
        print("Error: LibreOffice (soffice) not found.")
        print("Install it from https://www.libreoffice.org/download/")
        print("\nmacOS: brew install --cask libreoffice")
        print("Ubuntu: sudo apt install libreoffice")
        sys.exit(1)

    # Pass all arguments through to soffice
    cmd = [soffice] + sys.argv[1:]

    # Use a unique user profile to avoid lock conflicts
    user_profile = os.path.join(
        os.path.expanduser("~"), ".nativeclaw", "libreoffice-profile"
    )
    os.makedirs(user_profile, exist_ok=True)

    # Add user profile to avoid "locked by another user" errors
    env_args = [f"-env:UserInstallation=file://{user_profile}"]

    full_cmd = [soffice] + env_args + sys.argv[1:]

    try:
        result = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    except subprocess.TimeoutExpired:
        print("Error: LibreOffice conversion timed out (120s)")
        sys.exit(1)
    except FileNotFoundError:
        print(f"Error: Could not execute {soffice}")
        sys.exit(1)


if __name__ == "__main__":
    main()
