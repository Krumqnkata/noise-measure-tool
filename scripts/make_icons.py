"""Генерира иконите на приложението (PWA) в static/icons/: циферблат на тъмен фон.

    python scripts/make_icons.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "icons"
BG = (16, 26, 34)
ACCENT = (57, 135, 229)
ZONES = [(12, 163, 12), (250, 178, 25), (236, 131, 90), (208, 59, 59)]


def draw_icon(size: int, padding: float, rounded: bool) -> Image.Image:
    # Рисуваме 4 пъти по-голямо и намаляваме – за гладки ръбове
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=BG)
    else:
        d.rectangle((0, 0, s, s), fill=BG)   # maskable: системата сама отрязва формата
    inset = s * padding
    box = (inset, inset * 1.05, s - inset, s - inset * 0.95)
    width = int(s * 0.07)
    # Дъга 270° отворена отдолу, оцветена по зони, и стрелка
    start, sweep = 135, 270
    shares = [60 / 140, 20 / 140, 10 / 140, 50 / 140]
    angle = start
    for color, share in zip(ZONES, shares):
        d.arc(box, angle, angle + sweep * share, fill=color, width=width)
        angle += sweep * share
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    a = math.radians(start + sweep * 0.62)
    r = (box[2] - box[0]) / 2 * 0.72
    d.line((cx, cy, cx + math.cos(a) * r, cy + math.sin(a) * r), fill=(236, 241, 244), width=int(s * 0.045))
    dot = s * 0.05
    d.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192, 0.17, True).save(OUT / "icon-192.png")
    draw_icon(512, 0.17, True).save(OUT / "icon-512.png")
    draw_icon(180, 0.17, False).convert("RGB").save(OUT / "apple-touch-icon.png")
    draw_icon(512, 0.27, False).save(OUT / "maskable-512.png")   # повече въздух – безопасна зона
    for f in sorted(OUT.iterdir()):
        print(f.relative_to(ROOT), f.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
