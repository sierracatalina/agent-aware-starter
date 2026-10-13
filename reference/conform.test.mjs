/** Tests for reference/conform.mjs. Node >= 20; no dependencies. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conformOrigin, serveAndConform, startFixtureServer } from "./conform.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CLI = fileURLToPath(new URL("./conform.mjs", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "aaa-conform-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const EXAMPLES = {
  site: join(ROOT, "examples", "well-known"),
  settings: join(ROOT, "examples", "product-examples", "settings-desktop"),
  handoff: join(ROOT, "examples", "product-examples", "handoff-site"),
};

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function exampleDoc(profile, name) {
  return JSON.parse(readFileSync(join(EXAMPLES[profile], `${name}.json`), "utf8"));
}

function writeTrio(dir, { ai, agents, llms = "Fixture context\n" }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ai-instructions.json"), JSON.stringify(ai, null, 2));
  writeFileSync(join(dir, "agents.json"), JSON.stringify(agents, null, 2));
  if (llms !== null) writeFileSync(join(dir, "llms.txt"), llms);
}

async function serve(t, routes) {
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    if (!route) { res.writeHead(404); res.end(); return; }
    res.writeHead(route.status ?? 200, { "Content-Type": route.type ?? "application/json" });
    res.end(typeof route.body === "string" || Buffer.isBuffer(route.body) ? route.body : JSON.stringify(route.body));
  });
  await new Promise((fulfill, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", fulfill); });
  t.after(() => new Promise((fulfill) => { server.closeAllConnections(); server.close(fulfill); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function check(result, id) {
  return result.checks.find((entry) => entry.id === id);
}

test("--serve accepts every shipped fixture directory", async () => {
  for (const [profile, expected] of [["site", "ok"], ["settings", "settings_profile"], ["handoff", "settings_profile"]]) {
    const result = await serveAndConform(EXAMPLES[profile]);
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
    assert.equal(result.verdict, "PASS");
    assert.equal(result.handshake, expected);
    assert.equal(result.live, false);
    assert.equal(check(result, "live.publication").ok, true);
    const cli = run(["--serve", EXAMPLES[profile]]);
    assert.equal(cli.code, 0, cli.stderr);
    assert.match(cli.stdout, /^PASS /);
  }
});

test("missing primary AI fails closed", async (t) => {
  const origin = await serve(t, {});
  const result = await conformOrigin(origin, { allowHttpLocal: true });
  assert.equal(result.passed, false);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.handshake, "missing");
});

test("strict schema failures are reported", async () => {
  const dir = join(TMP, "extra-field");
  const ai = exampleDoc("site", "ai-instructions");
  const agents = exampleDoc("site", "agents");
  ai.totally_bogus = true;
  writeTrio(dir, { ai, agents });
  const result = await serveAndConform(dir);
  assert.equal(result.passed, false);
  assert.equal(result.handshake, "invalid");
  assert.equal(check(result, "ai-instructions.schema").ok, false);
  assert.match(check(result, "ai-instructions.schema").detail, /totally_bogus/);
});

test("wrong JSON content type fails even when the body is valid", async (t) => {
  const ai = exampleDoc("site", "ai-instructions");
  const agents = exampleDoc("site", "agents");
  const origin = await serve(t, {
    "/.well-known/ai-instructions.json": { body: ai, type: "text/plain; charset=utf-8" },
    "/.well-known/agents.json": { body: agents, type: "application/json" },
    "/.well-known/llms.txt": { body: "context\n", type: "text/plain; charset=utf-8" },
  });
  const result = await conformOrigin(origin, { allowHttpLocal: true });
  assert.equal(result.passed, false);
  assert.equal(check(result, "ai-instructions.type").ok, false);
  assert.match(check(result, "ai-instructions.type").detail, /text\/plain/);
  assert.equal(check(result, "ai-instructions.schema").ok, true);
});

test("llms.txt without charset=utf-8 fails the prose type check", async (t) => {
  const origin = await serve(t, {
    "/.well-known/ai-instructions.json": { body: exampleDoc("site", "ai-instructions"), type: "application/json" },
    "/.well-known/agents.json": { body: exampleDoc("site", "agents"), type: "application/json" },
    "/.well-known/llms.txt": { body: "context\n", type: "text/plain" },
  });
  const result = await conformOrigin(origin, { allowHttpLocal: true });
  assert.equal(result.passed, false);
  assert.equal(check(result, "context.type").ok, false);
});

test("live:true without last_updated fails publication", async () => {
  const dir = join(TMP, "live-no-date");
  const ai = exampleDoc("handoff", "ai-instructions");
  const agents = exampleDoc("handoff", "agents");
  ai.live = true;
  agents.live = true;
  delete ai.last_updated;
  delete agents.last_updated;
  writeTrio(dir, { ai, agents, llms: readFileSync(join(EXAMPLES.handoff, "llms.txt"), "utf8") });
  const result = await serveAndConform(dir);
  assert.equal(result.passed, false);
  assert.equal(check(result, "live.consistent").ok, true);
  assert.equal(check(result, "live.last_updated").ok, false);
});

test("live:true with last_updated and well-known paths passes on a loopback fixture", async () => {
  const dir = join(TMP, "live-ok");
  const ai = exampleDoc("handoff", "ai-instructions");
  const agents = exampleDoc("handoff", "agents");
  ai.live = true;
  agents.live = true;
  writeTrio(dir, { ai, agents, llms: readFileSync(join(EXAMPLES.handoff, "llms.txt"), "utf8") });
  const result = await serveAndConform(dir);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.equal(result.live, true);
  assert.equal(check(result, "live.last_updated").ok, true);
  assert.equal(check(result, "live.well-known").ok, true);
  assert.match(check(result, "live.transport").detail, /loopback fixture/);
});

test("documents that disagree on live fail consistency", async () => {
  const dir = join(TMP, "live-mismatch");
  const ai = exampleDoc("site", "ai-instructions");
  const agents = exampleDoc("site", "agents");
  ai.live = true;
  agents.live = false;
  writeTrio(dir, { ai, agents });
  const result = await serveAndConform(dir);
  assert.equal(result.passed, false);
  assert.equal(check(result, "live.consistent").ok, false);
});

test("HTTP origins require --allow-http-local", async () => {
  const served = await startFixtureServer(EXAMPLES.site);
  try {
    const refused = await conformOrigin(served.origin);
    assert.equal(refused.passed, false);
    assert.equal(refused.handshake, "fetch_refused");
    const cli = run([served.origin, "--json"]);
    assert.equal(cli.code, 1);
    assert.equal(JSON.parse(cli.stdout).handshake, "fetch_refused");
  } finally {
    await served.close();
  }
});

test("CLI JSON, --serve flag forms, and usage exits", async () => {
  const json = run(["--serve", EXAMPLES.site, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.passed, true);
  assert.equal(payload.verdict, "PASS");
  assert.equal(payload.handshake, "ok");
  const equals = run([`--serve=${EXAMPLES.settings}`, "--json"]);
  assert.equal(equals.code, 0, equals.stderr);
  assert.equal(JSON.parse(equals.stdout).handshake, "settings_profile");
  for (const args of [
    [],
    ["--json"],
    ["--serve"],
    ["--serve", join(TMP, "missing-dir")],
    ["--serve", EXAMPLES.site, "http://127.0.0.1:1"],
    ["not-an-origin"],
    [EXAMPLES.site, "--wat"],
    ["--allow-http-local"],
  ]) {
    const usage = run(args);
    assert.equal(usage.code, 2, `${args}: ${usage.stdout} ${usage.stderr}`);
    assert.match(usage.stderr, /usage:|error:/);
  }
});

test("nested .well-known directories and application/json charset are accepted", async () => {
  const dir = join(TMP, "nested-well-known");
  mkdirSync(join(dir, ".well-known"), { recursive: true });
  cpSync(EXAMPLES.site, join(dir, ".well-known"), { recursive: true });
  const result = await serveAndConform(dir);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
});

test("importing the runner neither fetches nor depends on argv being a file", async () => {
  const code = `
    const { conformOrigin } = await import(${JSON.stringify(new URL("./conform.mjs", import.meta.url).href)});
    console.log(typeof conformOrigin);
  `;
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", code, "not-a-file"], { encoding: "utf8" });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "function\n");
});
