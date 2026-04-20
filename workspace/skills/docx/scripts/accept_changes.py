#!/usr/bin/env python3
"""Accept all tracked changes in a .docx file.

Produces a clean document with all insertions applied and all deletions removed.
Uses LibreOffice macro if available, falls back to XML manipulation.

Usage:
    python accept_changes.py input.docx output.docx
"""

import sys
import os
import re
import zipfile
import tempfile
import shutil


def accept_changes_xml(input_path, output_path):
    """Accept tracked changes by manipulating the XML directly."""
    temp_dir = tempfile.mkdtemp(prefix="docx_accept_")

    try:
        # Extract
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(temp_dir)

        doc_path = os.path.join(temp_dir, "word", "document.xml")
        if not os.path.isfile(doc_path):
            print("Error: word/document.xml not found")
            sys.exit(1)

        with open(doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Step 1: Accept insertions - unwrap <w:ins> tags, keep content
        # Pattern: <w:ins ...>content</w:ins> -> content
        content = re.sub(
            r"<w:ins\b[^>]*>(.*?)</w:ins>",
            r"\1",
            content,
            flags=re.DOTALL,
        )

        # Step 2: Remove deletions - remove <w:del> and all content inside
        content = re.sub(
            r"<w:del\b[^>]*>.*?</w:del>",
            "",
            content,
            flags=re.DOTALL,
        )

        # Step 3: Remove paragraph deletion marks
        # <w:rPr><w:del .../></w:rPr> in paragraph properties
        content = re.sub(
            r"<w:del\s+w:id=\"\d+\"\s+w:author=\"[^\"]*\"\s+w:date=\"[^\"]*\"\s*/>",
            "",
            content,
        )

        # Step 4: Remove comment markers (optional, clean up)
        content = re.sub(r"<w:commentRangeStart[^/]*/>\s*", "", content)
        content = re.sub(r"<w:commentRangeEnd[^/]*/>\s*", "", content)
        content = re.sub(
            r'<w:r>\s*<w:rPr>\s*<w:rStyle w:val="CommentReference"/>\s*</w:rPr>\s*<w:commentReference[^/]*/>\s*</w:r>',
            "",
            content,
        )

        # Step 5: Remove RSIDs (revision save IDs - no longer needed)
        content = re.sub(r'\s+w:rsid\w+="[0-9A-Fa-f]+"', "", content)

        # Step 6: Clean up empty paragraphs left by deletions
        # Remove <w:p> that only contain <w:pPr> with no text runs
        content = re.sub(
            r"<w:p>\s*<w:pPr>(?:(?!</w:pPr>).)*</w:pPr>\s*</w:p>",
            "",
            content,
            flags=re.DOTALL,
        )

        with open(doc_path, "w", encoding="utf-8") as f:
            f.write(content)

        # Remove comments.xml if it exists (changes are accepted)
        comments_path = os.path.join(temp_dir, "word", "comments.xml")
        if os.path.isfile(comments_path):
            os.remove(comments_path)

        # Repack
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for root, dirs, files in os.walk(temp_dir):
                for fname in files:
                    fpath = os.path.join(root, fname)
                    arcname = os.path.relpath(fpath, temp_dir)
                    zout.write(fpath, arcname)

        size_kb = os.path.getsize(output_path) / 1024
        print(f"Accepted all tracked changes: {output_path} ({size_kb:.1f} KB)")

    finally:
        shutil.rmtree(temp_dir)


def main():
    if len(sys.argv) != 3:
        print("Usage: python accept_changes.py input.docx output.docx")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    if not os.path.isfile(input_path):
        print(f"Error: {input_path} not found")
        sys.exit(1)

    accept_changes_xml(input_path, output_path)


if __name__ == "__main__":
    main()
