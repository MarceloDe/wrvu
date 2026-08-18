export const meta = {
  name: 'gel-build',
  description: 'Graph-Engineering Loop: build and independently validate ready nodes from goals/',
  whenToUse: 'Run to advance the RadRVU node DAG. Pass args as {nodes:["N00a-x"]} to target specific nodes, or omit to let the orchestrator pick every ready node in the current phase.',
  phases: [
    { title: 'Survey',   detail: 'read goals/state.json and select ready nodes' },
    { title: 'Build',    detail: 'one Builder per node, context from context_query only' },
    { title: 'Validate', detail: 'fresh Validator per node, no memory of the build' },
    { title: 'Judge',    detail: 'multi-lens adversarial review of every PASS claim' },
    { title: 'Report',   detail: 'state transitions and evidence paths' },
  ],
}

// ── Contracts ────────────────────────────────────────────────────────────────

const SURVEY = {
  type: 'object',
  required: ['nodes'],
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'file', 'phase', 'invariants'],
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          phase: { type: 'string' },
          touchesProduction: { type: 'boolean' },
          invariants: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const BUILD = {
  type: 'object',
  required: ['nodeId', 'status', 'filesChanged', 'verifyOutput'],
  properties: {
    nodeId: { type: 'string' },
    status: { enum: ['built', 'blocked_external', 'blocked', 'refused'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    verifyOutput: { type: 'string', description: 'verbatim output of every verify command the Builder ran' },
    evidencePaths: { type: 'array', items: { type: 'string' } },
    productionActions: { type: 'array', items: { type: 'string' } },
    unresolved: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT = {
  type: 'object',
  required: ['nodeId', 'verdict', 'reDerived', 'failingCommand'],
  properties: {
    nodeId: { type: 'string' },
    verdict: { enum: ['PASS', 'BLOCKED_EXTERNAL', 'FAIL', 'UNCERTAIN'] },
    reDerived: {
      type: 'array',
      description: 'one entry per done_when, independently re-derived',
      items: {
        type: 'object',
        required: ['claim', 'confirmed', 'how'],
        properties: {
          claim: { type: 'string' },
          confirmed: { type: 'boolean' },
          how: { type: 'string' },
        },
      },
    },
    invariantsChecked: { type: 'array', items: { type: 'string' } },
    failingCommand: { type: 'string', description: 'exact command and output, or empty when PASS' },
    evidencePaths: { type: 'array', items: { type: 'string' } },
  },
}

const JUDGEMENT = {
  type: 'object',
  required: ['nodeId', 'lens', 'refuted', 'reasoning'],
  properties: {
    nodeId: { type: 'string' },
    lens: { type: 'string' },
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
}

// ── Shared preamble ──────────────────────────────────────────────────────────

const LAW = `
You are operating inside the RadRVU Graph-Engineering Loop.

BINDING DOCUMENTS — read these and nothing else about the project:
  goals/DECISIONS.md     the normative decision record
  goals/GOALS.yaml       G1..G12
  goals/INVARIANTS.yaml  INV-* — the full suite applies to every node

NON-NEGOTIABLE:
  - Real PHI never enters your context. Synthetic fixtures only (D25a).
  - Mocks are permitted ONLY in unit tests of pure functions, and never as the evidence a
    done_when rests on (D20).
  - Every dollar and RVU figure comes from resolveValue() (INV-MONEY-ONE-PATH).
  - If you touch production, append to the audit log and record a rollback path
    (INV-PROD-AUDITED). Snapshot to a Neon branch before any production migration.
  - Never disable INV-PARITY or INV-CONTRACT-SYNC to unblock anything.
`

// ── Survey ───────────────────────────────────────────────────────────────────

phase('Survey')

const requested = Array.isArray(args?.nodes) ? args.nodes : null

const survey = await agent(
  `${LAW}

Read goals/state.json, goals/BACKLOG.yaml and the files in goals/nodes/.

${requested
    ? `Return exactly these nodes: ${requested.join(', ')}. If any is not 'ready', say so in its entry.`
    : `Return every node whose status is 'ready' in the CURRENT PHASE ONLY. Respect the phase gate in
       state.json — do not return a node from a later phase even if its dependencies happen to be met.`}

For each, report its id, the path to its YAML, its phase, whether its verify block touches
production, and the invariants it lists.`,
  { label: 'survey', phase: 'Survey', schema: SURVEY },
)

const nodes = survey?.nodes ?? []
if (!nodes.length) {
  log('No ready nodes in the current phase. Either the phase is complete, or a gate is unmet.')
  return { built: [], passed: [], failed: [], note: 'nothing ready' }
}

log(`${nodes.length} ready node(s): ${nodes.map((n) => n.id).join(', ')}`)

// ── Build → Validate → Judge, pipelined ──────────────────────────────────────
// No barrier between stages: node A validates while node B is still building.

const results = await pipeline(
  nodes,

  // Stage 1 — Builder. Context comes from context_query, never the repo.
  (node) =>
    agent(
      `${LAW}

BUILD node ${node.id}.

1. Read ONLY ${node.file}. Do not browse the repository.
2. Load context by running the node's context_query verbatim (it is a codegraph query).
   That result plus the node YAML plus the invariant list is your entire working set.
3. Implement exactly the contracts. Not more — scope beyond the contracts is a drift
   violation and the Drift Auditor will open a remediation node against you.
4. Run every command in verify.runtime and verify.static yourself. Capture verbatim output.
5. Write evidence artifacts to goals/evidence/${node.id}/.
6. Stop. Do not self-certify. A Builder's self-report is never sufficient.

Status semantics — choose precisely:
  'built'            every contract implemented AND every verify command ran and passed.
  'blocked_external' every contract implemented and every RUNNABLE check passes, but named
                     verifications need operator credentials, a deploy, or infrastructure
                     you cannot reach. List each one and the exact command that closes it.
  'blocked'          you could not implement a contract — it is ambiguous, contradictory,
                     or depends on something that does not exist. Say which and why.
  'refused'          implementing it would violate an invariant or the harness rules.

Never guess. 'blocked_external' is not a failure and must not be used to hide one.`,
      { label: `build:${node.id}`, phase: 'Build', schema: BUILD, isolation: 'worktree' },
    ),

  // Stage 2 — Validator. Fresh agent, no memory of how it was built.
  (build, node) => {
    if (build && build.status === 'blocked_external') {
      return { nodeId: node.id, verdict: 'BLOCKED_EXTERNAL', reDerived: [], invariantsChecked: [],
               failingCommand: `Work complete; operator must close: ${(build.unresolved ?? []).join(' | ')}`,
               evidencePaths: build.evidencePaths ?? [] }
    }
    if (!build || build.status !== 'built') {
      return { nodeId: node.id, verdict: 'FAIL', reDerived: [], invariantsChecked: [],
               failingCommand: `Builder returned status=${build?.status ?? 'null'}: ${(build?.unresolved ?? []).join('; ')}`,
               evidencePaths: [] }
    }
    return agent(
      `${LAW}

VALIDATE node ${node.id}. You did not build it and you must not trust whoever did.

1. Read ${node.file} for the contracts and done_when. Read the diff.
2. Re-run EVERY verify command from a clean checkout against REAL infrastructure —
   a real Neon branch, real HTTP against a real preview deployment with a real Clerk
   session, a real simulator where iOS is involved. No substitutes.
3. Run the FULL invariant suite from goals/INVARIANTS.yaml, not only the ones the node lists.
4. Independently RE-DERIVE each done_when. Do not check whether the Builder claimed it —
   establish it yourself, and say exactly how you established it.
5. Inspect goals/evidence/${node.id}/. Missing or stale evidence is a FAIL.

Return PASS only if every done_when is independently confirmed and every invariant holds.
Return UNCERTAIN — not PASS — if you cannot establish something. Uncertainty escalates to
a human; a wrong PASS does not.`,
      { label: `validate:${node.id}`, phase: 'Validate', schema: VERDICT, effort: 'high' },
    )
  },

  // Stage 3 — Adversarial judge panel. Only on PASS claims (D26: quality over cost).
  (verdict, node) => {
    if (!verdict || verdict.verdict !== 'PASS') return { node, verdict, judgements: [] }
    const LENSES = [
      ['correctness',  'Does the implementation actually satisfy the contract, or only the tests written for it?'],
      ['security',     'Does this open, widen, or fail to close an exposure? Check auth, tenancy, secrets, error surfaces.'],
      ['phi-boundary', 'Could any patient identifier reach a cloud table, log, notification, analytics event or LLM prompt via this change?'],
      ['money-path',   'Does any dollar or RVU figure originate anywhere other than resolveValue()?'],
      ['evidence',     'Is the evidence real output from real infrastructure, or is something mocked, stubbed, cached or fabricated?'],
    ]
    return parallel(
      LENSES.map(([lens, question]) => () =>
        agent(
          `${LAW}

REFUTE the PASS verdict on node ${node.id}, through the ${lens} lens.

${question}

Read ${node.file}, the diff, and goals/evidence/${node.id}/. Your job is to find the reason
this should not have passed. Default to refuted=true when you are uncertain — a false
refutation costs one human review; a false PASS ships a defect into a medical application.`,
          { label: `judge:${lens}:${node.id}`, phase: 'Judge', schema: JUDGEMENT, effort: 'high' },
        ),
      ),
    ).then((judgements) => ({ node, verdict, judgements: judgements.filter(Boolean) }))
  },
)

// ── Report ───────────────────────────────────────────────────────────────────

phase('Report')

const settled = results.filter(Boolean)

const passed = []
const failed = []
const blockedExternal = []

for (const r of settled) {
  const node = r.node ?? { id: r.nodeId }
  const verdict = r.verdict ?? r
  const judgements = r.judgements ?? []
  const refutations = judgements.filter((j) => j.refuted)

  if (verdict?.verdict === 'PASS' && refutations.length === 0) {
    passed.push({ id: node.id, evidence: verdict.evidencePaths })
  } else if (verdict?.verdict === 'BLOCKED_EXTERNAL') {
    blockedExternal.push({ id: node.id, operatorMustClose: verdict.failingCommand })
  } else {
    failed.push({
      id: node.id,
      verdict: verdict?.verdict ?? 'FAIL',
      failingCommand: verdict?.failingCommand ?? '',
      refutations: refutations.map((j) => `[${j.lens}] ${j.reasoning}`),
    })
  }
}

log(`PASS ${passed.length} · blocked on operator ${blockedExternal.length} · needs human review ${failed.length}`)

return {
  passed,
  blockedExternal,
  failed,
  humanReviewRequired: failed.length > 0,
  stateUpdate:
    'Set passed nodes to "pass" and unblock their dependents in goals/state.json. ' +
    'Leave failed nodes at their prior status — per D25, only Validator FAIL or ' +
    'UNCERTAIN requires the human, and this is that moment.',
}
