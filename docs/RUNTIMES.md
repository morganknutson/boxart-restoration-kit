# Running the agents in your runtime

The workflow only needs three things from an agent runtime: **start an agent with a prompt**, **send a message to
another agent**, and **run shell commands**. Everything else — the queue, claims, judgements, announcements — is
files and the tools in `tools/`, so reviewers on different runtimes can share one queue.

## Installing the skill
`agents/SKILL.md` is a standard agent skill (YAML front matter + instructions). Make it available as a folder named
after the skill:
- **Claude Code**: `mkdir -p <project>/.claude/skills/restoration && cp agents/SKILL.md <project>/.claude/skills/restoration/`
  (or `~/.claude/skills/restoration/` for every project).
- **Codex**: `mkdir -p ~/.codex/skills/restoration && cp agents/SKILL.md ~/.codex/skills/restoration/`.
Skills are loaded when a session starts: start new sessions after installing or updating.
Then: "Use the restoration skill. You are the orchestrator. Run 2 reviewers." — or "…You are reviewer S1."

## Codex
- **Sandbox network**: workspace-write sessions have no network in the shell, so restorers can't download references
  with curl. They open `http://127.0.0.1:<port>/api/save-ref?...` in their browser tool and the review server
  downloads the image.
- **Writing outside the workspace**: if your art or outputs live elsewhere (another drive, a symlinked folder), add it
  to `~/.codex/config.toml`, then start new sessions:
  ```toml
  [sandbox_workspace_write]
  writable_roots = ["/path/to/your/art"]
  ```
- **Process tools are blocked** in the sandbox (`ps`, `lsof`). `restore_check.py` finds the caller's transcript from
  `CODEX_THREAD_ID` (Codex sets it for every command) → `~/.codex/sessions/**/rollout-*<id>.jsonl`.
- **Model**: a model requested when spawning may not override `model` in `~/.codex/config.toml` — set the default to
  the model you want, and trust the model recorded by `restore_check.py`, not what an agent says.
- **Starting / messaging agents**: use whatever your harness provides (separate `codex` sessions, an app that spawns
  them, or a pane manager). The reviewer only needs to be able to send its helpers a job and receive their reply.

## Claude Code
- Reviewers can run helpers as subagents (the Task/Agent tool) or as separate sessions; separate sessions are better
  for long jobs (each helper keeps its own context).
- `restore_check.py` finds the caller's transcript from `CLAUDE_CODE_SESSION_ID` → `~/.claude/projects/*/<id>.jsonl`
  and reads the model from the assistant messages.

## Addy (macOS)
- Spawn: `addy_spawn_agent` (name, model, prompt). Message: `addy_notify_pane` with the target pane id. Read another
  agent's progress: `addy_read_pane`.
- Run the review server with `addy_start_server` so it gets its own pane; open the page with `addy_open_url`.
- Addy's work-scope publishing may reject paths outside the repository (e.g. art on another drive): that never blocks
  file writes.

## Anything else
Map "start an agent", "send a message" and "run a shell command" to your runtime, and make sure each agent reads its
brief in `agents/`. If your runtime records transcripts somewhere else, add it to `kit.json` → `transcripts` and, if it
exposes a session id, teach `own_transcript()` in `tools/restore_check.py` about it.
