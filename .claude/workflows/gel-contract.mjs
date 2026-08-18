export const meta = {
  name: 'gel-contract',
  description: 'Contractor: expand BACKLOG entries into full node YAML with runnable verify blocks',
  whenToUse: 'Run before building a phase. Pass args as {phase:"A1"} or {nodes:["N04-rls"]}. Writes goals/nodes/*.yaml. No implementation code is written by this workflow.',
  phases: [
    { title: 'Select',   detail: 'pick backlog entries to contract' },
    { title: 'Contract', detail: 'one Contractor per entry — contracts and verify before code' },
    { title: 'Audit',    detail: 'reject any node whose verification is not runnable' },
  ],
}

const SELECTION = {
  type: 'object',
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'goals', 'phase'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          goals: { type: 'array', items: { type: 'string' } },
          phase: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          splitsInto: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
    },
  },
}

const CONTRACTED = {
  type: 'object',
  required: ['nodeId', 'file', 'contracts', 'verifyRuntime', 'doneWhen'],
  properties: {
    nodeId: { type: 'string' },
    file: { type: 'string' },
    contracts: { type: 'array', items: { type: 'string' } },
    verifyRuntime: { type: 'array', items: { type: 'string' } },
    doneWhen: { type: 'array', items: { type: 'string' } },
    invariants: { type: 'array', items: { type: 'string' } },
    estimateHours: { type: 'number' },
    splitRecommended: { type: 'boolean' },
    splitReason: { type: 'string' },
  },
}

const AUDIT = {
  type: 'object',
  required: ['nodeId', 'accepted', 'problems'],
  properties: {
    nodeId: { type: 'string' },
    accepted: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
}

const LAW = `
You are the Contractor in the RadRVU Graph-Engineering Loop.

Read goals/DECISIONS.md, goals/GOALS.yaml, goals/INVARIANTS.yaml and
goals/nodes/_TEMPLATE.yaml. Study the fully-contracted A0 nodes in goals/nodes/ as the
quality bar — they show the expected depth of rationale, contract precision and
verification.

YOUR JOB IS TO WRITE ACCEPTANCE CRITERIA BEFORE ANY CODE EXISTS. You write no
implementation. You write the contract the Builder must meet and the verification the
Validator will independently re-derive.

HARD RULES:
  - A node with no runnable verify.runtime block is REJECTED. "It compiles" is not
    verification. "Tests pass" is not verification unless you name the tests.
  - Every verify command must run against REAL infrastructure (D20): a real Neon branch,
    real HTTP against a preview deployment, a real simulator. Mocks only in pure-function
    unit tests, and never as the evidence a done_when rests on.
  - Every done_when must be independently re-derivable by a fresh agent that does not
    trust the Builder. "The feature works" is not re-derivable. "curl X returns 404" is.
  - One contract per node (D24). If the entry bundles two contracts, set
    splitRecommended and say precisely where the seam is.
  - Any node touching production needs a rollback stanza (INV-PROD-AUDITED).
  - PHI-adjacent nodes verify against SYNTHETIC fixtures only (D25a).
`

phase('Select')

const scope = args?.phase ? `phase ${args.phase}` : `nodes ${(args?.nodes ?? []).join(', ')}`

const selection = await agent(
  `${LAW}

Read goals/BACKLOG.yaml and goals/state.json. Select the backlog entries for ${scope}.

Expand every splits_into member into its own entry — those are the real nodes. Return the
leaf entries only, never a parent that has children. Order them so dependencies come first.`,
  { label: 'select', phase: 'Select', schema: SELECTION },
)

const entries = selection?.entries ?? []
if (!entries.length) {
  log(`No backlog entries matched ${scope}.`)
  return { contracted: [], note: 'nothing selected' }
}

log(`Contracting ${entries.length} node(s) for ${scope}`)

phase('Contract')

const contracted = await pipeline(
  entries,

  (entry) =>
    agent(
      `${LAW}

CONTRACT node ${entry.id} — "${entry.title}".
Goals: ${entry.goals.join(', ')}. Phase: ${entry.phase}.
Depends on: ${(entry.dependsOn ?? []).join(', ') || 'nothing'}.
Backlog notes: ${entry.notes ?? '(none)'}

1. Run a codegraph query to understand the current shape of what this node changes. Record
   the query you used — it becomes the node's context_query, and it is the ONLY context
   the Builder will load.
2. Write goals/nodes/${entry.id}.yaml following _TEMPLATE.yaml exactly.
3. State the contracts as interfaces — signatures, thrown errors, response shapes — not as
   prose descriptions of behaviour.
4. Write a verify.runtime block of commands that actually exist or that you also specify
   how to create. Name the evidence artifacts.
5. Write done_when entries a hostile fresh agent could confirm without trusting anyone.
6. Write the rationale: what is wrong today, grounded in specific files and line numbers.

Write the file. Return what you wrote.`,
      { label: `contract:${entry.id}`, phase: 'Contract', schema: CONTRACTED, effort: 'high' },
    ),

  (node, entry) => {
    if (!node) return { nodeId: entry.id, accepted: false, problems: ['Contractor returned nothing'] }
    return agent(
      `${LAW}

AUDIT the node contract at ${node.file}. You are not the author.

REJECT it if any of the following is true:
  - verify.runtime is empty, or contains a command that cannot actually be run
  - any verify step depends on a mock where real infrastructure is required by D20
  - any done_when cannot be independently re-derived without trusting the Builder
  - the node bundles more than one contract (D24) and does not say so
  - it touches production and has no rollback stanza
  - it is PHI-adjacent and does not specify synthetic fixtures
  - the contracts are prose descriptions rather than interfaces
  - context_query is missing, or is broad enough that the Builder would effectively load the repo

List every problem specifically. Accept only a node you would be willing to validate against.`,
      { label: `audit:${entry.id}`, phase: 'Audit', schema: AUDIT, effort: 'high' },
    ).then((audit) => ({ ...audit, file: node.file, splitRecommended: node.splitRecommended, splitReason: node.splitReason }))
  },
)

phase('Audit')

const settled = contracted.filter(Boolean)
const accepted = settled.filter((a) => a.accepted)
const rejected = settled.filter((a) => !a.accepted)
const splits = settled.filter((a) => a.splitRecommended)

log(`accepted ${accepted.length} · rejected ${rejected.length} · split recommended ${splits.length}`)

return {
  accepted: accepted.map((a) => ({ id: a.nodeId, file: a.file })),
  rejected: rejected.map((a) => ({ id: a.nodeId, problems: a.problems })),
  splitsRecommended: splits.map((a) => ({ id: a.nodeId, reason: a.splitReason })),
  next:
    rejected.length
      ? 'Re-run gel-contract for the rejected ids after addressing the listed problems.'
      : 'Contracts accepted. Update goals/state.json to mark these ready, then run gel-build.',
}
