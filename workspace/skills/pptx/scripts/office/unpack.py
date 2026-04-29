#!/usr/bin/env python3
"""Unpack a .docx file into a directory with pretty-printed XML.

Usage:
    python unpack.py document.docx unpacked/
    python unpack.py document.docx unpacked/ --merge-runs false
"""

import sys
import os
import zipfile
import xml.dom.minidom
import re
import argparse


def pretty_print_xml(xml_bytes):
    """Pretty-print XML bytes, preserving content."""
    try:
        dom = xml.dom.minidom.parseString(xml_bytes)
        pretty = dom.toprettyxml(indent="  ", encoding="UTF-8")
        # Remove extra blank lines from minidom
        lines = pretty.decode("utf-8").split("\n")
        cleaned = "\n".join(line for line in lines if line.strip())
        return cleaned.encode("utf-8")
    except Exception:
        return xml_bytes


def convert_smart_quotes(text):
    """Convert smart quote characters to XML entities so they survive editing."""
    replacements = [
        ("\u2018", "&#x2018;"),  # left single quote
        ("\u2019", "&#x2019;"),  # right single quote / apostrophe
        ("\u201C", "&#x201C;"),  # left double quote
        ("\u201D", "&#x201D;"),  # right double quote
        ("\u2013", "&#x2013;"),  # en dash
        ("\u2014", "&#x2014;"),  # em dash
        ("\u2026", "&#x2026;"),  # ellipsis
    ]
    for char, entity in replacements:
        text = text.replace(char, entity)
    return text


def merge_adjacent_runs(xml_text):
    """Merge adjacent <w:r> elements with identical <w:rPr> formatting.

    This reduces XML noise by combining runs like:
        <w:r><w:rPr>...</w:rPr><w:t>Hel</w:t></w:r>
        <w:r><w:rPr>...</w:rPr><w:t>lo</w:t></w:r>
    Into:
        <w:r><w:rPr>...</w:rPr><w:t>Hello</w:t></w:r>
    """
    # Pattern: find consecutive <w:r> blocks with same <w:rPr>
    # This is a simplified merge - handles the most common case
    pattern = (
        r'(<w:r>)\s*(<w:rPr>.*?</w:rPr>)\s*<w:t(?:\s[^>]*)?>([^<]*)</w:t>\s*</w:r>'
        r'\s*<w:r>\s*\2\s*<w:t(?:\s[^>]*)?>([^<]*)</w:t>\s*</w:r>'
    )

    prev = None
    result = xml_text
    while result != prev:
        prev = result
        result = re.sub(
            pattern,
            lambda m: (
                f'{m.group(1)}{m.group(2)}'
                f'<w:t xml:space="preserve">{m.group(3)}{m.group(4)}</w:t></w:r>'
            ),
            result,
            flags=re.DOTALL,
        )
    return result


def unpack(docx_path, output_dir, do_merge_runs=True):
    """Unpack a .docx into a directory with pretty-printed XML."""
    if not os.path.isfile(docx_path):
        print(f"Error: {docx_path} not found")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    with zipfile.ZipFile(docx_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                os.makedirs(os.path.join(output_dir, info.filename), exist_ok=True)
                continue
            data = zf.read(info.filename)
            out_path = os.path.join(output_dir, info.filename)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)

            if info.filename.endswith(".xml") or info.filename.endswith(".rels"):
                data = pretty_print_xml(data)
                text = data.decode("utf-8")
                text = convert_smart_quotes(text)
                if do_merge_runs and "word/document.xml" in info.filename:
                    text = merge_adjacent_runs(text)
                data = text.encode("utf-8")

            with open(out_path, "wb") as f:
                f.write(data)

    print(f"Unpacked {docx_path} -> {output_dir}/")
    print(f"  Files: {len(os.listdir(output_dir))} top-level entries")
    print(f"  Edit XML in {output_dir}/word/")


def main():
    parser = argparse.ArgumentParser(description="Unpack a .docx file for editing")
    parser.add_argument("docx", help="Path to .docx file")
    parser.add_argument("output", help="Output directory")
    parser.add_argument(
        "--merge-runs",
        default="true",
        help="Merge adjacent runs with same formatting (default: true)",
    )
    args = parser.parse_args()

    do_merge = args.merge_runs.lower() != "false"
    unpack(args.docx, args.output, do_merge)


if __name__ == "__main__":
    main()
