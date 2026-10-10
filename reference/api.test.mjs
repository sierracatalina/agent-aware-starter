/** Public validation API and unchanged CLI behavior. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateDocument } from "./validate.mjs";

const CLI = fileURLToPath(new URL("./validate.mjs", import.meta.url));

test("validateDocument and CLI use the same engine for all examples", () => {
  for (const directory of ["well-known", "product-examples/settings-desktop", "product-examples/handoff-site"]) {
    for (const kind of ["agents", "ai-instructions"]) {
      const file = fileURLToPath(new URL(`../examples/${directory}/${kind}.json`, import.meta.url));
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const result = validateDocument(doc, kind);
      const cli = spawnSync(process.execPath, [CLI, file], { encoding: "utf8" });
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.equal(cli.status, 0);
      for (const warning of result.warnings) assert.ok(cli.stdout.includes(warning));
    }
  }
});

test("validateDocument returns strict errors without mutating the document", () => {
  const doc = { version: "0.2.0", policy: { read_freely: true, vendor: true }, actions: [] };
  const before = structuredClone(doc);
  const result = validateDocument(doc, "ai-instructions");
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join("\n"), /vendor/);
  assert.match(result.errors.join("\n"), /actions/);
  assert.deepEqual(doc, before);
});

test("validateDocument autonomy warning remains advisory", () => {
  const result = validateDocument({ version: "0.1.0", policy: { allow_autonomous_execution: true } }, "ai-instructions");
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /ADVISORY.*never grants authority/);
});

test("validateDocument rejects unknown and prototype schema-kind names", () => {
  for (const kind of ["unknown", "__proto__", "constructor"]) {
    assert.throws(() => validateDocument({}, kind), TypeError);
  }
});

test("importing the validator neither runs the CLI nor depends on argv being a file", () => {
  const code = `await import(${JSON.stringify(new URL("./validate.mjs", import.meta.url).href)}); console.log("imported");`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, "not-a-file"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "imported\n");
});
