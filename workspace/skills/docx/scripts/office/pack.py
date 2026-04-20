#!/usr/bin/env python3
"""Pack an unpacked directory back into a .docx file.

Usage:
    python pack.py unpacked/ output.docx
    python pack.py unpacked/ output.docx --original document.docx
    python pack.py unpacked/ output.docx --validate false
"""

import sys
import os
import zipfile
import re
import argparse
import random
import xml.etree.ElementTree as ET


def condense_xml(xml_text):
    """Remove pretty-printing whitespace from XML for smaller file size."""
    # Remove indentation but preserve content whitespace
    lines = xml_text.split("\n")
    condensed = ""
    for line in lines:
        stripped = line.strip()
        if stripped:
            condensed += stripped
    return condensed


def validate_and_repair(unpacked_dir):
    """Validate and auto-repair common issues in the XML."""
    doc_path = os.path.join(unpacked_dir, "word", "document.xml")
    if not os.path.isfile(doc_path):
        print("Warning: word/document.xml not found")
        return []

    repairs = []

    with open(doc_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix 1: durableId >= 0x7FFFFFFF
    def fix_durable_id(match):
        full = match.group(0)
        val_match = re.search(r'w:durableId="(\d+)"', full)
        if val_match:
            val = int(val_match.group(1))
            if val >= 0x7FFFFFFF:
                new_id = random.randint(1, 0x7FFFFFFE)
                repairs.append(f"Fixed durableId {val} -> {new_id}")
                return full.replace(
                    f'w:durableId="{val}"', f'w:durableId="{new_id}"'
                )
        return full

    content = re.sub(r'<[^>]*w:durableId="[^"]*"[^>]*>', fix_durable_id, content)

    # Fix 2: Missing xml:space="preserve" on <w:t> with whitespace
    def fix_preserve(match):
        tag = match.group(1)
        text = match.group(2)
        if text and (text[0] == " " or text[-1] == " " or "  " in text):
            if 'xml:space="preserve"' not in tag:
                repairs.append(f'Added xml:space="preserve" to <w:t> with whitespace')
                return f'<w:t xml:space="preserve">{text}</w:t>'
        return match.group(0)

    content = re.sub(r"<w:t([^>]*)>([^<]*)</w:t>", fix_preserve, content)

    with open(doc_path, "w", encoding="utf-8") as f:
        f.write(content)

    return repairs


def validate_xml_wellformed(unpacked_dir):
    """Check all XML files are well-formed."""
    errors = []
    for root, dirs, files in os.walk(unpacked_dir):
        for fname in files:
            if fname.endswith(".xml") or fname.endswith(".rels"):
                fpath = os.path.join(root, fname)
                try:
                    ET.parse(fpath)
                except ET.ParseError as e:
                    rel_path = os.path.relpath(fpath, unpacked_dir)
                    errors.append(f"  {rel_path}: {e}")
    return errors


def pack(unpacked_dir, output_path, original_path=None, do_validate=True):
    """Pack a directory back into a .docx file."""
    if not os.path.isdir(unpacked_dir):
        print(f"Error: {unpacked_dir} not found")
        sys.exit(1)

    if do_validate:
        # Check well-formedness first
        xml_errors = validate_xml_wellformed(unpacked_dir)
        if xml_errors:
            print("XML validation errors (must fix manually):")
            for err in xml_errors:
                print(err)
            sys.exit(1)

        # Auto-repair
        repairs = validate_and_repair(unpacked_dir)
        if repairs:
            print("Auto-repairs applied:")
            for r in repairs:
                print(f"  - {r}")

    # Determine file order from original if provided
    file_order = []
    if original_path and os.path.isfile(original_path):
        with zipfile.ZipFile(original_path, "r") as orig:
            file_order = [info.filename for info in orig.infolist()]

    # Collect all files
    all_files = []
    for root, dirs, files in os.walk(unpacked_dir):
        for fname in files:
            fpath = os.path.join(root, fname)
            arcname = os.path.relpath(fpath, unpacked_dir)
            all_files.append((arcname, fpath))

    # Sort: [Content_Types].xml first, then _rels/, then rest
    def sort_key(item):
        name = item[0]
        if name == "[Content_Types].xml":
            return (0, name)
        if name.startswith("_rels/"):
            return (1, name)
        # Use original order if available
        if name in file_order:
            return (2, file_order.index(name))
        return (3, name)

    all_files.sort(key=sort_key)

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for arcname, fpath in all_files:
            with open(fpath, "rb") as f:
                data = f.read()

            # Condense XML for smaller file size
            if arcname.endswith(".xml") or arcname.endswith(".rels"):
                try:
                    text = data.decode("utf-8")
                    text = condense_xml(text)
                    data = text.encode("utf-8")
                except Exception:
                    pass

            zf.writestr(arcname, data)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Packed {unpacked_dir} -> {output_path} ({size_kb:.1f} KB)")


def main():
    parser = argparse.ArgumentParser(description="Pack directory into .docx")
    parser.add_argument("input", help="Unpacked directory")
    parser.add_argument("output", help="Output .docx path")
    parser.add_argument("--original", help="Original .docx for file ordering", default=None)
    parser.add_argument(
        "--validate", default="true", help="Validate and auto-repair (default: true)"
    )
    args = parser.parse_args()

    do_validate = args.validate.lower() != "false"
    pack(args.input, args.output, args.original, do_validate)


if __name__ == "__main__":
    main()
