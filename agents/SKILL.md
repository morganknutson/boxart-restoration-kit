---
name: restoration
description: Restore and fix game box art (covers, backs, spines, cartridge/disc labels…) under human review with the boxart-restoration-kit. Use when asked to review, restore, fix or re-do box art or other platform assets, run a restoration reviewer, restorer or orchestrator, or work the fix queue.
---

# Asset restoration (boxart-restoration-kit)

A human judges every restored asset on the review page; their rejections, drawn boxes and notes are the only source
of work. Find the project folder (it contains `kit.json`) and the kit folder (`$KIT`, the one containing this
`agents/` folder). Run commands from the project folder.

## Pick your role and read its brief first — it is the whole procedure
- **Orchestrator** (start and watch reviewers S1, S2…, pass on the human's decisions, report): `$KIT/agents/ORCHESTRATOR.md`
- **Reviewer** (lead two helpers, hand fixes back to the human): `$KIT/agents/REVIEWER.md`
- **Restorer / helper** (a reviewer sends you jobs): `$KIT/agents/RESTORER.md`
Everyone: read `<work>/fix/ANNOUNCEMENTS.md` if present — the human's latest decisions, newest first.
Reviewers and restorers: open `<work>/fix/QUALITY.md` and look at every image it lists — that is the quality bar.
Your runtime (Codex, Claude Code, Addy, …): `$KIT/docs/RUNTIMES.md`.

## The tools
| Command | Who | What |
|---|---|---|
| `python3 $KIT/tools/fix_queue.py board` | orchestrator | who holds which game, for how long, last seen, done/held; stale claims flagged |
| `python3 $KIT/tools/fix_queue.py claim <you>` | reviewer | a new game to fix (one per helper, max 2) with the human's notes, box crops, scans on disk, references |
| `python3 $KIT/tools/fix_queue.py show <platform> "<game>"` | reviewer | reprint a claimed job (keeps the claim alive) |
| `python3 $KIT/tools/fix_queue.py done <you> <platform> "<game>"` | reviewer | hand the fix back to the human (needs VERIFY PASS) |
| `python3 $KIT/tools/fix_queue.py release <you> <platform> "<game>" [--hold "why"]` | reviewer | give a game back, or hold it |
| `python3 $KIT/tools/restore_check.py <platform> "<game>"` | restorer | required after every save; must say CHECK PASS |
| `python3 $KIT/tools/restore_check.py <platform> "<game>" --verify` | reviewer | gate before `done` |
| `http://127.0.0.1:<port>/api/save-ref?platform=…&stem=…&url=…&name=…` (in a browser tool) | restorer | save a web reference when your shell has no network |
| `python3 $KIT/tools/compare.py <orig> <new> <out.png> [crops]` | reviewer | side-by-side + detail crops |

## Hard rules
- Follow the project's edition rule (top of every job). Check the scans each job lists before searching the web.
  Save every reference image you look at.
- Fix what is inside the human's boxes; nothing outside them may get worse. Never invent content.
- Screenshots must be restored too: rebuilt as crisp pixel art (nearest-neighbour, exact content), never just upscaled.
- Never approve, reject, resolve marks or edit the human's files — the human judges, the page updates itself live.
- Never state which model you are from memory; the check reads it from your own transcript.
