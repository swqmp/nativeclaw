#!/usr/bin/env python3
"""Generate thumbnail grid from a PowerPoint presentation.

Usage: python thumbnail.py <pptx_file> [output_dir]

Converts each slide to an image via LibreOffice + pdftoppm,
then creates a contact-sheet grid for quick visual review.
"""

import sys
import os
import subprocess
import tempfile
import shutil
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow not installed. Run: pip install Pillow", file=sys.stderr)
    sys.exit(1)


def find_soffice():
    """Find soffice binary."""
    script_dir = Path(__file__).parent / "office"
    soffice_wrapper = script_dir / "soffice.py"
    if soffice_wrapper.exists():
        return [sys.executable, str(soffice_wrapper)]
    for p in ["/opt/homebrew/bin/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice",
              "/Applications/LibreOffice.app/Contents/MacOS/soffice"]:
        if os.path.isfile(p):
            return [p]
    soffice = shutil.which("soffice")
    if soffice:
        return [soffice]
    return None


def pptx_to_images(pptx_path, output_dir):
    """Convert PPTX to slide images via PDF intermediate."""
    soffice_cmd = find_soffice()
    if not soffice_cmd:
        print("Error: LibreOffice (soffice) not found.", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Convert to PDF
        cmd = soffice_cmd + ["--headless", "--convert-to", "pdf", "--outdir", tmpdir, str(pptx_path)]
        subprocess.run(cmd, check=True, capture_output=True)

        pdf_name = Path(pptx_path).stem + ".pdf"
        pdf_path = os.path.join(tmpdir, pdf_name)
        if not os.path.exists(pdf_path):
            pdfs = [f for f in os.listdir(tmpdir) if f.endswith(".pdf")]
            if pdfs:
                pdf_path = os.path.join(tmpdir, pdfs[0])
            else:
                print("Error: PDF conversion failed.", file=sys.stderr)
                sys.exit(1)

        # Convert PDF pages to images
        subprocess.run(
            ["pdftoppm", "-jpeg", "-r", "150", pdf_path, os.path.join(output_dir, "slide")],
            check=True, capture_output=True
        )

    images = sorted(Path(output_dir).glob("slide-*.jpg"))
    return images


def create_thumbnail_grid(images, output_path, cols=3, thumb_width=400):
    """Create a contact-sheet grid of slide thumbnails."""
    if not images:
        print("No slide images found.", file=sys.stderr)
        return

    thumbs = []
    for img_path in images:
        img = Image.open(img_path)
        ratio = thumb_width / img.width
        thumb_height = int(img.height * ratio)
        img = img.resize((thumb_width, thumb_height), Image.LANCZOS)
        thumbs.append(img)

    rows = (len(thumbs) + cols - 1) // cols
    padding = 10
    grid_width = cols * thumb_width + (cols + 1) * padding
    row_height = max(t.height for t in thumbs) if thumbs else 300
    grid_height = rows * row_height + (rows + 1) * padding

    grid = Image.new("RGB", (grid_width, grid_height), "white")

    for i, thumb in enumerate(thumbs):
        r, c = divmod(i, cols)
        x = padding + c * (thumb_width + padding)
        y = padding + r * (row_height + padding)
        grid.paste(thumb, (x, y))

    grid.save(output_path, "JPEG", quality=90)
    print(f"Thumbnail grid saved: {output_path}")
    print(f"Slides: {len(images)}, Grid: {cols}x{rows}")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <pptx_file> [output_dir]")
        sys.exit(1)

    pptx_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="pptx_thumbs_")

    os.makedirs(output_dir, exist_ok=True)
    images = pptx_to_images(pptx_path, output_dir)

    grid_path = os.path.join(output_dir, "thumbnail_grid.jpg")
    create_thumbnail_grid(images, grid_path)

    print(f"\nIndividual slides in: {output_dir}")
    for img in images:
        print(f"  {img.name}")


if __name__ == "__main__":
    main()
