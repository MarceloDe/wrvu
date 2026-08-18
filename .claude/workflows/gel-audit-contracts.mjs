export const meta = {
  name: 'gel-audit-contracts',
  description: 'Audit hand-written node contracts from three independent lenses',
  whenToUse: 'Run after the operator writes node YAML directly (D42). Pass args as {nodes:["N02-real-migrations"]}. Writes nothing; it reports.',
  phases: [
    { title: 'Audit',  detail: 'three lenses per node, each blind to the others' },
    { title: 'Report', detail: 'accept only if every lens accepts' },
  ],
}

const VERDICT = {
  type: 'object',
  required: ['nodeId', 'lens', 'accepted', 'problems'],
  properties: {
    nodeId: { type: 'string' },
    lens: { type: 'string' },
    accepted: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
}

const LAW = `
You are auditing a node contract in the RadRVU Graph-Engineering Loop.

You did NOT write it. The operator did, after two Contractor passes were rejected 0-of-8
with 296 problems between them (see goals/evidence/A1-contract-audit/). Your job is to find
what is still wrong, not to be agreeable because a human wrote it.

Read goals/DECISIONS.md, goals/GOALS.yaml, goals/INVARIANTS.yaml and goals/nodes/_TEMPLATE.yaml.
Check every claim against the repository ON DISK. Quote file and line.

REJECT for any of these:
  - a command that cannot run as written (wrong path, missing script, bad flags)
  - a command that exits 0 when its target is ABSENT — a vacuous pass, itself a defect
  - verify.runtime steps that depend on a shared shell, cwd or variable
  - a redirect into a directory nothing creates
  - a file in evidence: that no command writes
  - prose where a command belongs
  - a done_when that a fresh agent cannot independently re-derive
  - teardown that destroys the evidence a done_when rests on
  - a static assertion that a sibling or successor node is REQUIRED to falsify
  - a production mutation whose audit entry is written only on success
  - a factual claim about the repo that is not true on disk
`

const LENSES = [
  ['runnability', 'Can every verify step actually execute, in the order given, from the stated cwd, with nothing carried between steps? Check each referenced script and package.json entry EXISTS on disk. Name any that do not.'],
  ['non-vacuity',  'For every check: construct the case where the thing it guards is ABSENT or EMPTY. Does it still exit 0? Test the negated greps, the filters, the test runners, the poison branches. This lens is INV-CHECKS-ACTUALLY-RUN.'],
  ['re-derivability', 'You are a hostile fresh agent who does not trust the author. For EACH done_when, can you establish it yourself, after the node completes, using only commands in the block? Does any teardown, merge or deletion remove what you would need? Is any evidence file merely author-written prose?'],
]

phase('Audit')
const nodes = Array.isArray(args?.nodes) ? args.nodes : []
if (!nodes.length) { log('no nodes given'); return { accepted: [], rejected: [] } }
log(`auditing ${nodes.length} node(s) x ${LENSES.length} lenses`)

const results = await pipeline(
  nodes,
  (node) => parallel(LENSES.map(([lens, brief]) => () =>
    agent(`${LAW}\n\nAUDIT goals/nodes/${node}.yaml through the ${lens} lens.\n\n${brief}`,
      { label: `${lens}:${node}`, phase: 'Audit', schema: VERDICT, effort: 'high' })
  )).then(vs => ({ node, verdicts: vs.filter(Boolean) })),
)

phase('Report')
const accepted = [], rejected = []
for (const r of results.filter(Boolean)) {
  const bad = r.verdicts.filter(v => !v.accepted)
  if (!bad.length && r.verdicts.length === LENSES.length) accepted.push(r.node)
  else rejected.push({
    node: r.node,
    lensesRejecting: bad.map(v => v.lens),
    problems: bad.flatMap(v => v.problems.map(p => `[${v.lens}] ${p}`)),
  })
}
log(`accepted ${accepted.length} · rejected ${rejected.length}`)
return { accepted, rejected, next: rejected.length ? 'Fix the listed problems and re-audit.' : 'Contracts accepted. Mark ready in state.json, then gel-build.' }
