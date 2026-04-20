#!/usr/bin/env python3
"""Validate a .docx file for common issues.

Usage:
    python validate.py document.docx
"""

import sys
import os
import zipfile
import xml.etree.ElementTree as ET
import re


def validate(docx_path):
    """Validate a .docx file and report issues."""
    if not os.path.isfile(docx_path):
        print(f"Error: {docx_path} not found")
        sys.exit(1)

    issues = []
    warnings = []
    checks = 0

    # Check 1: Valid ZIP
    checks += 1
    try:
        zf = zipfile.ZipFile(docx_path, "r")
    except zipfile.BadZipFile:
        print(f"FAIL: {docx_path} is not a valid ZIP file")
        sys.exit(1)

    # Check 2: Required files exist
    required = ["[Content_Types].xml", "word/document.xml"]
    for req in required:
        checks += 1
        if req not in zf.namelist():
            issues.append(f"Missing required file: {req}")

    # Check 3: All XML is well-formed
    for name in zf.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            checks += 1
            try:
                data = zf.read(name)
                ET.fromstring(data)
            except ET.ParseError as e:
                issues.append(f"Malformed XML in {name}: {e}")

    # Check 4: document.xml specific checks
    if "word/document.xml" in zf.namelist():
        doc_data = zf.read("word/document.xml").decode("utf-8")

        # Check for durableId overflow
        checks += 1
        for match in re.finditer(r'w:durableId="(\d+)"', doc_data):
            val = int(match.group(1))
            if val >= 0x7FFFFFFF:
                issues.append(f"durableId {val} >= 0x7FFFFFFF (will cause corruption)")

        # Check for missing xml:space="preserve"
        checks += 1
        for match in re.finditer(r"<w:t>([^<]*)</w:t>", doc_data):
            text = match.group(1)
            if text and (text[0] == " " or text[-1] == " "):
                warnings.append(
                    f'<w:t> with leading/trailing whitespace missing xml:space="preserve"'
                )
                break  # Report once

        # Check for unicode bullets (common mistake)
        checks += 1
        if "\u2022" in doc_data and "<w:numPr>" not in doc_data:
            warnings.append(
                "Unicode bullet characters found without numbering. Use LevelFormat.BULLET instead."
            )

        # Check tracked change IDs are unique
        checks += 1
        change_ids = re.findall(r'<w:(?:ins|del)\s[^>]*w:id="(\d+)"', doc_data)
        if len(change_ids) != len(set(change_ids)):
            issues.append("Duplicate tracked change IDs found")

    # Check 5: Content types
    checks += 1
    if "[Content_Types].xml" in zf.namelist():
        ct_data = zf.read("[Content_Types].xml").decode("utf-8")
        # Check media files have content types
        for name in zf.namelist():
            if name.startswith("word/media/"):
                ext = os.path.splitext(name)[1].lstrip(".")
                if ext and f'Extension="{ext}"' not in ct_data:
                    warnings.append(f"Media file {name} may be missing content type for .{ext}")

    # Check 6: Relationships
    checks += 1
    if "word/_rels/document.xml.rels" in zf.namelist():
        rels_data = zf.read("word/_rels/document.xml.rels").decode("utf-8")
        # Check for referenced images that exist
        for match in re.finditer(r'Target="(media/[^"]+)"', rels_data):
            target = f"word/{match.group(1)}"
            if target not in zf.namelist():
                issues.append(f"Relationship references missing file: {target}")

    zf.close()

    # Report
    size_kb = os.path.getsize(docx_path) / 1024
    print(f"Validated: {docx_path} ({size_kb:.1f} KB)")
    print(f"Checks: {checks}")

    if issues:
        print(f"\nERRORS ({len(issues)}):")
        for issue in issues:
            print(f"  - {issue}")

    if warnings:
        print(f"\nWARNINGS ({len(warnings)}):")
        for warning in warnings:
            print(f"  - {warning}")

    if not issues and not warnings:
        print("Result: PASS (no issues found)")
        return 0
    elif issues:
        print(f"\nResult: FAIL ({len(issues)} errors, {len(warnings)} warnings)")
        return 1
    else:
        print(f"\nResult: PASS with warnings ({len(warnings)} warnings)")
        return 0


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate.py document.docx")
        sys.exit(1)
    sys.exit(validate(sys.argv[1]))


if __name__ == "__main__":
    main()
