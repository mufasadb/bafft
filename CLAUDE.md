# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Privacy: this repo is public

Everything committed here, including code comments, test data and commit messages, is
published at https://github.com/mufasadb/bafft. Keep out of it: the owner's or their
players' real names, their campaign's names, home-network hosts and addresses, personal
paths, and anything from `private/` (local-only, gitignored). Use invented names in tests and
examples. Bead ids in commit messages are fine; the beads themselves stay local.

## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Git workflow

This repo opts into the **team-maintainer** profile described in the Beads section:
finished work doesn't sit uncommitted or unpushed.

- When a piece of work is done and the quality gates pass (`npm run typecheck`,
  `npm test`), commit it and push it in the same session:
  `git pull --rebase && git push`.
- Don't leave a dirty working tree at handoff. Anything left uncommitted should be
  deliberately in progress, and the handoff should say why.
- Don't leave git worktrees or side branches dangling. When their work lands, merge or
  push it and remove the worktree (`git worktree remove <path>`).
- Keep commits scoped: `git add` the files you changed by name, never `git add -A`, and
  leave unrelated pre-existing diffs (`.beads/`, `.gc/`, `.claude/`) alone. Reference the
  bead id in the commit message.
- Never force-push. A current "don't commit" or "don't push" instruction still wins.
- If `git push` or `bd dolt push` fails, stop and report the exact command and error
  instead of working around it.

## Conventions & Patterns

_Add your project-specific conventions here_
