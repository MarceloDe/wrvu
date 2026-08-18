#!/usr/bin/env node
/**
 * N00f + N00c — "no attachment reaches /api/claude without passing through
 * lib/redact".
 *
 * A source-level proof rather than a convention. Parses every app/component/lib
 * source file with the TypeScript compiler AST and asserts:
 *
 *   1. The only place an Anthropic image content block is constructed is
 *      lib/redact/ (redactImageBlock).
 *   2. redactImageBlock is called only from lib/redact/.
 *   3. There is exactly one fetch("/api/claude") in the codebase, and it lives
 *      inside callClaude().
 *   4. callClaude() calls assertApprovedAttachments(attachments) BEFORE that
 *      fetch, and imports it from lib/redact/imageRedactor.
 *   4b. assertApprovedAttachments itself still delegates to
 *      assertNoUnredactedImages — the N00f guard is not bypassed, it is wrapped.
 *   5. Every callClaude() call site names a STRING template id and every element
 *      of its `attachments` array has provable provenance: a value produced by
 *      buildRedactedImageBlock / buildDocumentAttachment / prepareDoc.
 *   6. prepareDoc bypasses redaction only through buildDocumentAttachment (which
 *      admits application/pdf and nothing else), and routes every other file
 *      through buildRedactedImageBlock.
 *
 * Exit 0 = no bypass exists. Exit 1 = a path was found; the message names it.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const SCAN_DIRS = ["app", "components", "lib"];
const REDACT_DIR = path.join("lib", "redact");
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs"]);
const ALLOWED_IMAGE_PRODUCERS = new Set([
  "buildRedactedImageBlock",
  "buildDocumentAttachment",
  "prepareDoc",
]);

const failures = [];
const notes = [];

function fail(file, line, message) {
  failures.push(`${file}:${line} — ${message}`);
}

function listSources(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(rel));
    else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

const files = SCAN_DIRS.flatMap(listSources).sort();
if (!files.length) {
  console.error("no-unredacted-path: found no source files to scan");
  process.exit(1);
}

const parsed = new Map();
for (const rel of files) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  // .jsx is parsed as .tsx so JSX is understood; TS syntax parses natively.
  const scriptKind = rel.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  parsed.set(rel, ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind));
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isRedactModule = (rel) => rel.startsWith(REDACT_DIR + path.sep) || rel.startsWith(REDACT_DIR + "/");

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function propValue(objectLiteral, name) {
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (key === name) return prop.initializer;
  }
  return null;
}

const stringOf = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/* ---- 1 & 2: who may build an image block, who may call redactImageBlock ---- */
for (const [rel, sf] of parsed) {
  walk(sf, (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const type = stringOf(propValue(node, "type"));
      const source = propValue(node, "source");
      if (!source) return;
      const mediaType = ts.isObjectLiteralExpression(source) ? stringOf(propValue(source, "media_type")) : null;
      const isImageBlock = type === "image" || (type === "document" && mediaType && mediaType.startsWith("image/"));
      if (isImageBlock && !isRedactModule(rel)) {
        fail(rel, lineOf(sf, node), "constructs an image content block outside lib/redact/ — every image must come from redactImage()");
      }
      if (isImageBlock && isRedactModule(rel)) {
        notes.push(`${rel}:${lineOf(sf, node)} image block produced inside lib/redact/ (allowed)`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "redactImageBlock" && !isRedactModule(rel)) {
      fail(rel, lineOf(sf, node), "calls redactImageBlock outside lib/redact/");
    }
  });
}

/* ---- 3 & 4: the single network boundary and its guard ---- */
const claudeFetches = [];
for (const [rel, sf] of parsed) {
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const isFetch = ts.isIdentifier(callee) && callee.text === "fetch";
    if (!isFetch) return;
    const url = stringOf(node.arguments[0]);
    if (url && url.includes("/api/claude")) claudeFetches.push({ rel, sf, node });
  });
}
if (claudeFetches.length !== 1) {
  failures.push(`expected exactly one fetch("/api/claude"); found ${claudeFetches.length}`);
}

for (const hit of claudeFetches) {
  let fn = hit.node.parent;
  while (fn && !(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))) fn = fn.parent;
  const name = fn && fn.name && ts.isIdentifier(fn.name) ? fn.name.text : "(anonymous)";
  if (name !== "callClaude") {
    fail(hit.rel, lineOf(hit.sf, hit.node), `fetch("/api/claude") lives in ${name}, not callClaude`);
    continue;
  }
  let guardPos = -1;
  walk(fn, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "assertApprovedAttachments") {
      guardPos = node.getStart(hit.sf);
    }
  });
  if (guardPos === -1) {
    fail(hit.rel, lineOf(hit.sf, hit.node), "callClaude does not call assertApprovedAttachments");
  } else if (guardPos > hit.node.getStart(hit.sf)) {
    fail(hit.rel, lineOf(hit.sf, hit.node), "assertApprovedAttachments runs AFTER the fetch");
  } else {
    notes.push(`${hit.rel}:${lineOf(hit.sf, hit.node)} guarded by assertApprovedAttachments before the request`);
  }

  let imported = false;
  walk(hit.sf, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    const from = stringOf(node.moduleSpecifier) || "";
    if (!from.includes("redact/imageRedactor")) return;
    const bindings = node.importClause && node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (el.name.text === "assertApprovedAttachments") imported = true;
    }
  });
  if (!imported) fail(hit.rel, 1, "assertApprovedAttachments is not imported from lib/redact/imageRedactor");
}

/* ---- 4b: the new gate wraps the N00f gate, it does not replace it ---- */
{
  const rel = path.join("lib", "redact", "imageRedactor.ts");
  const sf = parsed.get(rel);
  if (!sf) {
    failures.push(`${rel} was not scanned — the guard module is missing`);
  } else {
    let found = null;
    let delegates = false;
    walk(sf, (node) => {
      if (!ts.isFunctionDeclaration(node) || !node.name || node.name.text !== "assertApprovedAttachments") return;
      found = node;
      walk(node, (inner) => {
        if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "assertNoUnredactedImages") {
          delegates = true;
        }
      });
    });
    if (!found) failures.push(`${rel} does not define assertApprovedAttachments`);
    else if (!delegates) fail(rel, lineOf(sf, found), "assertApprovedAttachments no longer delegates to assertNoUnredactedImages");
    else notes.push(`${rel}:${lineOf(sf, found)} assertApprovedAttachments delegates to assertNoUnredactedImages`);
  }
}

/* ---- 5: provenance of every callClaude() content block ---- */
function enclosingFunction(node) {
  let fn = node.parent;
  while (fn && !(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn) || ts.isSourceFile(fn))) fn = fn.parent;
  return fn;
}

/** Does this expression (or the local binding it names) come from an allowed producer? */
function provenance(expr, scope, sf) {
  if (!expr) return { ok: false, why: "empty content element" };
  if (ts.isSpreadElement(expr)) return provenance(expr.expression, scope, sf);
  if (ts.isObjectLiteralExpression(expr)) {
    const type = stringOf(propValue(expr, "type"));
    if (type === "text") return { ok: true, why: "text block" };
    return { ok: false, why: `inline ${type || "unknown"} block` };
  }
  if (ts.isCallExpression(expr)) {
    const callee = ts.isIdentifier(expr.expression) ? expr.expression.text : null;
    if (callee && ALLOWED_IMAGE_PRODUCERS.has(callee)) return { ok: true, why: `${callee}()` };
    return { ok: false, why: `call to ${callee || "expression"}()` };
  }
  if (ts.isAwaitExpression(expr)) return provenance(expr.expression, scope, sf);
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    let verdict = null;
    walk(scope, (node) => {
      const initializers = [];
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        initializers.push(node.initializer);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) && node.left.text === name) {
        initializers.push(node.right);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) && node.expression.expression.text === name &&
          node.expression.name.text === "push") {
        initializers.push(...node.arguments);
      }
      for (const init of initializers) {
        if (ts.isArrayLiteralExpression(init) && init.elements.length === 0) continue; // `let x = []`
        const inner = provenance(init, scope, sf);
        if (!inner.ok) verdict = verdict || { ok: false, why: `${name} <- ${inner.why}` };
        else if (!verdict) verdict = { ok: true, why: `${name} <- ${inner.why}` };
      }
    });
    return verdict || { ok: false, why: `${name} has no traceable producer in this scope` };
  }
  return { ok: false, why: `unsupported expression ${ts.SyntaxKind[expr.kind]}` };
}

let callSites = 0;
for (const [rel, sf] of parsed) {
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!(ts.isIdentifier(node.expression) && node.expression.text === "callClaude")) return;
    callSites += 1;
    const line = lineOf(sf, node);

    // N00c: arg 0 is a template id chosen from the SERVER registry, never a
    // prompt and never a messages array.
    const templateArg = node.arguments[0];
    const templateId = stringOf(templateArg);
    if (!templateId) {
      fail(rel, line, "callClaude's first argument is not a literal template id — the prompt would not be server-owned");
      return;
    }
    notes.push(`${rel}:${line} template "${templateId}"`);

    const options = node.arguments[1];
    if (!options) {
      notes.push(`${rel}:${line} no attachments`);
      return;
    }
    if (!ts.isObjectLiteralExpression(options)) {
      fail(rel, line, "callClaude's options argument is not an object literal — provenance cannot be proven");
      return;
    }
    for (const prop of options.properties) {
      const key = ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ? prop.name.text
        : null;
      if (key !== "params" && key !== "attachments") {
        fail(rel, line, `callClaude option "${key || "?"}" is not part of the (template, {params, attachments}) contract`);
      }
    }
    const attachments = propValue(options, "attachments");
    if (!attachments) {
      notes.push(`${rel}:${line} no attachments`);
      return;
    }
    const scope = enclosingFunction(node) || sf;
    if (ts.isArrayLiteralExpression(attachments)) {
      for (const element of attachments.elements) {
        const verdict = provenance(element, scope, sf);
        if (!verdict.ok) fail(rel, line, `attachment with unprovable provenance: ${verdict.why}`);
        else notes.push(`${rel}:${line} attachment ok (${verdict.why})`);
      }
    } else {
      const verdict = provenance(attachments, scope, sf);
      if (!verdict.ok) fail(rel, line, `attachment list with unprovable provenance: ${verdict.why}`);
      else notes.push(`${rel}:${line} attachment list ok (${verdict.why})`);
    }
  });
}
if (!callSites) failures.push("found no callClaude() call sites — the scanner is not seeing the upload path");

/* ---- 6: prepareDoc bypasses redaction only through the PDF producer ---- */
let sawPrepareDoc = false;
for (const [rel, sf] of parsed) {
  walk(sf, (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || node.name.text !== "prepareDoc") return;
    sawPrepareDoc = true;
    let sawPdfProducer = false;
    let sawRedactedFallthrough = false;
    walk(node, (inner) => {
      if (ts.isObjectLiteralExpression(inner) && propValue(inner, "source")) {
        fail(rel, lineOf(sf, inner), "prepareDoc builds a content block itself — every attachment must come from lib/redact/");
      }
      if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
        if (inner.expression.text === "buildDocumentAttachment") sawPdfProducer = true;
        if (inner.expression.text === "buildRedactedImageBlock") sawRedactedFallthrough = true;
      }
    });
    if (!sawPdfProducer) fail(rel, lineOf(sf, node), "prepareDoc no longer routes PDFs through buildDocumentAttachment");
    if (!sawRedactedFallthrough) fail(rel, lineOf(sf, node), "prepareDoc does not route non-PDF files through buildRedactedImageBlock");
  });
}
if (!sawPrepareDoc) failures.push("found no prepareDoc() — the report-upload path is not being checked");

const report = {
  check: "no-unredacted-path",
  scannedFiles: files.length,
  callClaudeCallSites: callSites,
  claudeFetchSites: claudeFetches.length,
  failures,
  notes,
};
const asJson = process.argv.includes("--json");
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`no-unredacted-path: scanned ${files.length} files, ${callSites} callClaude call site(s), ${claudeFetches.length} /api/claude fetch site(s)`);
  for (const note of notes) console.log(`  ok   ${note}`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
}
process.exit(failures.length ? 1 : 0);
