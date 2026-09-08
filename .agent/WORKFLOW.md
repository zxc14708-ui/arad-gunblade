# Task Workflow

State machine for any unit of work routed through the Orchestrator. Written
so QC can later be pulled out into its own actor without changing the states
or transitions — see `.agent/ROUTING.md` for the role table this refers to.

## States

1. `design_needed` — a gameplay/balance/system question is unresolved. The
   Orchestrator adds concise options to `DESIGN_LOG.md` and stops. No further
   transition happens without user approval (mirrors AGENTS.md: "Do not
   invent gameplay balance or system rules").
2. `approved` — the user has approved a specific decision or spec. Recorded
   as a `DESIGN_LOG.md` reference in `STATUS.json`, not re-derived later.
3. `assigned_dev` / `assigned_art` — the Orchestrator routes the approved
   task to Codex or Gemini per `.agent/ROUTING.md`.
4. `in_progress` — Developer/Art is working.
5. `submitted` — Developer/Art reports the work done; the Orchestrator has
   not yet verified it.
6. `qc` — the Orchestrator runs the existing gate: `npm run qc`, inspects
   `qc-out/contact.png` by eye, confirms `state_snapshot.mjs --check` passed.
   This is the state that becomes a dedicated QC agent later; only the actor
   changes, not the state name or its entry/exit conditions.
7. `qc_failed` — the gate failed (non-zero exit, or a visual/asset defect
   judged by eye). Returns to `assigned_dev` / `assigned_art` with the
   concrete failure noted in `STATUS.json` / `events.jsonl`.
8. `qc_passed` — the gate passed.
9. `integrated` — the Orchestrator commits and pushes to `main`. Only the
   Orchestrator performs this transition, regardless of who ran `qc`.
10. `blocked` — waiting on the user for anything other than a first design
    decision (e.g. ambiguous instructions, conflicting approvals).

## Rules

- No transition into `approved` happens without an explicit user decision.
  The Orchestrator proposes; it never self-approves a design/balance call.
- No transition into `integrated` happens without passing `qc` in the same
  work item — skipping QC is not a valid path, even for a "trivial" change.
- `qc` reuses the existing verification stack as-is (`npm run qc`,
  `qc-out/contact.png`, `tools/state_snapshot.mjs --check`,
  `tools/measure_sprites.py`). This workflow does not introduce a second
  verification tool.
- A task's full transition history is appended to `.agent/events/events.jsonl`
  (local only, not committed — see `.gitignore`). `STATUS.json` (committed)
  holds only the current state per active task, not history.

## `STATUS.json` active-task shape

Each entry in `active_tasks` follows this shape (documented here, not in the
JSON file itself, since JSON has no comments):

```json
{
  "task_id": "T-0001",
  "title": "short human-readable summary",
  "state": "assigned_dev",
  "owner_role": "developer",
  "design_log_ref": "DESIGN_LOG.md#some-anchor",
  "created_at": "2026-09-08T13:00:00+09:00",
  "updated_at": "2026-09-08T13:40:00+09:00"
}
```

`design_log_ref` is `null` when the task needed no design decision (a plain
bug fix, for example).

## Event schema (`events.jsonl`, one JSON object per line)

```json
{"ts": "2026-09-08T13:40:00+09:00", "task_id": "T-0001", "actor": "orchestrator", "from_state": "submitted", "to_state": "qc", "note": "npm run qc started"}
```

Fields: `ts` (ISO 8601), `task_id`, `actor` (`orchestrator` | `developer` |
`art` | `qc` — free-form today, becomes meaningful once QC separates),
`from_state`, `to_state`, `note` (optional, short).
