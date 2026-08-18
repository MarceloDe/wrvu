export const meta = {
  name: 'gel-audit',
  description: 'Drift Auditor: diff the repo against GOALS and INVARIANTS, open remediation nodes',
  whenToUse: 'Run periodically, after each phase and before any release. Finds invariant violations, goal drift, and scope that no goal claims. Writes remediation entries to goals/BACKLOG.yaml.',
  phases: [
    { title: 'Sweep',     detail: 'multi-modal parallel audit across distinct lenses' },
    { title: 'Verify',    detail: 'adversarially confirm each finding before it becomes a node' },
    { title: 'Remediate', detail: 'open remediation backlog entries for confirmed findings' },
  ],
}

const FINDINGS = {
  type: 'object',
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'summary', 'file', 'evidence', 'severity'],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          evidence: { type: 'string', description: 'command output or exact source proving it' },
          severity: { enum: ['blocking', 'major', 'minor', 'advisory'] },
          violates: { type: 'array', items: { type: 'string' } },
          goalDrift: { type: 'boolean', description: 'true when this is scope no goal claims' },
        },
      },
    },
  },
}

const CONFIRMATION = {
  type: 'object',
  required: ['id', 'confirmed', 'reasoning'],
  properties: {
    id: { type: 'string' },
    confirmed: { type: 'boolean' },
    reasoning: { type: 'string' },
    correctedSeverity: { enum: ['blocking', 'major', 'minor', 'advisory'] },
  },
}

const LAW = `
You are the Drift Auditor in the RadRVU Graph-Engineering Loop.

Read goals/DECISIONS.md, goals/GOALS.yaml and goals/INVARIANTS.yaml. These are the
contract. The repository is the claim. Your job is to find where they disagree.

You report. You do not fix. A finding becomes a remediation node, not a commit.

Ground every finding in a specific file, a specific line, and either command output or
verbatim source. A finding you cannot evidence is not a finding.
`

// Distinct lenses — each blind to what the others surface (multi-modal sweep).
const LENSES = [
  ['invariants',
   `Run every machine check in goals/INVARIANTS.yaml. Report each failure. Also report any
    invariant whose check script does not exist or does not actually test what the rule says.`],

  ['goal-coverage',
   `For every goal G1..G12, for every done_when entry: does the repository satisfy it right
    now? Report the unmet ones. Do not report "not built yet" for nodes that have not started —
    report done_when entries that a COMPLETED node was supposed to satisfy and does not.`],

  ['goal-drift',
   `Find code, tables, routes and dependencies that NO goal claims. Scope nobody asked for is
    drift and costs maintenance forever. Set goalDrift=true on these. Note that the repo has a
    known history here: a dead 'users' table, and a correct /api/rvu-tables that nobody calls.`],

  ['money-path',
   `Trace every dollar and every RVU figure the user can see, back to its origin. Any that does
    not come from resolveValue() violates INV-MONEY-ONE-PATH. Check components, routes, jobs and
    prompt builders. Also check for surviving estimate flags (INV-NO-ESTIMATES).`],

  ['phi-boundary',
   `Trace every path a patient identifier could take out of the device vault: cloud columns, log
    lines, notification payloads, analytics events, crash reports, LLM prompts, Clerk metadata.
    Check INV-NO-PHI-IN-CLOUD and INV-CLERK-PHI-FREE. Include the §1.8 timestamp precision issue —
    any date more specific than the year is an identifier under Safe Harbor.`],

  ['decision-fidelity',
   `Read goals/DECISIONS.md D1-D27. For each decision, find where the repository contradicts it.
    Specifically check: no LinkedIn adapter (D21a), no k-anonymity or peer-cohort machinery (D21),
    no APNs or cloud follow_ups (D23), no billing (D1), no web_search (D8).`],

  ['error-honesty',
   `Find every place a failure can be mistaken for a success: swallowed catches, 2xx on failed
    writes, raw driver text in responses, missing correlation ids. INV-NO-SWALLOW,
    INV-NO-RAW-ERRORS.`],

  ['verification-integrity',
   `Audit the verification itself. Find verify blocks whose commands do not exist, tests that
    assert nothing, mocks standing in for real infrastructure where D20 forbids it, evidence
    files that are stale or fabricated, and any place INV-PARITY or INV-CONTRACT-SYNC has been
    weakened or skipped. This lens matters most — everything else trusts it.`],
]

phase('Sweep')
log(`Sweeping ${LENSES.length} lenses`)

const swept = await pipeline(
  LENSES,

  ([lens, brief]) =>
    agent(`${LAW}\n\nAUDIT LENS: ${lens}\n\n${brief}`,
      { label: `sweep:${lens}`, phase: 'Sweep', schema: FINDINGS, effort: 'high' }),

  // Adversarially confirm each finding as soon as its lens returns — no barrier.
  (result) => {
    if (!result?.findings?.length) return []
    return parallel(
      result.findings.map((f) => () =>
        agent(
          `${LAW}

REFUTE this audit finding. Default to confirmed=false if you cannot independently reproduce it.

  id:       ${f.id}
  lens:     ${result.lens}
  summary:  ${f.summary}
  location: ${f.file}${f.line ? `:${f.line}` : ''}
  violates: ${(f.violates ?? []).join(', ') || '(none stated)'}
  evidence claimed: ${f.evidence}

Reproduce it yourself. Read the actual file. Run the actual command. A finding that cannot
be reproduced wastes a remediation node and erodes trust in this audit — which is worse
than missing it. If it reproduces but the severity is wrong, confirm it and correct the severity.`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: CONFIRMATION, effort: 'high' },
        ).then((c) => ({ ...f, lens: result.lens, ...c })),
      ),
    )
  },
)

phase('Remediate')

const all = swept.flat().filter(Boolean)
const confirmed = all.filter((f) => f.confirmed)
const dropped = all.length - confirmed.length

const rank = { blocking: 0, major: 1, minor: 2, advisory: 3 }
confirmed.sort((a, b) => rank[a.correctedSeverity ?? a.severity] - rank[b.correctedSeverity ?? b.severity])

log(`${confirmed.length} confirmed · ${dropped} refuted and dropped`)

if (confirmed.length) {
  await agent(
    `${LAW}

Open remediation entries in goals/BACKLOG.yaml for these confirmed findings. One entry per
finding, in the phase where it belongs, with the violated invariant recorded and the
evidence quoted. Do not fix anything. Do not touch implementation files.

Findings:
${JSON.stringify(confirmed, null, 2)}`,
    { label: 'remediate', phase: 'Remediate' },
  )
}

return {
  confirmed: confirmed.map((f) => ({
    id: f.id,
    severity: f.correctedSeverity ?? f.severity,
    lens: f.lens,
    summary: f.summary,
    at: `${f.file}${f.line ? `:${f.line}` : ''}`,
    violates: f.violates ?? [],
    goalDrift: !!f.goalDrift,
  })),
  refutedCount: dropped,
  blocking: confirmed.filter((f) => (f.correctedSeverity ?? f.severity) === 'blocking').length,
  next: 'Run gel-contract on the new remediation entries, then gel-build.',
}
