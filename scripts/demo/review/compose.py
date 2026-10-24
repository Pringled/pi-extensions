# Splices the browser half of the review demo into the terminal recording, at the pause after the first /review.
# Usage: uv run --with pillow python compose.py <terminal.gif> <browser frames dir> <out.gif>
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

FPS = 25
# The content area of vhs's window: 30px margin, then a 36px window bar
LEFT, TOP, RIGHT, BOTTOM, RADIUS = 30, 66, 1270, 950, 12

terminal_gif, browser_dir, out_gif = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
work = Path(tempfile.mkdtemp())
(work / "t").mkdir()
subprocess.run(["ffmpeg", "-loglevel", "error", "-i", terminal_gif, "-vf", f"fps={FPS}", work / "t" / "%05d.png"], check=True)
terminal = sorted((work / "t").glob("*.png"))

# The pause is the longest run of unchanged frames in the first 60% (the hold at the very end doesn't count)
hashes = [hashlib.md5(Image.open(f).tobytes()).hexdigest() for f in terminal]
best, start = (0, 0), 0
for i in range(1, int(len(hashes) * 0.6)):
    if hashes[i] != hashes[i - 1]:
        start = i
    if i - start > best[1] - best[0]:
        best = (start, i)
pause_start, pause_end = best

# Draw each browser screenshot into the terminal's window, keeping its margin, bar and rounded corners
template = Image.open(terminal[pause_start]).convert("RGB")
mask = Image.new("L", template.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((LEFT, TOP - RADIUS, RIGHT - 1, BOTTOM - 1), RADIUS, fill=255)
ImageDraw.Draw(mask).rectangle((0, 0, template.width, TOP - 1), fill=0)
browser = []
for entry in json.loads((browser_dir / "frames.json").read_text()):
    shot = Image.open(browser_dir / entry["file"]).convert("RGB").resize((RIGHT - LEFT, BOTTOM - TOP))
    layer = template.copy()
    layer.paste(shot, (LEFT, TOP))
    composed = Image.composite(layer, template, mask)
    browser += [composed] * max(1, round(entry["seconds"] * FPS))

# Terminal up to half a second into the pause, then the browser, then the rest of the terminal with Pi's work at 1.8x
# (the last 4 seconds, Pi's answer, at normal speed)
rest = terminal[pause_end:]
work_part, hold = rest[: -4 * FPS], rest[-4 * FPS :]
work_part = [work_part[int(i * 1.8)] for i in range(int(len(work_part) / 1.8))]
sequence = [Image.open(f) for f in terminal[: pause_start + FPS // 2]] + browser + [Image.open(f) for f in work_part + hold]
(work / "o").mkdir()
for i, image in enumerate(sequence):
    image.convert("RGB").save(work / "o" / f"{i:05d}.png")
subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", work / "o" / "%05d.png",
     "-filter_complex", "[0]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5", out_gif],
    check=True,
)
print(f"{out_gif.name}: {len(sequence) / FPS:.1f}s, browser spliced in at {pause_start / FPS:.1f}s")
