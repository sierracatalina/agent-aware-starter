/** AAA/0.2 schema evolution and field regressions. Node >= 20; no dependencies. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "reference", "validate.mjs");
const TMP = mkdtempSync(join(tmpdir(), "aaa-schema-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const clone = (value) => structuredClone(value);
const schemas = Object.fromEntries(["agents", "ai-instructions"].map((kind) => [
  kind, read(`schemas/${kind}.schema.json`),
]));
const agents = {
  schema_version: "0.1.0",
  agent_card: {
    name: "Compatibility fixture",
    capabilities: [],
    endpoints: { discovery: "/.well-known/ai-instructions.json", action_root: "none" },
  },
  endpoints: [{ name: "read", path: "/read", method: "GET" }],
};
const action = {
  id: "book-review", how_to: "Open the service page and hand payment to the human.",
  requires_human_confirmation: true,
};
const instructions = {
  version: "0.1.0", policy: {}, discovery: {}, interaction_rules: {}, safety: {},
  settings_actions: [{ id: "privacy" }], settings_anchors: [{ id: "privacy" }],
  out_of_settings_actions: [action],
};
const bases = { agents, "ai-instructions": instructions };
let sequence = 0;
function validate(kind, doc) {
  const file = join(TMP, `${sequence++}.json`);
  writeFileSync(file, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [CLI, file, `--kind=${kind}`], { encoding: "utf8" });
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}
function valid(kind, doc) {
  const result = validate(kind, doc);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /^VALID/);
}
function invalid(kind, doc, field) {
  const result = validate(kind, doc);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /^INVALID/);
  assert.ok(result.output.includes(field), result.output);
}
function get(doc, path) {
  return path.reduce((value, key) => value[key], doc);
}
function set(doc, path, value) {
  get(doc, path.slice(0, -1))[path.at(-1)] = value;
}

// Captured from main d5b6b5b806a6e68a5fe07af320dbc7ded9b31c29, before 0.2.
const frozenHashes = {
  agents: "d2ce277cdc766c34a3e100e847f4e86481a839f120e2b3728a7c2af864181b94",
  "ai-instructions": "67de8a6e5c6903699d0e0c5b174c4a7c6778820c8ddda20b029aa4563dec41c5",
};
for (const [kind, expected] of Object.entries(frozenHashes)) {
  test(`${kind}: frozen 0.1 schema retains exact original bytes`, () => {
    const bytes = readFileSync(join(ROOT, "schemas", "0.1", `${kind}.schema.json`));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  });
}

// Structural proof for the schema subset in 0.1: preserve every existing
// constraint and allow only new properties/annotations or equivalent map syntax.
function assertAdditive(previous, current, path) {
  const annotations = new Set(["$id", "$comment", "title", "description"]);
  const openMap = previous.type === "object" && previous.additionalProperties !== false;
  for (const [key, value] of Object.entries(previous)) {
    if (annotations.has(key)) continue;
    if (key === "properties") {
      for (const [name, schema] of Object.entries(value)) {
        assert.ok(Object.hasOwn(current.properties, name), `${path}.${name} removed`);
        assertAdditive(schema, current.properties[name], `${path}.${name}`);
      }
    } else if (key === "items") {
      assertAdditive(value, current.items, `${path}[]`);
    } else if (key === "additionalProperties" && openMap) {
      assert.equal(current.additionalProperties, false, path);
      assert.deepEqual(current.patternProperties, { "^": value === true ? {} : value }, path);
    } else {
      assert.deepEqual(current[key], value, `${path}: changed ${key}`);
    }
  }
  for (const key of Object.keys(current)) {
    if (Object.hasOwn(previous, key) || annotations.has(key)) continue;
    if (openMap && ["additionalProperties", "patternProperties"].includes(key)) continue;
    assert.fail(`${path}: newly added constraint ${key} might narrow old documents`);
  }
  if (openMap && !Object.hasOwn(previous, "additionalProperties")) {
    assert.equal(current.additionalProperties, false, path);
    assert.deepEqual(current.patternProperties, { "^": {} }, path);
  }
}
for (const kind of Object.keys(schemas)) {
  test(`${kind}: 0.2 changes are additive over every existing 0.1 field`, () => {
    assertAdditive(read(`schemas/0.1/${kind}.schema.json`), schemas[kind], kind);
    assert.equal(schemas[kind].$id, `https://protocol.aaa.example/schemas/0.2.0/${kind}.schema.json`);
  });
  test(`${kind}: every declared object schema explicitly forbids additional properties`, () => {
    let count = 0;
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        count++;
        assert.equal(node.additionalProperties, false, JSON.stringify(node));
      }
      for (const child of Object.values(node)) walk(child);
    }
    walk(schemas[kind]);
    assert.ok(count > 5);
  });
}

const newFields = [
  ["agents", ["protocol"], "AAA/0.2", "string"],
  ["agents", ["last_updated"], "publisher update marker", "string"],
  ["ai-instructions", ["discovery", "full_text"], "/llms-full.txt", "string"],
  ["ai-instructions", ["discovery", "markdown_twin"], "append .md to any /blog/<slug> URL", "string"],
  ["ai-instructions", ["policy", "read_freely"], true, "boolean"],
  ...["name", "service", "href", "price", "duration"].map((name) => [
    "ai-instructions", ["out_of_settings_actions", 0, name],
    { name: "Book review", service: "Review", href: "/services/review", price: "USD 80", duration: "45 minutes" }[name],
    "string",
  ]),
];
for (const [kind, path, value, type] of newFields) {
  const label = `${kind}.${path.join(".")}`;
  test(`${label}: new optional field accepts its documented type`, () => {
    const doc = clone(bases[kind]);
    set(doc, path, value);
    valid(kind, doc);
    set(doc, path, type === "string" ? "" : false);
    valid(kind, doc); // These additions impose no nonempty-string constraints.
  });
  test(`${label}: new field rejects values of the wrong type`, () => {
    for (const wrong of [null, 42, [], {}, type === "string" ? true : "true"]) {
      const doc = clone(bases[kind]);
      set(doc, path, wrong);
      invalid(kind, doc, path.at(-1));
    }
  });
}

for (const kind of Object.keys(bases)) {
  test(`${kind}: AAA/0.1, AAA/0.2, and arbitrary protocol strings remain accepted`, () => {
    for (const protocol of ["AAA/0.1", "AAA/0.2", "custom-protocol/2037+draft", "", "with spaces\nand lines"]) {
      valid(kind, { ...clone(bases[kind]), protocol });
    }
  });
  test(`${kind}: arbitrary nonempty version strings remain accepted`, () => {
    for (const value of ["0.1.0", "1.0", "vendor release main", " ", "not-semver\nnext"]) {
      const doc = clone(bases[kind]);
      doc[kind === "agents" ? "schema_version" : "version"] = value;
      valid(kind, doc);
    }
  });
}
test("existing weakly constrained string and boolean fields are not tightened", () => {
  valid("ai-instructions", {
    version: "legacy", last_updated: "not a date", http_action_api: "anything",
    discovery: { actions: "not a URI %", context: "" },
    settings_actions: [{ id: "old", href: "previously accepted <not a URI>" }],
    out_of_settings_actions: [{ ...action, requires_human_confirmation: false }],
  });
  valid("agents", {
    schema_version: "legacy", agent_card: {
      name: "old", capabilities: [], endpoints: { discovery: "any text", action_root: "any text" },
    },
  });
});

const strictObjects = [
  ...[[], ["agent_card"], ["agent_card", "endpoints"], ["endpoints", 0]].map((path) => ["agents", path]),
  ...[[], ["policy"], ["discovery"], ["interaction_rules"], ["safety"], ["settings_actions", 0],
    ["settings_anchors", 0], ["out_of_settings_actions", 0]].map((path) => ["ai-instructions", path]),
];
for (const [kind, path] of strictObjects) {
  test(`${kind}.${path.join(".") || "$"}: undeclared vendor fields remain rejected`, () => {
    for (const field of ["vendor_field", "constructor", "__proto__", "toString"]) {
      const doc = clone(bases[kind]);
      Object.defineProperty(get(doc, path), field, { value: 1, enumerable: true });
      invalid(kind, doc, `additional property '${field}'`);
    }
  });
  test(`${kind}.${path.join(".") || "$"}: extensions retain every JSON-value map shape`, () => {
    const doc = clone(bases[kind]);
    get(doc, path).extensions = JSON.parse(
      '{"":null,"line\\nbreak":true,"constructor":42,"__proto__":{"x":[1,null,false]},"toString":[],"vendor":"text"}',
    );
    valid(kind, doc);
  });
}
test("parameters retain arbitrary names and unrestricted nested values", () => {
  const doc = clone(agents);
  doc.endpoints[0].parameters = JSON.parse(
    '{"":null,"line\\nbreak":false,"constructor":42,"__proto__":[],"toString":{"type":"object","additionalProperties":true},"vendor":"text"}',
  );
  valid("agents", doc);
});
test("priority_selectors retain arbitrary names, including empty and multiline keys", () => {
  const selectors = JSON.parse('{"":"","line\\nbreak":"#x","constructor":"#a","__proto__":"#b","toString":"#c"}');
  valid("ai-instructions", { version: "0.1", priority_selectors: selectors });
  for (const key of Object.keys(selectors)) {
    const bad = clone(selectors);
    bad[key] = 42;
    invalid("ai-instructions", { version: "0.1", priority_selectors: bad }, "expected string");
  }
});
test("experimental field names are not schema aliases", () => {
  for (const [path, value] of [
    [["actions"], [action]],
    [["safety", "untrusted_regions"], [".reviews"]],
    [["out_of_settings_actions", 0, "how"], "Use checkout"],
    [["markdown_twin"], "/rules.md"],
  ]) {
    const doc = clone(instructions);
    set(doc, path, value);
    invalid("ai-instructions", doc, path.at(-1));
  }
});
test("undeclared card description and endpoint context remain vendor fields", () => {
  for (const [path, value] of [
    [["description"], "Vendor card description"],
    [["agent_card", "endpoints", "context"], "/llms.txt"],
  ]) {
    const doc = clone(agents);
    set(doc, path, value);
    invalid("agents", doc, path.at(-1));
  }
});
test("original out-of-Settings action fields remain required", () => {
  for (const field of ["id", "how_to", "requires_human_confirmation"]) {
    const doc = clone(instructions);
    delete doc.out_of_settings_actions[0][field];
    invalid("ai-instructions", doc, `missing required property '${field}'`);
  }
});

const uriCases = [
  [true, ""], [true, "/services/review"], [true, "services/review"], [true, "./a:b"],
  [true, "../book?slot=1#confirm"], [true, "#booking"], [true, "?service=review"],
  [true, "https://example.com/booking"], [true, "https://user:pass@example.com:443/a%20b?q=/a?b#c/d?e"],
  [true, "//example.com/booking"], [true, "app://settings?id=privacy"], [true, "urn:example:service"],
  [true, "mailto:hello@example.com"], [true, "https://[::1]:8080/book"],
  [true, "https://[2001:db8::1]/"], [true, "https://[v1.future:address]/"],
  [false, "a b"], [false, "/bad%"], [false, "/bad%2"], [false, "/bad%GG"],
  [false, "https://example.com/line\nbreak"], [false, " https://example.com"],
  [false, "https://example.com\\evil"], [false, "https://example.com/<script>"],
  [false, "https://example.com/é"], [false, "1:relative"], [false, "a#b#c"],
  [false, "https://user@@example.com/"], [false, "https://example.com:bad/"],
  [false, "https://[:::]/"], [false, "https://[not-ip]/"], [false, "https://[::1/"],
  [false, "https://[fe80::1%eth0]/"], [false, "https://[fe80::1%25eth0]/"],
  [false, "https://[v1.%20]/"],
];
for (const [accepted, href] of uriCases) {
  test(`new hand-off href ${accepted ? "accepts" : "rejects"} URI reference ${JSON.stringify(href)}`, () => {
    const doc = clone(instructions);
    doc.out_of_settings_actions[0].href = href;
    if (accepted) valid("ai-instructions", doc);
    else invalid("ai-instructions", doc, "uri-reference");
  });
}

function jsonExamples(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonExamples(path) : entry.name.endsWith(".json") ? [path] : [];
  });
}
for (const file of jsonExamples(join(ROOT, "examples"))) {
  test(`all examples, including original AAA/0.1 fixtures, validate: ${file.slice(ROOT.length + 1)}`, () => {
    const result = spawnSync(process.execPath, [CLI, file], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
test("fictional 0.2 hand-off fixture uses human-only payment and canonical field names", () => {
  const base = "examples/product-examples/handoff-site";
  const card = read(`${base}/agents.json`);
  const rules = read(`${base}/ai-instructions.json`);
  assert.equal(card.live, false);
  assert.equal(rules.live, false);
  assert.equal(card.schema_version, "0.2.0");
  assert.equal(rules.version, "0.2.0");
  assert.equal(card.protocol, "AAA/0.2");
  assert.equal(rules.protocol, "AAA/0.2");
  assert.equal(card.agent_card.endpoints.action_root, "none");
  assert.equal(rules.discovery.full_text, "/.well-known/llms.txt");
  assert.equal(rules.discovery.markdown_twin, "/.well-known/llms.txt");
  assert.equal(rules.policy.read_freely, true);
  assert.equal(rules.policy.allow_autonomous_execution, false);
  assert.equal(Object.hasOwn(rules, "actions"), false);
  assert.equal(Object.hasOwn(rules, "markdown_twin"), false);
  for (const item of rules.out_of_settings_actions) {
    assert.equal(item.requires_human_confirmation, true);
    for (const field of ["name", "service", "href", "price", "duration", "how_to"]) {
      assert.equal(typeof item[field], "string");
      assert.ok(item[field].length > 0);
    }
    assert.equal(Object.hasOwn(item, "how"), false);
    assert.match(item.how_to, /human/i);
    assert.match(item.how_to, /payment/i);
  }
  for (const file of ["README.md", "llms.txt"]) {
    const text = readFileSync(join(ROOT, base, file), "utf8");
    assert.match(text, /live: false/);
    assert.match(text, /AAA\/0\.2/);
    assert.match(text, /human/i);
    assert.match(text, /payment/i);
  }
});
