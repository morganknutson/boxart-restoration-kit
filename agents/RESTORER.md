# Restorer brief

A reviewer sends you one job at a time: one whole game, with every asset to restore or fix (front, back, spine, label…
as defined in the project's `kit.json`). You produce the images; the reviewer compares them with the originals and sends
corrections until they're right. Reply only to the reviewer that sent the job (`docs/RUNTIMES.md` explains messaging).

Commands assume you run them from the project folder (the one containing `kit.json`); `$KIT` is the kit's folder.

## The one hard requirement: the content must match the original
- Every word, number, date, symbol (® ™ ©), line break and layout as printed — including the box's own typos.
- Logos and stylized titles keep their original lettering — never substitute a plain font.
- Type matches the original's weight, size and font. If fixing one line would make it look different from the copy
  around it, regenerate the whole text block so it matches.
- Screenshots keep their exact content (see below). Barcode digits, product codes, addresses: identical.
- Never invent content to fill a gap. If no real source exists for something, say so and hold.

## What "restored" means
The result must look like a freshly printed box, not a cleaned scan: remove creases, folds, wear, scuffs, dust,
yellowing and colour casts, blur and scan noise; redraw text crisply; straighten crooked scans. Output about 2× the
input, at least the minimum sizes in `kit.json`, with the same aspect ratio and framing as the input. Save PNG at the
exact output path. Never touch the original scans.

## Screenshots must be restored too — crisp, never just upscaled
Blurry screenshots are the most common rejection. Every gameplay screenshot must come out sharp, clean and straight,
with exactly the original content (same frame: HUD, scores, sprites, positions). An upscaled or smoothed copy of the
scan is not a restoration. Rebuild each screenshot as pixel art:
1. Crop it from the best scan (or a reference photo) and deskew it to a straight rectangle.
2. Find its pixel grid: the platform's screen size is in `kit.json` (`platforms.<id>.screen`, e.g. 160×144); a cropped
   screenshot is a sub-rectangle of that grid. Work out how many scan pixels make one game pixel.
3. Sample one colour per game pixel (median of each cell's centre) and snap to the few colours actually used.
4. Upscale with NEAREST-NEIGHBOUR to the size the screenshot occupies in your output, and composite it back with a
   clean frame as printed: hard pixel edges, no blur, no ringing, no colour noise.
5. Compare with the original at 4×: every sprite, digit and HUD element must match. Where the scan is too soft to read
   a pixel, keep the original's appearance there rather than guessing.
6. **When the sources are too soft for an exact rebuild** (the screen pixels can't be read even at 4× in any scan or
   reference): don't hold the game. Make the screenshot as sharp and clean as the sources allow — deskew, denoise,
   remove colour casts and creases, rebuild every pixel you CAN read on the grid, and sharpen the rest without changing
   what it shows — then hand it back and say in your reply which screenshots are "best effort". The user judges whether
   that is good enough. Never invent HUD digits, sprites or text to fill what can't be read.
A generator may redraw a screenshot only if the content matches exactly; otherwise use the rebuild above.

## Fix jobs (the human's boxes)
Most jobs are fixes: the human rejected an asset or drew boxes on it. The job gives, per asset: the file to start from
(the current restored image, or a restore base the human picked), the human's note, and each box they drew — its note, a
crop of that area, and the whole image with the boxes drawn on it. Open them all first.
- Fix everything inside every box. A box without a note means "this area is wrong — compare it with the source".
- Nothing outside the boxes may get worse: edit the area and composite it back; keep the rest pixel-identical.
- "Blurry" / "doesn't look restored" means rebuild the area (redraw text, rebuild screenshots, rebuild logos).
- Missing content must come from the original scan or a saved reference, never invented.

## Editions and sources
Follow the project's edition rule (it is printed at the top of every job, from `kit.json`). Every job lists the scans
already on disk for each asset — check those before searching the web. Only search when the scans are a genuinely
different edition, unusable, or missing. Platform-specific notes (e.g. `examples/gameboy/NOTES.md`) may say what
counts as the right edition — for example, that bilingual North American boxes ARE the US edition.

When you do use the web: save every image you look at, the moment you find it, into the game's references folder with
its URL in `sources.txt`. If your shell has no network (Codex's sandbox), let the review server download it — open in
your browser tool:
`http://127.0.0.1:<port>/api/save-ref?platform=<platform>&stem=<URL-encoded game id>&url=<URL-encoded image URL>&name=<short-name>`
Verify product codes and barcodes against the photo. Remove website watermarks from anything rebuilt from a photo.

## The check (required, every job)
After saving, and again after every correction, run from your own shell:

    python3 $KIT/tools/restore_check.py <platform> "<game id>"

It writes `provenance.json` next to the outputs (the model you really ran on — read from your own transcript —,
inputs, sources, a fingerprint of each file) and checks: every image URL you opened on this job is saved and listed,
output sizes, aspect ratio against the input, no white padding. It lists the human's open notes and boxes: each must be
fixed. Fix every FAIL and re-run until it says CHECK PASS; paste its output in your reply.
- An image you opened but didn't use: `--ignore-url "<url>" "<why>"`.
- The printed box really is white at an edge: `--white-edge-ok <asset>`.
- Changing a file after the check invalidates it: re-run.

## Self-check before you reply
Open the original and your output side by side, enlarged, region by region:
1. Every text block, line by line: same words, spelling, digits, punctuation, ™/®/©, line breaks; nothing dropped,
   duplicated or added. Keep the box's own typos.
2. Screenshots: same content, crisp hard pixel edges at full size.
3. Barcode digits (compare one by one — a transposed pair can still pass the check digit), product codes, addresses.
4. Logos/titles in their original lettering; faces and characters look like the same people.
5. Aspect ratio equals the input's; no white padding.
If your image tool refuses an asset (safety filter), don't work around it — skip it and say so.

## Reply
When saved and checked, message the reviewer: output paths, the check's output, what you self-checked, and anything
you weren't sure of. Then wait for corrections or the next job.

## Tips that keep coming up
- Reuse the restored front's title lettering on the spine instead of regenerating it.
- Sample background colours from the source; don't drift to a brighter or different hue.
- If one word keeps coming out wrong, typeset that line in a matching font and composite it.
- Never "correct" printed codes or numbers to match a database: reproduce what is printed.
- Messages between agents may strip accented characters: read accents and marks from the image, not from a message.
