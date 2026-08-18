---
description: Inspect and advance the RadRVU goal registry — status, nodes, contracts, audit
argument-hint: "[status | node <id> | contract <phase|id> | audit | drift | why <id>]"
allowed-tools: Read, Bash, Grep, Glob, Edit, Write, Workflow, mcp__codegraph__codegraph_explore
---

# /goals — the RadRVU goal registry

The registry is the contract this project cannot drift from. It lives in `goals/`:

| File | Role |
|---|---|
| `goals/DECISIONS.md` | **Normative.** D1–D27 from the professionalization workshop. Change here first. |
| `goals/GOALS.yaml` | G1–G12 with independently verifiable `done_when` entries |
| `goals/INVARIANTS.yaml` | `INV-*` — rules no node may violate, each with a machine check |
| `goals/nodes/*.yaml` | One contract per node (D24), written before any code |
| `goals/BACKLOG.yaml` | The full DAG beyond A0, awaiting Contractor expansion |
| `goals/state.json` | DAG status. Owned by the orchestrator. |
| `goals/evidence/<id>/` | Validator artifacts — the audit trail |

## Argument: `$ARGUMENTS`

Dispatch on the first word.

### (empty) or `status`
Read `goals/state.json` and `goals/BACKLOG.yaml`. Report, as a compact table: current
phase, the gate condition and whether it is met, each node's status, and what is ready to
start right now. Then state the single highest-priority action. Do not dump the files.

### `node <id>`
Read `goals/nodes/<id>.yaml`. Summarise the contracts, the verify block and the
`done_when` entries. Then check the current repository state against each `done_when` and
report which are already satisfied. Do not implement anything.

### `contract <phase|id>`
Invoke the **`gel-contract`** workflow with `{phase: "<phase>"}` or `{nodes: ["<id>"]}`.
This expands backlog entries into full node YAML — contracts and runnable verification
written *before* any code exists. It writes no implementation.

**Requires explicit user opt-in** before launching (it is a multi-agent workflow). If the
user has not clearly asked for the workflow in this session, describe what it would do and
ask first.

### `audit` or `drift`
Invoke the **`gel-audit`** workflow. Eight parallel lenses sweep the repository against
`GOALS.yaml`, `INVARIANTS.yaml` and `DECISIONS.md`; every finding is adversarially
reproduced before it becomes a remediation node. Same opt-in rule as `contract`.

### `why <id>`
Trace a node back to its justification: node → `goal_refs` → the `done_when` entries it
serves → the decisions in `DECISIONS.md` that shaped it. Answers "why are we building
this at all." If the chain breaks, that is goal drift — say so.

## Rules that apply to every invocation

- `DECISIONS.md` is normative. If `GOALS.yaml` and `DECISIONS.md` disagree, `DECISIONS.md`
  wins and `GOALS.yaml` needs a fix — report it.
- Never mark a node `pass` in `state.json` on your own authority. Only a Validator verdict
  backed by evidence in `goals/evidence/<id>/` justifies that transition.
- Never weaken a `done_when` to make a node pass. If a criterion is wrong, change it in
  the node YAML deliberately, with the reason recorded — do not quietly soften it.
- Real PHI never enters context (D25a). Synthetic fixtures only.
