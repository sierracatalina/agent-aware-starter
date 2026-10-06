/**
 * Tests for reference/validate.mjs (task-4).
 *
 * Exercises the CLI end to end: exit codes, VALID/INVALID verdicts, the
 * additionalProperties tightening, and the advisory-only treatment of
 * policy.allow_autonomous_execution.
 *
 * Run: node --test reference/validate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "validate.mjs");
const TMP = join(HERE, ".test-tmp");

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

function doc(name, obj, kind) {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(obj));
  return [p, `--kind=${kind}`];
}

const baseAgents = JSON.parse(readFileSync(join(HERE, "..", "examples", "well-known", "agents.json"), "utf8"));
const baseAi = JSON.parse(
  readFileSync(join(HERE, "..", "examples", "well-known", "ai-instructions.json"), "utf8"),
);
const clone = (o) => JSON.parse(JSON.stringify(o));

test("valid agents.json example passes", () => {
  const r = run([join(HERE, "..", "examples", "well-known", "agents.json")]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^VALID/);
});

test("valid ai-instructions.json example passes", () => {
  const r = run([join(HERE, "..", "examples", "well-known", "ai-instructions.json")]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^VALID/);
});

test("settings-desktop examples pass", () => {
  for (const kind of ["agents", "ai-instructions"]) {
    const r = run([join(HERE, "..", "examples", "product-examples", "settings-desktop", `${kind}.json`)]);
    assert.equal(r.code, 0, `${kind}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /^VALID/);
  }
});

test("undeclared top-level property is rejected", () => {
  const d = clone(baseAgents);
  d.totally_bogus = 1;
  const r = run(doc("bad-prop.json", d, "agents"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^INVALID/);
  assert.match(r.stdout, /totally_bogus/);
});

test("undeclared nested property is rejected", () => {
  const d = clone(baseAgents);
  d.agent_card.sneaky = true;
  const r = run(doc("bad-nested.json", d, "agents"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /sneaky/);
});

test("endpoints[] item missing required field is rejected", () => {
  const d = clone(baseAgents);
  d.endpoints = [{ name: "x", method: "GET" }]; // path missing
  const r = run(doc("bad-endpoint.json", d, "agents"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /path/);
});

test("endpoints[] item with undeclared field is rejected", () => {
  const d = clone(baseAgents);
  d.endpoints = [{ name: "x", path: "/x", method: "GET", wat: 1 }];
  const r = run(doc("bad-endpoint-prop.json", d, "agents"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /wat/);
});

test("ai-instructions missing required version is rejected", () => {
  const d = clone(baseAi);
  delete d.version;
  const r = run(doc("no-version.json", d, "ai-instructions"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /version/);
});

test("wrong primitive type is rejected", () => {
  const d = clone(baseAgents);
  d.live = "yes";
  const r = run(doc("bad-type.json", d, "agents"));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /boolean/);
});

test("single extensions object is accepted for extras", () => {
  const d = clone(baseAgents);
  d.extensions = { "x-vendor": { anything: [1, 2, 3] } };
  const r = run(doc("with-ext.json", d, "agents"));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^VALID/);
});

test("allow_autonomous_execution:true is advisory only, still valid", () => {
  const d = clone(baseAi);
  d.policy.allow_autonomous_execution = true;
  const r = run(doc("flag-true.json", d, "ai-instructions"));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^VALID/);
  assert.match(r.stdout, /ADVISORY/);
  assert.match(r.stdout, /never grants authority/);
});

test("allow_autonomous_execution:false produces no advisory", () => {
  const d = clone(baseAi);
  d.policy.allow_autonomous_execution = false;
  const r = run(doc("flag-false.json", d, "ai-instructions"));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^VALID/);
  assert.doesNotMatch(r.stdout, /ADVISORY/);
});

test("missing file is a usage error", () => {
  const r = run([join(TMP, "does-not-exist.json")]);
  assert.equal(r.code, 2);
});

test("non-JSON input is a usage error", () => {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, "not-json.json");
  writeFileSync(p, "{oops");
  const r = run([p, "--kind=agents"]);
  assert.equal(r.code, 2);
});
