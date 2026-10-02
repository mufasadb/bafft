# Warm tabletop theme assets

| File | Size | What / made how |
|---|---|---|
| `parchment-tile.jpg` | 768² | Body and panel background. Seamless tile. |
| `leather-tile.jpg` | 768² | Sidebar and top bar. Seamless tile. |
| `frame.webp` | 640² | Portrait frame, transparent centre. The opening is 16.8% in from each side (`theme.css` uses this). |
| `corner.webp` | ≤320 | Top-left filigree, mirrored in CSS for the top right. |
| `divider.webp` | ≤1400 wide | Flourish under the NPC card header. |
| `*.svg` | 24×24 | Line icons (currentColor), by the Muse (bead `la-g0tfg1`). |

The raster images were generated with Gemini (`gemini-3-pro-image`) and then
processed in code. Textures are made seamless with a half-offset cross-fade,
then flattened and calmed. Ornaments were drawn on #FF00FF and keyed to
transparency with despill. To remake them:

```bash
cd packages/web/scripts/theme-assets
python3 -m venv .venv && .venv/bin/pip install numpy scipy pillow
GEMINI_API_KEY=... python3 gen.py frame gemini-3-pro-image "<prompt>"   # writes raw/<name>.jpg
.venv/bin/python process.py raw ../../src/assets/theme                   # prints the frame opening
```

The prompts that worked are in the bafft-vm8.4 bead notes. Plain photo-style
texture prompts get refused (IMAGE_RECITATION), so describe them as an
"original digital painting for a game UI background" instead.
