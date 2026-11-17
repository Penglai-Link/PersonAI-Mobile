#!/usr/bin/env python3
"""Generate PersonAI Mobile app icon assets.

The mark is vector; the soft bloom is composited with a real Gaussian blur at
raster time so Android adaptive foregrounds stay clean without filter tiles.
Requires rsvg-convert and Pillow.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / "design" / "app-icon"
ASSETS = ROOT / "assets"
IOS_ICON = ROOT / "ios" / "PersonAI" / "Images.xcassets" / "AppIcon.appiconset" / "App-Icon-1024x1024@1x.png"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
BLUE = (47, 123, 255)
CYAN = (111, 212, 255)

MARK = """
  <g opacity="0.95">
    <ellipse cx="512" cy="628" rx="356" ry="108" transform="rotate(-9 512 628)" fill="none" stroke="#58C8FF" stroke-opacity="0.50" stroke-width="7"/>
    <ellipse cx="512" cy="628" rx="356" ry="108" transform="rotate(-9 512 628)" fill="none" stroke="#BFF6FF" stroke-opacity="0.22" stroke-width="2"/>
  </g>
  <path d="M270 808 L512 206 L754 808" fill="none" stroke="url(#mark)" stroke-width="138" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M352 622 L672 622" fill="none" stroke="url(#mark)" stroke-width="86" stroke-linecap="round"/>
  <circle cx="838" cy="586" r="72" fill="url(#nodeHalo)"/>
  <circle cx="838" cy="586" r="24" fill="url(#core)"/>
  <circle cx="838" cy="586" r="35" fill="none" stroke="#BFF6FF" stroke-opacity="0.35" stroke-width="1.5"/>
"""

MONO = """
  <path d="M270 808 L512 206 L754 808" fill="none" stroke="#FFFFFF" stroke-width="138" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M352 622 L672 622" fill="none" stroke="#FFFFFF" stroke-width="86" stroke-linecap="round"/>
"""

DEFS = """
  <radialGradient id="bg" cx="50%" cy="26%" r="88%">
    <stop offset="0%" stop-color="#142844"/>
    <stop offset="42%" stop-color="#0A1424"/>
    <stop offset="100%" stop-color="#050608"/>
  </radialGradient>
  <radialGradient id="bgHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#2F7BFF" stop-opacity="0.30"/>
    <stop offset="60%" stop-color="#2F7BFF" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="#2F7BFF" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="mark" x1="262" y1="206" x2="770" y2="824" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#A7F6FF"/>
    <stop offset="30%" stop-color="#55C8FF"/>
    <stop offset="62%" stop-color="#2F7BFF"/>
    <stop offset="100%" stop-color="#7B4DFF"/>
  </linearGradient>
  <radialGradient id="core" cx="40%" cy="34%" r="70%">
    <stop offset="0%" stop-color="#FFFFFF"/>
    <stop offset="34%" stop-color="#CFF8FF"/>
    <stop offset="72%" stop-color="#4CC9FF"/>
    <stop offset="100%" stop-color="#1E4FD8"/>
  </radialGradient>
  <radialGradient id="nodeHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#4CC9FF" stop-opacity="0.34"/>
    <stop offset="60%" stop-color="#4CC9FF" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="#4CC9FF" stop-opacity="0"/>
  </radialGradient>
"""


def svg_document(body: str, background: bool = False) -> str:
    bg = ""
    if background:
        bg = '<rect width="1024" height="1024" fill="url(#bg)"/><circle cx="512" cy="520" r="430" fill="url(#bgHalo)"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>{DEFS}</defs>{bg}{body}
</svg>'''


def rasterize_rgba(svg_text: str, size: int) -> Image.Image:
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as handle:
        handle.write(svg_text)
        source = Path(handle.name)
    raw = source.with_suffix(".png")
    try:
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), str(source), "-o", str(raw)], check=True)
        return Image.open(raw).convert("RGBA")
    finally:
        source.unlink(missing_ok=True)
        raw.unlink(missing_ok=True)


def bloom(core: Image.Image, radius: int, tint: tuple[int, int, int], opacity: float) -> Image.Image:
    alpha = core.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    alpha = alpha.point(lambda value: int(value * opacity))
    layer = Image.new("RGBA", core.size, (*tint, 0))
    layer.putalpha(alpha)
    return layer


def compose_mark(scale: float, canvas: int = 1024, supersample: int = 2) -> Image.Image:
    """Return the mark with soft bloom on a transparent canvas."""
    body = f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{MARK}</g>'
    core = rasterize_rgba(svg_document(body), canvas * supersample)
    wide = bloom(core, 52 * supersample // 2, BLUE, 0.55)
    tight = bloom(core, 16 * supersample // 2, CYAN, 0.45)
    out = Image.new("RGBA", core.size, (0, 0, 0, 0))
    out.alpha_composite(wide)
    out.alpha_composite(tight)
    out.alpha_composite(core)
    return out.resize((canvas, canvas), Image.LANCZOS)


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def circular(image: Image.Image) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, image.width, image.height), fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def main() -> None:
    background = rasterize_rgba(svg_document("", background=True), 1024)
    background.save(ASSETS / "android-icon-background.png", optimize=True)

    foreground = compose_mark(0.58)
    foreground.save(ASSETS / "android-icon-foreground.png", optimize=True)

    splash = compose_mark(0.82)
    splash.save(ASSETS / "splash-icon.png", optimize=True)

    monochrome = rasterize_rgba(
        svg_document(f'<g transform="translate(512 512) scale(0.58) translate(-512 -512)">{MONO}</g>'),
        1024,
    )
    monochrome.save(ASSETS / "android-icon-monochrome.png", optimize=True)

    icon = background.copy()
    icon.alpha_composite(compose_mark(1.0))
    icon = icon.convert("RGB")
    icon.save(ASSETS / "icon.png", optimize=True)
    icon.save(IOS_ICON, optimize=True)

    icon.resize((64, 64), Image.LANCZOS).save(ASSETS / "favicon.png", optimize=True)

    # Design sources: geometry only; bloom is applied during rasterization.
    (DESIGN / "icon.svg").write_text(svg_document(f'<g>{MARK}</g>', background=True))
    (DESIGN / "background.svg").write_text(svg_document("", background=True))
    (DESIGN / "foreground.svg").write_text(svg_document(f'<g transform="translate(512 512) scale(0.58) translate(-512 -512)">{MARK}</g>'))
    (DESIGN / "monochrome.svg").write_text(svg_document(f'<g transform="translate(512 512) scale(0.58) translate(-512 -512)">{MONO}</g>'))

    densities = {
        "mdpi": (48, 108, 288),
        "hdpi": (72, 162, 432),
        "xhdpi": (96, 216, 576),
        "xxhdpi": (144, 324, 864),
        "xxxhdpi": (192, 432, 1152),
    }
    for density, (legacy, adaptive, splash_size) in densities.items():
        folder = ANDROID_RES / f"mipmap-{density}"
        square = icon.resize((legacy, legacy), Image.LANCZOS).convert("RGBA")
        rounded(square, round(legacy * 0.22)).save(folder / "ic_launcher.webp", quality=95, method=6)
        circular(square).save(folder / "ic_launcher_round.webp", quality=95, method=6)

        background.resize((adaptive, adaptive), Image.LANCZOS).save(folder / "ic_launcher_background.webp", quality=95, method=6)
        foreground.resize((adaptive, adaptive), Image.LANCZOS).save(folder / "ic_launcher_foreground.webp", quality=95, method=6)
        monochrome.resize((adaptive, adaptive), Image.LANCZOS).save(folder / "ic_launcher_monochrome.webp", quality=95, method=6)

        target = ANDROID_RES / f"drawable-{density}" / "splashscreen_logo.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        splash.resize((splash_size, splash_size), Image.LANCZOS).save(target)

    print("Generated icon assets.")


if __name__ == "__main__":
    main()
