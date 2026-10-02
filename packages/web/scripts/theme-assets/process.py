# Turns raw Gemini images into CSS-ready theme assets.
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

RAW, OUT = sys.argv[1], sys.argv[2]

def seamless(img: np.ndarray) -> np.ndarray:
    """Cross-fade the image with a half-offset copy of itself. The copy is
    continuous across the wrap-around edges, and a cosine window hands the
    edges to it, so the result tiles with no seam."""
    h, w = img.shape[:2]
    rolled = np.roll(img, (h // 2, w // 2), axis=(0, 1))
    wy = np.sin(np.linspace(0, np.pi, h))[:, None]
    wx = np.sin(np.linspace(0, np.pi, w))[None, :]
    weight = (wy * wx)[..., None] ** 0.5
    return img * weight + rolled * (1 - weight)

def texture(name, target_rgb, contrast, size=768, flatten=6):
    im = Image.open(f"{RAW}/{name}.jpg").convert("RGB")
    s = min(im.size)  # centre square crop, trimming any edge darkening
    im = im.crop(((im.width - s) // 2 + s // 16, (im.height - s) // 2 + s // 16,
                  (im.width + s) // 2 - s // 16, (im.height + s) // 2 - s // 16)).resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    # Remove large-scale light falloff so repeats don't read as a grid.
    low = ndimage.gaussian_filter(a, sigma=(size / flatten, size / flatten, 0), mode="wrap")
    a = a - low + low.mean(axis=(0, 1))
    a = seamless(a)
    mean = a.mean(axis=(0, 1))
    a = np.array(target_rgb) + (a - mean) * contrast
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f"{OUT}/{name}-tile.jpg", quality=86)
    # 2x2 check image for eyeballing seams.
    t = Image.open(f"{OUT}/{name}-tile.jpg")
    chk = Image.new("RGB", (size * 2, size * 2))
    for x in (0, size):
        for y in (0, size):
            chk.paste(t, (x, y))
    chk.save(f"{RAW}/../{name}-check.jpg", quality=80)

def keyed(name, max_size):
    im = Image.open(f"{RAW}/{name}.jpg").convert("RGB")
    a = np.asarray(im).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    magenta = np.minimum(r, b) - g  # ~255 on pure magenta, <=0 on gold/ink/teal
    alpha = 1 - np.clip((magenta - 40) / (150 - 40), 0, 1)
    alpha = ndimage.gaussian_filter(alpha, 0.6)
    # Despill: magenta fringe pushes blue and red above green on edge pixels.
    edge = alpha < 0.999
    a[..., 2] = np.where(edge, np.minimum(b, g * 1.05), b)
    a[..., 0] = np.where(edge, np.minimum(r, np.maximum(g * 1.6, 1)), r)
    rgba = np.dstack([a, alpha * 255]).clip(0, 255).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    bbox = out.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    out = out.crop(bbox)
    out.thumbnail((max_size, max_size), Image.LANCZOS)
    out.save(f"{OUT}/{name}.webp", quality=88, method=6)
    return out

texture("parchment", (239, 227, 200), 0.45, flatten=24)
texture("leather", (58, 37, 23), 0.8)
frame = keyed("frame", 640)
keyed("corner", 320)
keyed("divider", 1400)

# Where the portrait goes: the transparent hole connected to the frame's centre.
al = np.asarray(frame.getchannel("A")) < 128
labels, _ = ndimage.label(al)
hole = labels == labels[al.shape[0] // 2, al.shape[1] // 2]
ys, xs = np.nonzero(hole)
h, w = al.shape
print(f"frame {w}x{h}; opening inset: top {ys.min()/h:.3%} left {xs.min()/w:.3%} "
      f"bottom {1-(ys.max()+1)/h:.3%} right {1-(xs.max()+1)/w:.3%}")
