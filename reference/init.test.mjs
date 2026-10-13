/** Tests for reference/init.mjs. Node >= 20; no dependencies. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldProfile } from "./init.mjs";
import { validateDocument } from "./validate.mjs";

const CLI = fileURLToPath(new URL("./init.mjs", import.meta.url));
const VALIDATE = fileURLToPath(new URL("./validate.mjs", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "aaa-init-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readTrio(dir) {
  return {
    agents: JSON.parse(readFileSync(join(dir, "agents.json"), "utf8")),
    ai: JSON.parse(readFileSync(join(dir, "ai-instructions.json"), "utf8")),
    llms: readFileSync(join(dir, "llms.txt"), "utf8"),
  };
}

test("site, settings, and handoff scaffolds write valid live:false well-known trios", () => {
  for (const profile of ["site", "settings", "handoff"]) {
    const result = scaffoldProfile(profile, { lastUpdated: "2026-10-13" });
    assert.equal(result.profile, profile);
    assert.equal(result.lastUpdated, "2026-10-13");
    const agents = JSON.parse(result.files["agents.json"]);
    const ai = JSON.parse(result.files["ai-instructions.json"]);
    assert.equal(validateDocument(agents, "agents").valid, true);
    assert.equal(validateDocument(ai, "ai-instructions").valid, true);
    assert.equal(agents.live, false);
    assert.equal(ai.live, false);
    assert.equal(agents.protocol, "AAA/0.2");
    assert.equal(ai.protocol, "AAA/0.2");
    assert.match(result.files["llms.txt"], /live: false/);
    assert.equal(result.files["agents.json"].endsWith("\n"), true);
  }
});

test("CLI writes files and validate.mjs accepts them", () => {
  for (const profile of ["site", "settings", "handoff"]) {
    const out = join(TMP, `cli-${profile}`);
    const r = run(["--profile", profile, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /WROTE /);
    assert.match(r.stdout, /VALID .*agents\.json \(kind: agents\)/);
    assert.match(r.stdout, /VALID .*ai-instructions\.json \(kind: ai-instructions\)/);
    for (const kind of ["agents", "ai-instructions"]) {
      const cli = spawnSync(process.execPath, [VALIDATE, join(out, `${kind}.json`)], { encoding: "utf8" });
      assert.equal(cli.status, 0, cli.stdout + cli.stderr);
      assert.match(cli.stdout, /^VALID/);
    }
    assert.equal(existsSync(join(out, "llms.txt")), true);
  }
});

test("missing or unknown flags and profiles are usage errors", () => {
  const out = join(TMP, "usage");
  for (const args of [
    [],
    ["--profile", "site"],
    ["--out", out],
    ["--profile", "unknown", "--out", out],
    ["--profile", "site", "--out", out, "--wat"],
    ["--profile", "--out", out],
    ["--profile", "site", "--out"],
    ["--profile", "site", "--out", out, "--name"],
    ["--profile=", "--out", out],
    ["--profile", "constructor", "--out", out],
    ["--profile", "__proto__", "--out", out],
  ]) {
    const r = run(args);
    assert.equal(r.code, 2, `${args}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /usage:/);
  }
});

test("existing files are left untouched without --force", () => {
  const out = join(TMP, "no-clobber");
  const first = run(["--profile", "site", "--out", out]);
  assert.equal(first.code, 0, first.stderr);
  const before = readFileSync(join(out, "agents.json"), "utf8");
  writeFileSync(join(out, "keep-me.txt"), "safe\n");
  const second = run(["--profile", "settings", "--out", out]);
  assert.equal(second.code, 2);
  assert.match(second.stderr, /exists; pass --force/);
  assert.equal(readFileSync(join(out, "agents.json"), "utf8"), before);
  assert.equal(readFileSync(join(out, "keep-me.txt"), "utf8"), "safe\n");
  assert.equal(JSON.parse(before).agent_card.endpoints.action_root, "/api/v1/agent-actions");
});

test("force overwrites and --name sets the card name", () => {
  const out = join(TMP, "force-name");
  assert.equal(run(["--profile=site", `--out=${out}`, "--name", "First"]).code, 0);
  const again = run(["--profile", "handoff", "--out", out, "--name=Harbor Catalog", "--force"]);
  assert.equal(again.code, 0, again.stderr);
  const { agents, ai, llms } = readTrio(out);
  assert.equal(agents.agent_card.name, "Harbor Catalog");
  assert.equal(agents.http_action_api, "none");
  assert.equal(agents.agent_card.endpoints.action_root, "none");
  assert.equal(ai.out_of_settings_actions[0].requires_human_confirmation, true);
  assert.match(llms, /Harbor Catalog/);
});

test("site profile declares an HTTP action_root and mapped endpoints", () => {
  const { files } = scaffoldProfile("site", { name: "Acme Site", lastUpdated: "2026-10-13" });
  const agents = JSON.parse(files["agents.json"]);
  const ai = JSON.parse(files["ai-instructions.json"]);
  assert.equal(agents.agent_card.name, "Acme Site");
  assert.equal(agents.agent_card.endpoints.action_root, "/api/v1/agent-actions");
  assert.deepEqual(agents.endpoints.map((entry) => entry.name), ["get_status", "submit_task"]);
  for (const entry of agents.endpoints) {
    assert.equal(entry.path.startsWith("/api/v1/agent-actions"), true, entry.path);
  }
  assert.equal(ai.safety.require_human_confirmation_for.includes("submit_task"), true);
  assert.equal(ai.policy.allow_autonomous_execution, false);
});

test("settings profile uses action_root none and documented anchors", () => {
  const { files } = scaffoldProfile("settings");
  const agents = JSON.parse(files["agents.json"]);
  const ai = JSON.parse(files["ai-instructions.json"]);
  assert.equal(agents.agent_card.endpoints.action_root, "none");
  assert.equal(agents.http_action_api, "none");
  assert.equal("endpoints" in agents, false);
  const ids = ai.settings_anchors.map((entry) => entry.id);
  assert.deepEqual(ids, ["privacy", "models", "connectors", "appearance", "about"]);
  assert.deepEqual(ai.settings_actions.map((entry) => entry.id), ids);
  for (const entry of ai.settings_anchors) {
    assert.equal(entry.deep_link, `app://settings?id=${entry.id}`);
  }
});

test("handoff profile requires human confirmation on every offering", () => {
  const { files } = scaffoldProfile("handoff", { name: "Aster" });
  const ai = JSON.parse(files["ai-instructions.json"]);
  assert.ok(ai.out_of_settings_actions.length >= 1);
  for (const entry of ai.out_of_settings_actions) {
    assert.equal(entry.requires_human_confirmation, true);
    assert.equal(typeof entry.how_to, "string");
    assert.ok(entry.how_to.length > 0);
    assert.equal(typeof entry.href, "string");
  }
  assert.equal(ai.policy.allow_autonomous_execution, false);
  assert.equal(JSON.parse(files["agents.json"]).agent_card.endpoints.action_root, "none");
});

test("importing the scaffold neither writes files nor depends on argv being a file", () => {
  const isolated = join(TMP, "import-isolated");
  mkdirSync(isolated, { recursive: true });
  const code = `
    const { scaffoldProfile } = await import(${JSON.stringify(new URL("./init.mjs", import.meta.url).href)});
    const result = scaffoldProfile("site", { lastUpdated: "2026-10-13" });
    console.log(result.profile);
  `;
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", code, "not-a-file"], {
    encoding: "utf8",
    cwd: isolated,
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "site\n");
  assert.equal(existsSync(join(isolated, "agents.json")), false);
});

test("scaffoldProfile rejects unknown profiles and empty names", () => {
  for (const profile of ["unknown", "__proto__", "constructor", ""]) {
    assert.throws(() => scaffoldProfile(profile), TypeError);
  }
  assert.throws(() => scaffoldProfile("site", { name: "" }), TypeError);
});
