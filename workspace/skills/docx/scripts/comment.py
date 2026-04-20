#!/usr/bin/env python3
"""Add comments to unpacked .docx XML files.

Creates the comment entry in word/comments.xml and word/commentsExtended.xml.
You still need to manually add <w:commentRangeStart/>, <w:commentRangeEnd/>,
and <w:commentReference/> markers to word/document.xml.

Usage:
    python comment.py unpacked/ 0 "Comment text"
    python comment.py unpacked/ 1 "Reply text" --parent 0
    python comment.py unpacked/ 0 "Text" --author "Custom Author"
"""

import sys
import os
import argparse
import re
from datetime import datetime, timezone


COMMENTS_NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}


def ensure_comments_xml(unpacked_dir):
    """Create word/comments.xml if it doesn't exist."""
    comments_path = os.path.join(unpacked_dir, "word", "comments.xml")
    if not os.path.isfile(comments_path):
        content = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
</w:comments>"""
        with open(comments_path, "w", encoding="utf-8") as f:
            f.write(content)

    return comments_path


def ensure_comments_extended(unpacked_dir):
    """Create word/commentsExtended.xml if it doesn't exist."""
    ext_path = os.path.join(unpacked_dir, "word", "commentsExtended.xml")
    if not os.path.isfile(ext_path):
        content = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
                xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
                mc:Ignorable="w15">
</w15:commentsEx>"""
        with open(ext_path, "w", encoding="utf-8") as f:
            f.write(content)

    return ext_path


def ensure_content_types(unpacked_dir):
    """Make sure [Content_Types].xml has entries for comments files."""
    ct_path = os.path.join(unpacked_dir, "[Content_Types].xml")
    if not os.path.isfile(ct_path):
        return

    with open(ct_path, "r", encoding="utf-8") as f:
        content = f.read()

    additions = []
    if "/word/comments.xml" not in content:
        additions.append(
            '<Override PartName="/word/comments.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        )
    if "/word/commentsExtended.xml" not in content:
        additions.append(
            '<Override PartName="/word/commentsExtended.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>'
        )

    if additions:
        insert_point = content.rfind("</Types>")
        if insert_point >= 0:
            content = content[:insert_point] + "\n".join(additions) + "\n" + content[insert_point:]
            with open(ct_path, "w", encoding="utf-8") as f:
                f.write(content)


def ensure_relationships(unpacked_dir):
    """Make sure word/_rels/document.xml.rels has relationships for comments."""
    rels_path = os.path.join(unpacked_dir, "word", "_rels", "document.xml.rels")
    if not os.path.isfile(rels_path):
        return

    with open(rels_path, "r", encoding="utf-8") as f:
        content = f.read()

    additions = []
    if "comments.xml" not in content:
        # Find a free rId
        existing_ids = re.findall(r'Id="rId(\d+)"', content)
        max_id = max(int(x) for x in existing_ids) if existing_ids else 0

        additions.append(
            f'<Relationship Id="rId{max_id + 1}" '
            f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" '
            f'Target="comments.xml"/>'
        )

    if additions:
        insert_point = content.rfind("</Relationships>")
        if insert_point >= 0:
            content = content[:insert_point] + "\n".join(additions) + "\n" + content[insert_point:]
            with open(rels_path, "w", encoding="utf-8") as f:
                f.write(content)


def add_comment(unpacked_dir, comment_id, text, author="Claude", parent_id=None):
    """Add a comment to the unpacked document."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Ensure all required files exist
    comments_path = ensure_comments_xml(unpacked_dir)
    ext_path = ensure_comments_extended(unpacked_dir)
    ensure_content_types(unpacked_dir)
    ensure_relationships(unpacked_dir)

    # Add comment to comments.xml
    with open(comments_path, "r", encoding="utf-8") as f:
        content = f.read()

    comment_xml = f"""<w:comment w:id="{comment_id}" w:author="{author}" w:date="{now}" w:initials="{author[0]}">
  <w:p>
    <w:pPr><w:pStyle w:val="CommentText"/></w:pPr>
    <w:r>
      <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
      <w:annotationRef/>
    </w:r>
    <w:r><w:t>{text}</w:t></w:r>
  </w:p>
</w:comment>"""

    insert_point = content.rfind("</w:comments>")
    if insert_point >= 0:
        content = content[:insert_point] + comment_xml + "\n" + content[insert_point:]
        with open(comments_path, "w", encoding="utf-8") as f:
            f.write(content)

    # Add to commentsExtended.xml (for replies)
    with open(ext_path, "r", encoding="utf-8") as f:
        ext_content = f.read()

    if parent_id is not None:
        ext_xml = f'<w15:commentEx w15:paraId="{comment_id:08X}" w15:paraIdParent="{parent_id:08X}" w15:done="0"/>'
    else:
        ext_xml = f'<w15:commentEx w15:paraId="{comment_id:08X}" w15:done="0"/>'

    insert_point = ext_content.rfind("</w15:commentsEx>")
    if insert_point >= 0:
        ext_content = ext_content[:insert_point] + ext_xml + "\n" + ext_content[insert_point:]
        with open(ext_path, "w", encoding="utf-8") as f:
            f.write(ext_content)

    status = "reply to" if parent_id is not None else "comment"
    print(f"Added {status} id={comment_id} by {author}")
    print(f"Now add markers to word/document.xml:")
    print(f'  <w:commentRangeStart w:id="{comment_id}"/>')
    print(f'  ... annotated text ...')
    print(f'  <w:commentRangeEnd w:id="{comment_id}"/>')
    print(
        f'  <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>'
        f'<w:commentReference w:id="{comment_id}"/></w:r>'
    )


def main():
    parser = argparse.ArgumentParser(description="Add comments to unpacked .docx")
    parser.add_argument("unpacked_dir", help="Path to unpacked directory")
    parser.add_argument("id", type=int, help="Comment ID (integer)")
    parser.add_argument("text", help="Comment text (pre-escaped XML)")
    parser.add_argument("--parent", type=int, default=None, help="Parent comment ID for replies")
    parser.add_argument("--author", default="Claude", help="Author name (default: Claude)")
    args = parser.parse_args()

    add_comment(args.unpacked_dir, args.id, args.text, args.author, args.parent)


if __name__ == "__main__":
    main()
