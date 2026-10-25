"""Validate and compress a generated master for the site's lazy-loaded cards."""
import argparse
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
with Image.open(args.source) as image:
    if image.format != "WEBP" or image.size != (1024, 1024) or getattr(image, "n_frames", 1) != 1:
        raise ValueError("Expected one 1024-square WebP cover")
    image.load()
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(args.destination, "WEBP", quality=86, method=6)
print(f"Prepared {args.destination.name}: {args.destination.stat().st_size} bytes")
