/** End-to-end loopback fixtures plus adversarial DNS/HTTPS transport tests.
 * Node >= 20; no external network, dependencies, or TLS verification bypasses.
 * Run: node --test reference/read.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readOrigin } from "./read.mjs";

const AI_PATH = "/.well-known/ai-instructions.json";
const CARD_PATH = "/.well-known/agents.json";
const CONTEXT_PATH = "/.well-known/llms.txt";
const CLI = fileURLToPath(new URL("./read.mjs", import.meta.url));
const baseAi = () => ({ version: "0.1.0", discovery: { actions: CARD_PATH, context: CONTEXT_PATH } });
const baseAgents = () => ({
  schema_version: "0.1.0",
  agent_card: { name: "Test", capabilities: [], endpoints: { discovery: AI_PATH, action_root: "/api/actions" } },
  endpoints: [{ name: "status", path: "/api/status", method: "GET" }],
});
const body = (value) => typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value);

async function fixture(t, overrides = {}, handler) {
  const requests = [];
  const routes = { [AI_PATH]: baseAi(), [CARD_PATH]: baseAgents(), [CONTEXT_PATH]: "Product context", ...overrides };
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (handler && handler(req, res)) return;
    if (routes[req.url] === undefined || routes[req.url] === null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": req.url.endsWith(".json") ? "application/json" : "text/plain" });
    res.end(body(routes[req.url]));
  });
  await new Promise((fulfill, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", fulfill); });
  t.after(() => new Promise((fulfill) => { server.closeAllConnections(); server.close(fulfill); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
const localRead = (origin, options = {}) => readOrigin(origin, { allowHttpLocal: true, ...options });
function noMap(result, outcome) {
  assert.equal(result.outcome, outcome, JSON.stringify(result));
  assert.equal(result.map, null);
}

/** Mock the public transport boundary, leaving URL/IP/pinning policy real. */
function publicTransport(t, route, resolveAddresses = () => [{ address: "8.8.8.8", family: 4 }]) {
  const lookups = [];
  const connections = [];
  const dnsMock = mock.method(dns, "lookup", (host, options, callback) => {
    lookups.push({ host, options });
    queueMicrotask(() => callback(null, resolveAddresses(host, lookups.length)));
  });
  const httpsMock = mock.method(https, "request", (url, options, callback) => {
    const connection = { url: new URL(url), options };
    connections.push(connection);
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.ifError(error);
      connection.pinned = { address, family };
    });
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const reply = route(new URL(url), connections.length) || {};
      const response = Readable.from([Buffer.from(body(reply.body ?? ""))]);
      response.statusCode = reply.status ?? 200;
      response.headers = reply.headers ?? {};
      callback(response);
    });
    return request;
  });
  t.after(() => { dnsMock.mock.restore(); httpsMock.mock.restore(); });
  return { lookups, connections };
}
const standardReply = (url) => ({ body: url.pathname === AI_PATH ? baseAi() : url.pathname === CARD_PATH ? baseAgents() : "Context" });

test("valid HTTP fixture reads AI, declared agents, then context and selects a declared endpoint", async (t) => {
  const f = await fixture(t);
  const result = await localRead(f.origin, { action: "status" });
  assert.equal(result.outcome, "ok");
  assert.deepEqual(f.requests, [AI_PATH, CARD_PATH, CONTEXT_PATH]);
  assert.deepEqual(result.fetched, f.requests.map((path) => `${f.origin}${path}`));
  assert.equal(result.map.selected_action.id, "status");
  assert.equal(result.map.grants_authority, false);
  assert.deepEqual(result.map.context, { text: "Product context", untrusted: true });
});

test("missing primary AI returns missing without fetching other files or inventing a map", async (t) => {
  const f = await fixture(t, { [AI_PATH]: null });
  noMap(await localRead(f.origin), "missing");
  assert.deepEqual(f.requests, [AI_PATH]);
});

test("missing agents and explicitly declared context each fail closed", async (t) => {
  for (const path of [CARD_PATH, CONTEXT_PATH]) {
    const f = await fixture(t, { [path]: null });
    noMap(await localRead(f.origin), "missing");
  }
});

test("undeclared default context is optional and warns when missing", async (t) => {
  const f = await fixture(t, { [AI_PATH]: { version: "0.1.0" }, [CONTEXT_PATH]: null });
  const result = await localRead(f.origin);
  assert.equal(result.outcome, "ok");
  assert.equal(result.map.context, null);
  assert.match(result.warnings.join(" "), /Optional default llms.txt missing/);
  assert.deepEqual(f.requests, [AI_PATH, CARD_PATH, CONTEXT_PATH]);
});

test("unknown action cannot become a guessed route", async (t) => {
  const f = await fixture(t);
  noMap(await localRead(f.origin, { action: "undeclared-delete" }), "unknown_action");
  assert.deepEqual(f.requests, [AI_PATH, CARD_PATH, CONTEXT_PATH]);
});

test("action_root none selects settings/out-of-settings IDs and never fabricates an HTTP API", async (t) => {
  const ai = { ...baseAi(), settings_actions: [{ id: "privacy", href: "app://settings?id=privacy" }],
    out_of_settings_actions: [{ id: "handoff", how_to: "Ask a person", requires_human_confirmation: true }] };
  const agents = baseAgents();
  agents.agent_card.endpoints.action_root = "none";
  delete agents.endpoints;
  const f = await fixture(t, { [AI_PATH]: ai, [CARD_PATH]: agents });
  for (const action of [undefined, "privacy", "handoff"]) {
    const result = await localRead(f.origin, { action });
    assert.equal(result.outcome, "settings_profile");
    assert.equal(result.map.action_root, "none");
    assert.equal(result.map.selected_action?.id, action);
  }
  noMap(await localRead(f.origin, { action: "hidden" }), "unknown_action");
});

test("lenient recursive unknown-field stripping warns; strict rejects the same document", async (t) => {
  const ai = { ...baseAi(), unknown_root: 1, policy: { read_freely: true, unknown_policy: true },
    settings_actions: [{ id: "privacy", unknown_action: true }],
    priority_selectors: { constructor: "#ok" }, extensions: { arbitrary: { preserved: true } } };
  const agents = baseAgents();
  agents.agent_card.unknown_card = true;
  agents.endpoints[0].unknown_endpoint = true;
  const f = await fixture(t, { [AI_PATH]: ai, [CARD_PATH]: agents });
  const lenient = await localRead(f.origin);
  assert.equal(lenient.outcome, "ok");
  for (const key of ["unknown_root", "unknown_policy", "unknown_action", "unknown_card", "unknown_endpoint"]) {
    assert.match(lenient.warnings.join(" "), new RegExp(key));
    assert.ok(!JSON.stringify(lenient.map).includes(key));
  }
  assert.equal(lenient.map.priority_selectors.constructor, "#ok");
  noMap(await localRead(f.origin, { strict: true }), "invalid");
});

test("leniency never hides wrong types, missing required fields, or invalid typed-map values", async (t) => {
  for (const ai of [{ ...baseAi(), version: 2 }, { policy: { read_freely: true } },
    { ...baseAi(), priority_selectors: { wrong: 7 } }, { ...baseAi(), policy: { read_freely: "yes" } }]) {
    const f = await fixture(t, { [AI_PATH]: ai });
    noMap(await localRead(f.origin), "invalid");
    assert.deepEqual(f.requests, [AI_PATH]);
  }
});

test("prototype-named unknown fields are stripped safely rather than bypassing schemas", async (t) => {
  const ai = JSON.parse(JSON.stringify(baseAi()).slice(0, -1) + ',"__proto__":{"polluted":true},"constructor":{},"toString":7}');
  const f = await fixture(t, { [AI_PATH]: ai });
  const result = await localRead(f.origin);
  assert.equal(result.outcome, "ok");
  assert.equal({}.polluted, undefined);
  assert.equal(result.warnings.filter((warning) => /unknown field/.test(warning)).length, 3);
  noMap(await localRead(f.origin, { strict: true }), "invalid");
});

test("allow_autonomous_execution/read_freely true has no effect on the normalized behavior map", async (t) => {
  const f = await fixture(t, { [AI_PATH]: { ...baseAi(), policy: { allow_autonomous_execution: false, read_freely: false } } });
  const g = await fixture(t, { [AI_PATH]: { ...baseAi(), policy: { allow_autonomous_execution: true, read_freely: true } } });
  const a = await localRead(f.origin);
  const b = await localRead(g.origin);
  assert.equal(a.outcome, "ok");
  assert.equal(b.outcome, "ok");
  assert.deepEqual({ ...a.map, origin: "fixture" }, { ...b.map, origin: "fixture" });
  assert.match(b.warnings.join(" "), /advisory|ADVISORY/);
});

test("restrictions are unioned with local policy and false action flags cannot erase confirmation", async (t) => {
  const ai = { ...baseAi(), policy: { allow_autonomous_execution: true, require_human_approval_for: ["status", "payment"] },
    safety: { prohibit_direct_input_to: ["#secret"], require_human_confirmation_for: ["payment", "handoff"] },
    interaction_rules: { ignore_elements: [".untrusted"] },
    out_of_settings_actions: [{ id: "handoff", how_to: "Ask a person", requires_human_confirmation: false },
      { id: "other", how_to: "Ask a person", requires_human_confirmation: true }] };
  const f = await fixture(t, { [AI_PATH]: ai });
  const result = await localRead(f.origin, { localPolicy: { deny: ["local-deny", "#secret"],
    require_human_confirmation: ["local-confirm", "payment"], ignore_elements: [".local"] } });
  assert.equal(result.outcome, "ok");
  assert.deepEqual(result.map.restrictions.deny, ["local-deny", "#secret"]);
  assert.deepEqual(result.map.restrictions.require_human_confirmation, ["local-confirm", "payment", "status", "handoff", "other"]);
  assert.deepEqual(result.map.restrictions.ignore_elements, [".local", ".untrusted", "[data-agent-untrusted]"]);
  assert.equal(result.map.actions.find((entry) => entry.id === "handoff").requires_human_confirmation, true);
  assert.equal(result.map.actions.find((entry) => entry.id === "status").requires_human_confirmation, true);
});

test("a no-HTTP declaration tightens an inconsistent HTTP action root", async (t) => {
  const f = await fixture(t, { [AI_PATH]: { ...baseAi(), http_action_api: "none" } });
  const result = await localRead(f.origin);
  assert.equal(result.outcome, "settings_profile");
  assert.equal(result.map.action_root, "none");
});

test("malformed JSON at either JSON stage is missing, without a usable map", async (t) => {
  for (const path of [AI_PATH, CARD_PATH]) {
    const f = await fixture(t, { [path]: "{broken" });
    noMap(await localRead(f.origin), "missing");
  }
});

test("declared and streamed bodies above 64 KiB are fetch_refused", async (t) => {
  for (const declared of [true, false]) {
    const f = await fixture(t, {}, (req, res) => {
      if (req.url !== AI_PATH) return false;
      res.writeHead(200, declared ? { "Content-Length": "65537" } : {});
      res.end("x".repeat(65_537));
      return true;
    });
    const result = await localRead(f.origin);
    noMap(result, "fetch_refused");
    assert.match(result.warnings.join(" "), /65536-byte/);
    assert.deepEqual(f.requests, [AI_PATH]);
  }
});

test("a complete body exactly at 64 KiB is accepted", async (t) => {
  const text = JSON.stringify(baseAi());
  const f = await fixture(t, { [AI_PATH]: text + " ".repeat(65_536 - Buffer.byteLength(text)) });
  assert.equal((await localRead(f.origin)).outcome, "ok");
});

test("invalid UTF-8 and compressed bodies fail closed", async (t) => {
  const f = await fixture(t, { [AI_PATH]: Buffer.from([0xff]) });
  noMap(await localRead(f.origin), "missing");
  const g = await fixture(t, {}, (_req, res) => {
    res.writeHead(200, { "Content-Encoding": "gzip" }); res.end("opaque"); return true;
  });
  noMap(await localRead(g.origin), "missing");
});

for (const target of ["https://127.0.0.1/private", "https://10.0.0.1/private", "https://[::1]/private",
  "https://[::ffff:127.0.0.1]/private", "https://2130706433/private", "https://0x7f000001/private"]) {
  test(`redirect to ${target} is refused even in loopback fixture mode`, async (t) => {
    const f = await fixture(t, {}, (_req, res) => {
      res.writeHead(302, { Location: target }); res.end(); return true;
    });
    noMap(await localRead(f.origin, { allowCrossOriginDiscovery: true }), "fetch_refused");
    assert.equal(f.requests.length, 1);
  });
}

test("HTTP redirect back to the same local fixture is never granted the fixture exception", async (t) => {
  const f = await fixture(t, {}, (_req, res) => { res.writeHead(302, { Location: "/other" }); res.end(); return true; });
  noMap(await localRead(f.origin), "fetch_refused");
  assert.equal(f.requests.length, 1);
});

test("production never permits HTTP, and HTTP fixture mode does not admit public/private hosts", async () => {
  for (const origin of ["http://127.0.0.1", "http://localhost", "http://example.com"]) {
    noMap(await readOrigin(origin), "fetch_refused");
  }
  for (const origin of ["http://example.com", "http://10.0.0.1", "http://[fd00::1]"]) {
    noMap(await localRead(origin), "fetch_refused");
  }
});

test("same-origin discovery rejects foreign pointers before connecting", async (t) => {
  const ai = baseAi(); ai.discovery.actions = "https://elsewhere.test/agents.json";
  const f = await fixture(t, { [AI_PATH]: ai });
  noMap(await localRead(f.origin), "fetch_refused");
  assert.deepEqual(f.requests, [AI_PATH]);
});

test("default context cannot use a cross-origin redirect to escape origin restrictions", async (t) => {
  const f = await fixture(t, { [AI_PATH]: { version: "0.1.0" } }, (req, res) => {
    if (req.url !== CONTEXT_PATH) return false;
    res.writeHead(302, { Location: "https://elsewhere.test/context.txt" }); res.end(); return true;
  });
  noMap(await localRead(f.origin), "fetch_refused");
});

test("prose markdown_twin and full_text do not trigger extra requests", async (t) => {
  const ai = baseAi();
  ai.discovery.markdown_twin = "append .md to any /blog/<slug> URL";
  ai.discovery.full_text = "http://169.254.169.254/metadata";
  const f = await fixture(t, { [AI_PATH]: ai });
  assert.equal((await localRead(f.origin)).outcome, "ok");
  assert.deepEqual(f.requests, [AI_PATH, CARD_PATH, CONTEXT_PATH]);
});

test("body timeout is absolute, cannot be extended by trickled bytes, and never retries", async (t) => {
  let interval;
  const f = await fixture(t, {}, (_req, res) => {
    res.writeHead(200); res.write(" ");
    interval = setInterval(() => res.write(" "), 5);
    res.on("close", () => clearInterval(interval));
    return true;
  });
  t.after(() => clearInterval(interval));
  const result = await localRead(f.origin, { timeoutMs: 40 });
  noMap(result, "missing");
  assert.match(result.warnings.join(" "), /time limit/);
  assert.equal(f.requests.length, 1);
});

test("public connections resolve exactly once per hop and pin a checked address without changing TLS identity", async (t) => {
  const transport = publicTransport(t, standardReply, (_host, count) => [{ address: count % 2 ? "8.8.8.8" : "1.1.1.1", family: 4 }]);
  const result = await readOrigin("https://public.test");
  assert.equal(result.outcome, "ok");
  assert.equal(transport.lookups.length, 3);
  assert.equal(transport.connections.length, 3);
  transport.connections.forEach(({ url, options, pinned }, index) => {
    assert.equal(url.hostname, "public.test");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.servername, undefined);
    assert.equal(options.agent, false);
    assert.equal(options.autoSelectFamily, false);
    assert.deepEqual(pinned, { address: index % 2 ? "1.1.1.1" : "8.8.8.8", family: 4 });
    assert.deepEqual(transport.lookups[index].options, { all: true, verbatim: true });
  });
});

test("every DNS answer is checked; mixed public/private or mapped IPv6 answers cannot connect", async (t) => {
  const forbidden = ["0.0.0.0", "10.0.0.1", "100.100.100.200", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "255.255.255.255", "168.63.129.16", "::", "::1", "::ffff:8.8.8.8", "::ffff:127.0.0.1",
    "64:ff9b::a00:1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::", "3fff::1"];
  let answer;
  const transport = publicTransport(t, standardReply, () => [{ address: "8.8.8.8", family: 4 }, answer]);
  for (const address of forbidden) {
    answer = { address, family: address.includes(":") ? 6 : 4 };
    noMap(await readOrigin("https://public.test"), "fetch_refused");
  }
  assert.equal(transport.lookups.length, forbidden.length);
  assert.equal(transport.connections.length, 0);
});

test("public IPv6 addresses are pinned with family six", async (t) => {
  const transport = publicTransport(t, standardReply, () => [{ address: "2606:4700:4700::1111", family: 6 }]);
  assert.equal((await readOrigin("https://public.test")).outcome, "ok");
  assert.equal(transport.connections[0].pinned.family, 6);
});

test("initial public canonical redirect establishes the origin for all discovery", async (t) => {
  const transport = publicTransport(t, (url) => url.hostname === "initial.test"
    ? { status: 301, headers: { location: `https://canonical.test${AI_PATH}` } } : standardReply(url));
  const result = await readOrigin("https://initial.test");
  assert.equal(result.outcome, "ok");
  assert.equal(result.map.origin, "https://canonical.test");
  assert.deepEqual(transport.connections.map(({ url }) => url.hostname), ["initial.test", "canonical.test", "canonical.test", "canonical.test"]);
  assert.equal(transport.lookups.length, 4);
});

test("three redirects are allowed, but a fourth fails without another connection", async (t) => {
  let redirects = 3;
  const transport = publicTransport(t, (url) => {
    const count = Number(url.searchParams.get("hop") || 0);
    if (url.pathname === AI_PATH && count < redirects) {
      return { status: 302, headers: { location: `${AI_PATH}?hop=${count + 1}` } };
    }
    return standardReply(url);
  });
  assert.equal((await readOrigin("https://public.test")).outcome, "ok");
  assert.equal(transport.connections.length, 6);
  redirects = 4;
  const result = await readOrigin("https://public.test");
  noMap(result, "fetch_refused");
  assert.match(result.warnings.join(" "), /More than 3 redirects/);
  assert.equal(transport.connections.length, 10);
  assert.equal(transport.lookups.length, 10);
});

test("discovery redirects require cross-origin opt-in; opt-in still requires public HTTPS", async (t) => {
  let destination = "https://other.test/card.json";
  const transport = publicTransport(t, (url) => url.pathname === CARD_PATH
    ? { status: 302, headers: { location: destination } }
    : url.pathname === "/card.json" ? { body: baseAgents() } : standardReply(url));
  noMap(await readOrigin("https://public.test"), "fetch_refused");
  assert.equal((await readOrigin("https://public.test", { allowCrossOriginDiscovery: true })).outcome, "ok");
  destination = "http://other.test/card.json";
  noMap(await readOrigin("https://public.test", { allowCrossOriginDiscovery: true }), "fetch_refused");
  assert.ok(transport.connections.every(({ url }) => url.protocol === "https:"));
});

test("DNS timeout is part of the total budget and a late answer never starts a connection", async (t) => {
  let callback;
  const dnsMock = mock.method(dns, "lookup", (_host, _options, cb) => { callback = cb; });
  let connections = 0;
  const httpsMock = mock.method(https, "request", () => { connections++; throw new Error("must not connect"); });
  t.after(() => { dnsMock.mock.restore(); httpsMock.mock.restore(); });
  const result = await readOrigin("https://public.test", { timeoutMs: 20 });
  noMap(result, "missing");
  callback(null, [{ address: "8.8.8.8", family: 4 }]);
  await new Promise((fulfill) => setImmediate(fulfill));
  assert.equal(connections, 0);
  noMap(await readOrigin("https://public.test", { timeoutMs: 5001 }), "invalid");
});

async function cli(args) {
  try { const result = await promisify(execFile)(process.execPath, [CLI, ...args]); return { code: 0, ...result }; }
  catch (error) { return { code: error.code, stdout: error.stdout || "", stderr: error.stderr || "" }; }
}

test("CLI emits JSON and uses exit 0/1/2 for success/outcome/usage", async (t) => {
  const f = await fixture(t);
  const good = await cli([f.origin, "--allow-http-local", "--json", "--action", "status"]);
  assert.equal(good.code, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).outcome, "ok");
  const unknown = await cli([f.origin, "--allow-http-local", "--json", "--action", "unknown"]);
  assert.equal(unknown.code, 1);
  assert.equal(JSON.parse(unknown.stdout).outcome, "unknown_action");
  const refused = await cli([f.origin, "--json"]);
  assert.equal(refused.code, 1);
  assert.equal(JSON.parse(refused.stdout).outcome, "fetch_refused");
  for (const args of [[], [f.origin, "--wat"], [f.origin, "--action"], ["not-an-origin"], [f.origin, "extra"]]) {
    const usage = await cli(args);
    assert.equal(usage.code, 2, JSON.stringify(args));
    assert.match(usage.stderr, /usage:/);
  }
});


test("all patternProperties keys retain extensions, parameter maps, and typed selector semantics", async (t) => {
  const keys = ["ordinary", "__proto__", "constructor", "toString", "", "line\nbreak"];
  const arbitrary = Object.fromEntries(keys.map((key) => [key, { nested: [1, true, null, { any: "value" }] }]));
  const selectors = Object.fromEntries(keys.map((key) => [key, "#selector"]));
  const ai = { ...baseAi(), extensions: arbitrary, priority_selectors: selectors,
    policy: { extensions: arbitrary }, settings_actions: [{ id: "settings", extensions: arbitrary }] };
  const agents = baseAgents();
  agents.endpoints[0].parameters = arbitrary;
  agents.endpoints[0].extensions = arbitrary;
  const f = await fixture(t, { [AI_PATH]: ai, [CARD_PATH]: agents });
  for (const strict of [false, true]) {
    const result = await localRead(f.origin, { strict });
    assert.equal(result.outcome, "ok", JSON.stringify(result));
    assert.deepEqual(result.map.priority_selectors, selectors);
    assert.deepEqual(result.map.actions[0].parameters, arbitrary);
    assert.deepEqual(result.map.actions[0].extensions, arbitrary);
    assert.deepEqual(result.map.actions[1].extensions, arbitrary);
    assert.ok(!result.warnings.some((warning) => warning.includes("unknown field")));
  }
  for (const key of keys) {
    const bad = { ...baseAi(), priority_selectors: { [key]: 42 } };
    const g = await fixture(t, { [AI_PATH]: bad });
    noMap(await localRead(g.origin), "invalid");
  }
});

test("duplicate declared action IDs are invalid when selected instead of silently choosing one", async (t) => {
  const ai = { ...baseAi(), settings_actions: [{ id: "status", href: "app://settings?id=status" }] };
  const f = await fixture(t, { [AI_PATH]: ai });
  assert.equal((await localRead(f.origin)).outcome, "ok");
  const result = await localRead(f.origin, { action: "status" });
  noMap(result, "invalid");
  assert.match(result.warnings.join(" "), /ambiguous/);
});
