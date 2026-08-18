// Bundle the real component tree for the browser-side redaction checks.

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function buildHarnessBundle(entry = path.join(HERE, "entry.jsx")) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    loader: { ".js": "jsx", ".jsx": "jsx" },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

export const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>N00f redaction e2e</title>
<style>body{margin:0;font-family:system-ui} .hidden{display:none}</style>
</head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
