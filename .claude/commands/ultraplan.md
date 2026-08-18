---
description: Plan RadRVU work against the goal registry — grounded, contract-first, no drift
argument-hint: "[a node id, a goal id, a phase, or a free-form task]"
allowed-tools: Read, Bash, Grep, Glob, Write, Edit, Workflow, WebSearch, WebFetch, mcp__codegraph__codegraph_explore
---

# /ultraplan — plan RadRVU work

Produce an implementation plan for: **$ARGUMENTS**

This project has a goal registry. A plan that ignores it is drift, however good it is.

## Before planning — load the contract, not the repo

Read, in this order, and nothing else about the project yet:

1. `goals/DECISIONS.md` — D1–D27. **Normative.** Every constraint below traces here.
2. `goals/GOALS.yaml` — which goal does this work serve? If none, say so and stop.
3. `goals/INVARIANTS.yaml` — the full `INV-*` suite applies, not a subset.
4. `goals/state.json` — what phase are we in, and is the gate met?
5. `goals/BACKLOG.yaml` — does a node already cover this? If so, plan *that node*.

Then load code context with **one `codegraph_explore` call**, not a grep-and-read sweep.
This repo is indexed; codegraph returns verbatim source plus call paths plus blast radius
in a single call. Name the symbols or ask the question directly.

## Standing constraints — these bind every plan

| | |
|---|---|
| **PHI** | Exists only inside the on-device SQLCipher vault. Everything crossing the network is de-identified and joined by an opaque `exam_ref`. Never in a log, a notification, an analytics event, a Clerk payload or an LLM prompt. |
| **Money** | Every dollar and RVU figure comes from `resolveValue()`. No component computes money. |
| **Unpriced** | A code absent from the authoritative CMS version resolves to `unpriced`, is surfaced, and is excluded from totals. Never guessed. |
| **Verification** | Real infrastructure (D20). Real Neon branch, real HTTP against a preview deploy with a real Clerk session, real simulator. Mocks only in pure-function unit tests, never as the evidence a `done_when` rests on. |
| **Clinical** | The product never interprets imaging findings. Non-negotiable — it is the line between a tracker and a regulated device. |
| **Agent context** | Real PHI never enters it (D25a). Synthetic fixtures only. |
| **Production** | Agents may act against production (D25), but every action is audit-logged, every migration is preceded by a Neon branch snapshot, and every node records a rollback path. |
| **Never weaken** | `INV-PARITY` and `INV-CONTRACT-SYNC` may not be disabled to unblock a release. If they are, the architecture has failed. |

## What the plan must contain

1. **Which goal and which `done_when` entries** this work serves. Named, not implied.
2. **The node decomposition** — one contract per node (D24). If a step bundles two
   contracts, split it and say where the seam is.
3. **The contracts**, stated as interfaces: signatures, thrown errors, response shapes.
   Not prose about behaviour.
4. **A runnable `verify.runtime` block per node.** Commands that exist, or that the plan
   also specifies how to create. This is the part most plans skip and it is the part that
   makes the plan real.
5. **The `done_when` entries**, each independently re-derivable by a fresh agent that does
   not trust the builder.
6. **The invariants most at risk**, and how each is checked.
7. **The rollback path** for anything touching production.
8. **What this does NOT do** — the scope boundary, explicitly.

## Output

Write node YAML into `goals/nodes/` following `goals/nodes/_TEMPLATE.yaml`. Study the A0
nodes already there — they are the quality bar for rationale depth and contract precision.

Then update `goals/BACKLOG.yaml` and `goals/state.json` to reflect the new nodes.

## Executing the plan

To build: the **`gel-build`** workflow (Survey → Build → Validate → Judge).
To contract a whole phase first: **`gel-contract`**.
To check for drift afterwards: **`gel-audit`**.

All three are multi-agent workflows and **require explicit user opt-in** before launching.
If the user has not clearly asked for one in this session, describe what it would do and
what it would cost, and ask.
