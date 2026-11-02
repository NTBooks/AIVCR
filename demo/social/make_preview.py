"""GitHub social preview (the card a shared repo link shows): 1280x640, the logo over a review-harness frame and the
slop-o-meter's final frame. python demo/social/make_preview.py  ->  assets/social-preview.png
Upload it by hand: Settings -> General -> Social preview (GitHub has no API for it)."""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
A = os.path.join(ROOT, "assets")
W, H = 1280, 640


def shot(path, w):
    im = Image.open(path).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], 14, fill=255)
    return im, mask


def main():
    logo = Image.open(os.path.join(A, "logo.png")).convert("RGB")
    canvas = Image.new("RGB", (W, H), logo.getpixel((2, 2)))   # the logo's own black, so it has no visible box
    lw = 660
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    fade = Image.new("L", logo.size, 0)   # feather the edges too, in case the logo's black isn't even
    ImageDraw.Draw(fade).rectangle([18, 18, logo.width - 19, logo.height - 19], fill=255)
    canvas.paste(logo, ((W - lw) // 2, 18), fade.filter(ImageFilter.GaussianBlur(9)))
    with tempfile.TemporaryDirectory() as tmp:   # a frame of the README demo: the before/after wipe on a marked note
        frame = os.path.join(tmp, "harness.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(A, "demo.gif"), "-vf", r"select=eq(n\,200)",
                        "-frames:v", "1", frame], check=True)
        pics = [shot(frame, 584), shot(os.path.join(A, "slop-o-meter", "card-final.png"), 584)]
    y, gap = 280, 32
    x = (W - sum(p[0].width for p in pics) - gap) // 2
    for im, mask in pics:
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([x + 8, y + 12, x + im.width + 8, y + im.height + 12], 16, fill=(0, 0, 0, 170))
        canvas.paste(sh.filter(ImageFilter.GaussianBlur(10)), (0, 0), sh.filter(ImageFilter.GaussianBlur(10)))
        canvas.paste(im, (x, y), mask)
        x += im.width + gap
    out = os.path.join(A, "social-preview.png")
    canvas.save(out, optimize=True)
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
