# Harness pointer — wruvs

You are operating inside `/Users/mfelix/projects/wruvs`.

## Before you do anything

Read these on session start:

- `~/.harness/preferences.yaml` — communication style, risk tolerance, redlines
- `~/.harness/project_index.json` — this project's canonical entry doc, memory namespace, github state
- `~/.harness/computer_policy.json` — allowed/forbidden actions floor

The harness is a **rendered mirror** of `~/cortex/core/*.md`. **Cortex is canonical.** Do not hand-edit the harness — edit Cortex, then run `~/bin/harness-render`.

## Project-specific facts

- **Memory namespace:** `wruvs` (use in cortex-memory MCP calls)
- **Entry doc:** README.md
- **In-flight tracker:** see `~/.harness/project_index.json` → projects.wruvs.in_flight_pointer

## Non-negotiables (from computer_policy.json)

- No bank/brokerage web logins
- No 1Password or personal-vault access
- Any macOS security downgrade is forbidden
- All send/delete/install actions require confirmation (Hermes: Telegram gate)

## When in doubt

Ask the user in chat before taking side-effectful action. Read-only exploration is always fine.
