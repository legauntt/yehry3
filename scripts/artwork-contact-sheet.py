"""Render saved covers from an artwork audit for human visual review."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("audit", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
parser.add_argument("--only", nargs="+", help="Include only these song IDs")
args = parser.parse_args()
rows = [row for row in json.loads(args.audit.read_text(encoding="utf-8"))["songs"] if row.get("cover")]
if args.only:
    rows = [row for row in rows if row["id"] in args.only]
args.output.mkdir(parents=True, exist_ok=True)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 15)
except OSError:
    font = ImageFont.load_default()
for page, start in enumerate(range(0, len(rows), 24), 1):
    group = rows[start:start + 24]
    sheet = Image.new("RGB", (1024, ((len(group) + 3) // 4) * 300), "#f5f3e9")
    draw = ImageDraw.Draw(sheet)
    for offset, row in enumerate(group):
        x, y = (offset % 4) * 256, (offset // 4) * 300
        with Image.open(args.root / row["cover"]["src"].lstrip("/")) as img:
            sheet.paste(ImageOps.fit(img.convert("RGB"), (244, 244)), (x + 6, y + 4))
        title = row["title"]
        label = f'{start + offset + 1}. {"PINNED | " if row["pins"] else ""}{title}'
        draw.text((x + 6, y + 251), label[:32], font=font, fill="#162b28")
        draw.text((x + 6, y + 272), label[32:65], font=font, fill="#162b28")
    file = args.output / f"covers-{page:02}.jpg"
    sheet.save(file, quality=90)
    print(file)
