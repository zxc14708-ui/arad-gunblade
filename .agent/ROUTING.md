# Agent Routing

Entry point for any agent session in this repo. Read this first to confirm
your role, then read `AGENTS.md` (and whatever it routes you to) for the
actual project rules — this file does not repeat them.

## Roles

| Role | Agent | Owns | Cannot do |
| --- | --- | --- | --- |
| Orchestrator | Claude | Design/balance proposals, the user-approval loop, task routing, the QC gate, `main` integration and push | Finalize a design or balance decision without recorded user approval (see `DESIGN_LOG.md`) |
| Developer | Codex | Implementing an already-approved decision in `src/` | Inventing or changing gameplay/balance values that are not already approved |
| Art | Gemini | Art direction, sprite-spec definition (frame counts, cell size, anchoring) against `ART_GUIDE.md`, image analysis, PNG generation via the Nano Banana API | Changing gameplay logic; wiring new asset paths into `src/rendering/assets.ts` (Developer/Orchestrator does that) |
| QC | Claude, as an internal Orchestrator step (see note below) | Running `npm run qc`, judging `qc-out/contact.png` by eye, checking `state_snapshot.mjs --check` | Approving integration on a non-zero exit code or an unreviewed contact sheet |

**QC is not a separate agent today.** It is a mandatory step the Orchestrator
performs itself before integrating anything — see the `qc` state in
`.agent/WORKFLOW.md`. The row exists so QC can later move to a dedicated
agent/session by changing only the `actor` recorded for that state; the
workflow states, the routing rules below, and the `STATUS.json` shape do not
need to change when that happens.

## Routing rules

| Task type | Path |
| --- | --- |
| Gameplay/balance change | Orchestrator drafts options in `DESIGN_LOG.md` → user approves → Developer implements → QC → Orchestrator integrates |
| New/replacement art (sprite, prop, effect) | Orchestrator confirms spec against `ART_GUIDE.md` → Art (Gemini) produces PNGs (+ analysis) → Developer wires paths in `src/rendering/assets.ts` if needed → QC → Orchestrator integrates |
| Bug fix with no open design question | Developer implements directly → QC → Orchestrator integrates |
| Docs/tooling only | Orchestrator handles directly → QC if it touches `npm run qc`/the build → Orchestrator integrates |

Every path ends the same way: nothing reaches `main` without passing the `qc`
state in `.agent/WORKFLOW.md`, and the Orchestrator is always the one who
pushes.

## Still governed by AGENTS.md

This file does not replace or duplicate:

- Read order (`AGENTS.md` → `PROJECT_STATUS.md` → `HANDOFF.md` → `DESIGN_LOG.md` as needed → the `docs/INDEX.md`-routed document)
- The QC gate itself (`npm run qc`, `contact.png`, `state_snapshot.mjs --check`)
- Gameplay/asset invariants
- `ART_GUIDE.md`'s delivery checklist

Those stay the single source of truth in their existing files.
