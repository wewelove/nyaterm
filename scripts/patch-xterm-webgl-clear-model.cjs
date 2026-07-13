"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_NAME = "@xterm/addon-webgl";
const EXPECTED_VERSIONS = new Set([
  "0.20.0-beta.287",
]);

const PATCH_MARKER = "/* nyaterm:xterm-webgl-clear-model */";
const PACKAGE_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "addon-webgl",
);

const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");
const TARGET_FILES = [
  path.join(PACKAGE_DIR, "lib", "addon-webgl.js"),
  path.join(PACKAGE_DIR, "lib", "addon-webgl.mjs"),
];

/*
 * @xterm/addon-webgl@0.20.0-beta.287:
 *
 * TextureAtlas.clearTexture() currently ends with:
 *
 *   this._cacheMap.clear(),
 *   this._cacheMapCombined.clear(),
 *   this._didWarmUp = false;
 *
 * The shared atlas is cleared, but sibling renderers are not told to rebuild
 * their render model. Inject `_requestClearModel = true` before the method exits.
 *
 * This is equivalent to xterm.js PR #6018.
 */
const SEARCH =
  "this._cacheMap.clear(),this._cacheMapCombined.clear(),this._didWarmUp=!1}}_createNewPage(){";

const REPLACEMENT =
  "this._cacheMap.clear(),this._cacheMapCombined.clear(),this._didWarmUp=!1," +
  `${PATCH_MARKER}this._requestClearModel=!0}}_createNewPage(){`;

function fail(message) {
  console.error(`[patch-xterm-webgl-clear-model] ERROR: ${message}`);
  process.exitCode = 1;
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function writeFileAtomically(filename, content) {
  const temporary = `${filename}.nyaterm-patch-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filename);
}

if (!fs.existsSync(PACKAGE_JSON)) {
  fail(`${PACKAGE_NAME} is not installed: ${PACKAGE_JSON}`);
  return;
}

let packageJson;
try {
  packageJson = readJson(PACKAGE_JSON);
} catch (error) {
  fail(
    `cannot read ${PACKAGE_JSON}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  return;
}

if (!EXPECTED_VERSIONS.has(packageJson.version)) {
  fail(
    `unsupported ${PACKAGE_NAME} version ${JSON.stringify(packageJson.version)}; ` +
      `expected one of: ${[...EXPECTED_VERSIONS].join(", ")}. ` +
      "Review whether the upstream fix is already included before updating this script.",
  );
  return;
}

let patched = 0;
let alreadyPatched = 0;

for (const filename of TARGET_FILES) {
  const relative = path.relative(process.cwd(), filename);

  if (!fs.existsSync(filename)) {
    fail(`missing runtime bundle: ${relative}`);
    continue;
  }

  let source;
  try {
    source = fs.readFileSync(filename, "utf8");
  } catch (error) {
    fail(
      `cannot read ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    continue;
  }

  if (source.includes(PATCH_MARKER)) {
    alreadyPatched += 1;
    continue;
  }

  const occurrences = source.split(SEARCH).length - 1;
  if (occurrences !== 1) {
    fail(
      `expected exactly one patch target in ${relative}, found ${occurrences}. ` +
        "The addon bundle may have changed.",
    );
    continue;
  }

  const nextSource = source.replace(SEARCH, REPLACEMENT);

  if (!nextSource.includes(PATCH_MARKER)) {
    fail(`patch verification failed for ${relative}`);
    continue;
  }

  try {
    writeFileAtomically(filename, nextSource);
  } catch (error) {
    fail(
      `cannot write ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    continue;
  }

  patched += 1;
}

if (process.exitCode) {
  console.error(
    `[patch-xterm-webgl-clear-model] failed: patched=${patched}, ` +
      `already=${alreadyPatched}, total=${TARGET_FILES.length}`,
  );
} else {
  console.log(
    `[patch-xterm-webgl-clear-model] success: patched=${patched}, ` +
      `already=${alreadyPatched}, total=${TARGET_FILES.length}`,
  );
}