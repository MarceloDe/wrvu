// Locate a real Chromium for the redaction checks.
//
// playwright-core never downloads a browser, so this resolves one that is
// already on the machine: an explicit env override, a Playwright browser cache,
// or an installed Chrome/Chromium. Everything about redaction is a canvas
// operation, so it must be verified in a real browser — never simulated.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_DIRS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  path.join(os.homedir(), ".cache", "ms-playwright"),
].filter(Boolean);

const SYSTEM_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function fromCache(dir) {
  if (!fs.existsSync(dir)) return null;
  const builds = fs
    .readdirSync(dir)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const candidates = [
      path.join(dir, build, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(dir, build, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(dir, build, "chrome-linux", "chrome"),
      path.join(dir, build, "chrome-win", "chrome.exe"),
    ];
    for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveChromium() {
  if (process.env.CHROMIUM_EXECUTABLE && fs.existsSync(process.env.CHROMIUM_EXECUTABLE)) {
    return process.env.CHROMIUM_EXECUTABLE;
  }
  for (const dir of CACHE_DIRS) {
    const found = fromCache(dir);
    if (found) return found;
  }
  for (const candidate of SYSTEM_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  throw new Error(
    "No Chromium found. Install one with `npx playwright install chromium` or set CHROMIUM_EXECUTABLE=/path/to/chrome.",
  );
}
