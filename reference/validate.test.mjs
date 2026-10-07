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

test("out_of_settings_actions accepts documented how-to and confirmation metadata", () => {
  const d = JSON.parse(readFileSync(join(HERE, "..", "examples", "product-examples", "settings-desktop", "ai-instructions.json"), "utf8"));
  d.out_of_settings_actions = [{
    id: "delete-project",
    how_to: "Open the project menu, choose Delete, and confirm in the UI.",
    requires_human_confirmation: true,
    extensions: { "x-vendor": "example" },
  }];
  const r = run(doc("out-of-settings.json", d, "ai-instructions"));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^VALID/);
});

test("out_of_settings_actions enforces its shape and rejects undeclared item fields", () => {
  const action = {
    id: "delete-project",
    how_to: "Use the project menu and confirm in the UI.",
    requires_human_confirmation: true,
  };
  const cases = [
    ["array", action],
    ["object", ["delete-project"]],
    ["id", [{ ...action, id: "" }]],
    ["how_to", [{ ...action, how_to: 42 }]],
    ["requires_human_confirmation", [{ ...action, requires_human_confirmation: "true" }]],
    ["endpoint", [{ ...action, endpoint: "/api/delete" }]],
  ];
  for (const field of Object.keys(action)) {
    const incomplete = { ...action };
    delete incomplete[field];
    cases.push([field, [incomplete]]);
  }
  for (const [expected, value] of cases) {
    const d = { version: "1.0", out_of_settings_actions: value };
    const r = run(doc("bad-out-of-settings.json", d, "ai-instructions"));
    assert.equal(r.code, 1, JSON.stringify(value));
    assert.match(r.stdout, /^INVALID/);
    assert.ok(r.stdout.includes(expected), r.stdout);
  }
});

test("prototype property names cannot bypass strict objects in either schema", () => {
  for (const [kind, base, nested] of [
    ["agents", baseAgents, "agent_card"],
    ["ai-instructions", baseAi, "policy"],
  ]) {
    for (const key of ["constructor", "toString", "__proto__"]) {
      for (const location of [null, nested]) {
        const d = clone(base);
        // JSON parsing creates an own __proto__ property, unlike an object literal.
        Object.defineProperty(location ? d[location] : d, key, {
          value: JSON.parse('{"unexpected": true}'), enumerable: true,
        });
        const r = run(doc("prototype-key.json", d, kind));
        assert.equal(r.code, 1, `${kind} ${location || "$"}.${key}: ${r.stdout}`);
        assert.ok(r.stdout.includes(`additional property '${key}'`), r.stdout);
      }
    }
  }
});

test("prototype property names retain extension and typed-map semantics", () => {
  const d = clone(baseAi);
  d.extensions = JSON.parse('{"constructor": 1, "toString": {}, "__proto__": []}');
  d.priority_selectors = JSON.parse('{"constructor": "#one", "toString": "#two", "__proto__": "#three"}');
  const valid = run(doc("prototype-map.json", d, "ai-instructions"));
  assert.equal(valid.code, 0, valid.stdout + valid.stderr);
  for (const key of Object.keys(d.priority_selectors)) {
    const invalid = clone(d);
    invalid.priority_selectors[key] = 42;
    const r = run(doc("bad-prototype-map.json", invalid, "ai-instructions"));
    assert.equal(r.code, 1, key);
    assert.ok(r.stdout.includes(`$.priority_selectors.${key}: expected string`), r.stdout);
  }
});

test("both --kind forms work before and after the file and override detection", () => {
  for (const [kind, base, otherKind] of [
    ["agents", baseAgents, "ai-instructions"],
    ["ai-instructions", baseAi, "agents"],
  ]) {
    for (const [name, value, expectedCode] of [
      [`${otherKind}-override.json`, base, 0],
      ["ambiguous.json", {}, 1],
    ]) {
      const [file] = doc(name, value, kind);
      for (const args of [
        [file, "--kind", kind], ["--kind", kind, file],
        [file, `--kind=${kind}`], [`--kind=${kind}`, file],
      ]) {
        const r = run(args);
        assert.equal(r.code, expectedCode, `${args}: ${r.stdout} ${r.stderr}`);
        assert.ok(r.stdout.includes(`(kind: ${kind})`), r.stdout);
      }
    }
  }
});

test("missing or invalid --kind values are usage errors even for detectable files", () => {
  const file = join(HERE, "..", "examples", "well-known", "agents.json");
  for (const args of [
    [file, "--kind"], [file, "--kind", "--kind=agents"],
    [file, "--kind="], [file, "--kind", ""],
    [file, "--kind", "unknown"], [file, "--kind=unknown"],
    [file, "--kind", "constructor"], [file, "--kind=__proto__"],
    ["--kind", "agents"], ["--kind=agents"],
  ]) {
    const r = run(args);
    assert.equal(r.code, 2, `${args}: ${r.stdout} ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /cannot load schema/);
  }
});
