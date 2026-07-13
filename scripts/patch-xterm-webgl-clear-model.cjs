#!/usr/bin/env node
/* global process, console */
/**
 * Disable @xterm/addon-webgl cross-terminal texture-atlas sharing for NyaTerm.
 *
 * NyaTerm uses multiple live xterm WebGL instances in split panes. When xterm
 * reuses one TextureAtlas for terminals with the same render configuration,
 * clearing or rebuilding the atlas for one terminal can corrupt glyph rendering
 * in another terminal.
 *
 * Fix: remove the "reuse a matching atlas" loop from the published CJS and ESM
 * bundles, so each terminal creates and owns its own TextureAtlas.
 *
 * This script is intended for:
 *   @xterm/addon-webgl@0.20.0-beta.287
 *
 * It is idempotent and fails fast when the installed package or minified bundle
 * no longer matches the expected version, so dependency upgrades cannot silently
 * reintroduce the issue.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_NAME = "@xterm/addon-webgl";
const EXPECTED_VERSION = "0.20.0-beta.287";
const MARKER = "/*nyaterm:webgl-atlas-isolation*/";

const PACKAGE_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "addon-webgl",
);

const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");

const TARGETS = [
  {
    file: path.join(PACKAGE_DIR, "lib", "addon-webgl.mjs"),
    // @xterm/addon-webgl@0.20.0-beta.287 ESM bundle
    loop:
      "for(let c=0;c<e0.length;c++){let u=e0[c];if(Ee(u.config,h))return u.ownedBy.push(i),u.atlas}",
  },
  {
    file: path.join(PACKAGE_DIR, "lib", "addon-webgl.js"),
    // @xterm/addon-webgl@0.20.0-beta.287 CJS bundle
    loop:
      "for(let e=0;e<a.length;e++){const i=a[e];if((0,r.configEquals)(i.config,c))return i.ownedBy.push(t),i.atlas}",
  },
];

function fail(message) {
  throw new Error(`[patch-xterm-webgl-atlas] ${message}`);
}

function writeFileAtomically(filename, content) {
  const temporary = `${filename}.nyaterm-patch-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filename);
}

if (!fs.existsSync(PACKAGE_JSON)) {
  fail(`${PACKAGE_NAME} is not installed: ${PACKAGE_JSON}`);
}

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
} catch (error) {
  fail(
    `cannot read ${PACKAGE_JSON}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (packageJson.version !== EXPECTED_VERSION) {
  fail(
    `unsupported ${PACKAGE_NAME} version ${JSON.stringify(packageJson.version)}; ` +
      `expected ${EXPECTED_VERSION}. Review and refresh this patch before upgrading.`,
  );
}

let patched = 0;
let already = 0;

for (const { file, loop } of TARGETS) {
  const relative = path.relative(process.cwd(), file);

  if (!fs.existsSync(file)) {
    fail(`runtime bundle not found: ${relative}`);
  }

  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(
      `cannot read ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (source.includes(MARKER)) {
    already += 1;
    continue;
  }

  const occurrences = source.split(loop).length - 1;
  if (occurrences !== 1) {
    fail(
      `expected exactly one atlas-sharing loop in ${relative}, found ${occurrences}. ` +
        "The minified addon bundle may have changed.",
    );
  }

  const patchedSource = source.replace(loop, MARKER);

  if (!patchedSource.includes(MARKER)) {
    fail(`patch verification failed for ${relative}`);
  }

  try {
    writeFileAtomically(file, patchedSource);
  } catch (error) {
    fail(
      `cannot write ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  patched += 1;
}

console.log(
  `[patch-xterm-webgl-atlas] atlas isolation: ` +
    `patched=${patched} already=${already} total=${TARGETS.length}`,
);