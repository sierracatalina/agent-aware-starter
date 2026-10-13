#!/usr/bin/env node
/**
 * AAA publication conformance runner (AAA/0.2).
 *
 * Fetches the handshake from an origin and checks authoring schemas plus
 * the live-publication rules in spec 02: JSON/prose content types, strict
 * validity, last_updated when live:true, and well-known paths for a live
 * claim. Does not execute actions and does not grant authority.
 *
 * Usage:
 *   node reference/conform.mjs <origin> [--json] [--allow-http-local]
 *   node reference/conform.mjs --serve <dir> [--json]
 *
 * --serve hosts a fixture directory on loopback (flat trio or a
 * .well-known/ subdirectory) and implies --allow-http-local.
 *
 * Exit codes: 0 = every check passed, 1 = a check failed, 2 = usage/IO.
 */
import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocument } from "./validate.mjs";

const MAX_BYTES = 65_536;
const MAX_REDIRECTS = 3;
const MAX_TIMEOUT = 5_000;
const AI_PATH = "/.well-known/ai-instructions.json";
const CARD_PATH = "/.well-known/agents.json";
const CONTEXT_PATH = "/.well-known/llms.txt";

const USAGE =
  "usage: node reference/conform.mjs <origin> [--json] [--allow-http-local]\n" +
  "       node reference/conform.mjs --serve <dir> [--json]\n" +
  "checks handshake publication. exit 0 = pass, 1 = fail, 2 = usage/IO.";

class ConformFailure extends Error {
  constructor(outcome, message) {
    super(message);
    this.outcome = outcome;
  }
}
const refused = (message) => new ConformFailure("fetch_refused", message);
const missing = (message) => new ConformFailure("missing", message);

function hostname(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function isLoopbackHost(host) {
  const value = host.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function parseOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { throw refused("Expected an absolute HTTP(S) origin."); }
  if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw refused("Expected an HTTP(S) origin without credentials, a path, query, or fragment.");
  }
  return url;
}

function checkUrl(url, policy, redirects) {
  if (url.username || url.password || url.hash) {
    throw refused("Credentials and fragments are not permitted in fetch URLs.");
  }
  if (policy.discoveryOrigin && !policy.allowCrossOriginDiscovery && url.origin !== policy.discoveryOrigin) {
    throw refused(`Cross-origin discovery refused: ${url.origin}.`);
  }
  const host = hostname(url);
  const localFixture = policy.allowHttpLocal && redirects === 0 && url.origin === policy.initialOrigin &&
    url.protocol === "http:" && isLoopbackHost(host);
  if (url.protocol !== "https:" && !localFixture) {
    throw refused("Only public HTTPS is permitted; HTTP loopback fixtures must be explicitly enabled.");
  }
  return localFixture;
}

function parseMediaType(header) {
  if (!header || typeof header !== "string") return { type: "", params: {} };
  const [type, ...rest] = header.split(";").map((part) => part.trim());
  const params = {};
  for (const part of rest) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    params[part.slice(0, index).trim().toLowerCase()] =
      part.slice(index + 1).trim().replace(/^"|"$/g, "").toLowerCase();
  }
  return { type: type.toLowerCase(), params };
}

function isJsonType(header) {
  return parseMediaType(header).type === "application/json";
}

function isPlainUtf8(header) {
  const media = parseMediaType(header);
  return media.type === "text/plain" && media.params.charset === "utf-8";
}

function requestOnce(url, signal) {
  return new Promise((fulfill, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const fail = (error) => reject(error instanceof ConformFailure ? error :
      missing(signal.aborted ? "Fetch exceeded its time limit." : `Fetch failed: ${error.message}.`));
    const request = transport.request(url, {
      method: "GET",
      agent: false,
      rejectUnauthorized: true,
      signal,
      headers: { Accept: "application/json, text/plain;q=0.9", "Accept-Encoding": "identity" },
    }, (response) => {
      const status = response.statusCode;
      const contentType = response.headers["content-type"] || "";
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) fail(missing("Redirect has no Location header."));
        else fulfill({ location, status, contentType });
        return;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        fail(missing(`HTTP ${status}.`));
        return;
      }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy();
        fail(missing("Encoded response refused; only an identity body is accepted."));
        return;
      }
      const length = response.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
        response.destroy();
        fail(refused(`File exceeds the ${MAX_BYTES}-byte limit or has an invalid Content-Length.`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          fail(refused(`File exceeds the ${MAX_BYTES}-byte limit.`));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on("aborted", () => fail(missing("Response body was interrupted.")));
      response.on("error", fail);
      response.on("end", () => {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
          fulfill({ text, status, contentType, bytes });
        } catch { fail(missing("File is not valid UTF-8.")); }
      });
    });
    request.on("error", fail);
    request.end();
  });
}

async function fetchFile(input, policy, fetched, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let url;
  try {
    try { url = new URL(input); } catch { throw refused("Invalid fetch URL."); }
    for (let redirects = 0; ; redirects++) {
      checkUrl(url, policy, redirects);
      fetched.push(url.href);
      const response = await requestOnce(url, controller.signal);
      if (!response.location) return { ...response, url };
      if (redirects === MAX_REDIRECTS) throw refused(`More than ${MAX_REDIRECTS} redirects refused.`);
      try { url = new URL(response.location, url); } catch { throw refused("Invalid redirect URL."); }
    }
  } finally {
    clearTimeout(timer);
  }
}

function addCheck(checks, id, ok, detail) {
  checks.push({ id, ok, detail });
}

function pointer(value, fallback, origin) {
  try { return new URL(value === undefined ? fallback : value, `${origin}/`); }
  catch { throw refused("Invalid discovery URL."); }
}

/** Check one origin. options: allowHttpLocal, allowCrossOriginDiscovery, timeoutMs. */
export async function conformOrigin(origin, options = {}) {
  const checks = [];
  const warnings = [];
  const fetched = [];
  let handshake = "missing";
  let profile = null;
  let live = null;
  try {
    const initial = parseOrigin(origin);
    const timeoutMs = options.timeoutMs ?? MAX_TIMEOUT;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) {
      throw new ConformFailure("invalid", "timeoutMs must be positive and cannot exceed 5000 ms.");
    }
    const policy = {
      initialOrigin: initial.origin,
      allowHttpLocal: options.allowHttpLocal === true,
      allowCrossOriginDiscovery: options.allowCrossOriginDiscovery === true,
    };
    const primary = await fetchFile(new URL(AI_PATH, initial), policy, fetched, timeoutMs);
    addCheck(checks, "ai-instructions.type", isJsonType(primary.contentType), primary.contentType || "(missing Content-Type)");
    let ai;
    try { ai = JSON.parse(primary.text); }
    catch { throw missing("ai-instructions.json is malformed JSON."); }
    const aiResult = validateDocument(ai, "ai-instructions");
    warnings.push(...aiResult.warnings);
    addCheck(checks, "ai-instructions.schema", aiResult.valid,
      aiResult.valid ? "VALID" : aiResult.errors.join("; "));
    if (!aiResult.valid) throw new ConformFailure("invalid", `ai-instructions.json: ${aiResult.errors.join("; ")}`);

    const canonicalOrigin = primary.url.origin;
    const discoveryPolicy = { ...policy, discoveryOrigin: canonicalOrigin };
    const card = await fetchFile(pointer(ai.discovery?.actions, CARD_PATH, canonicalOrigin), discoveryPolicy, fetched, timeoutMs);
    addCheck(checks, "agents.type", isJsonType(card.contentType), card.contentType || "(missing Content-Type)");
    let agents;
    try { agents = JSON.parse(card.text); }
    catch { throw missing("agents.json is malformed JSON."); }
    const agentsResult = validateDocument(agents, "agents");
    addCheck(checks, "agents.schema", agentsResult.valid,
      agentsResult.valid ? "VALID" : agentsResult.errors.join("; "));
    if (!agentsResult.valid) throw new ConformFailure("invalid", `agents.json: ${agentsResult.errors.join("; ")}`);

    let contextPresent = false;
    try {
      const context = await fetchFile(pointer(ai.discovery?.context, CONTEXT_PATH, canonicalOrigin), discoveryPolicy, fetched, timeoutMs);
      contextPresent = true;
      addCheck(checks, "context.type", isPlainUtf8(context.contentType), context.contentType || "(missing Content-Type)");
    } catch (error) {
      if (ai.discovery?.context !== undefined || !(error instanceof ConformFailure) || error.outcome !== "missing") throw error;
      warnings.push(`Optional default llms.txt missing: ${error.message}`);
      addCheck(checks, "context.optional", true, "undeclared default llms.txt missing");
    }

    const liveAi = ai.live === true;
    const liveAgents = agents.live === true;
    live = liveAi || liveAgents;
    addCheck(checks, "live.consistent", liveAi === liveAgents,
      liveAi === liveAgents ? (liveAi ? "live: true" : "live: false") : "documents disagree on live");
    if (liveAi || liveAgents) {
      addCheck(checks, "live.last_updated",
        typeof ai.last_updated === "string" && ai.last_updated.length > 0 &&
        typeof agents.last_updated === "string" && agents.last_updated.length > 0,
        `ai-instructions=${ai.last_updated ?? "(missing)"}; agents=${agents.last_updated ?? "(missing)"}`);
      addCheck(checks, "live.well-known",
        primary.url.pathname === AI_PATH && card.url.pathname === CARD_PATH,
        `ai=${primary.url.pathname}; agents=${card.url.pathname}`);
      if (initial.protocol === "https:") {
        addCheck(checks, "live.transport", true, "https");
      } else {
        addCheck(checks, "live.transport", true, "loopback fixture; public HTTPS not verified");
      }
    } else {
      addCheck(checks, "live.publication", true, "not claimed (live: false)");
    }

    const actionRoot = agents.agent_card?.endpoints?.action_root;
    profile = actionRoot === "none" ? "settings_profile" : "ok";
    handshake = profile;
    const typeOk = checks.filter((check) => check.id.endsWith(".type") || check.id === "context.optional")
      .every((check) => check.ok);
    if (!typeOk) handshake = "invalid";
    if (contextPresent && !checks.find((check) => check.id === "context.type")?.ok) handshake = "invalid";
  } catch (error) {
    warnings.push(error.message);
    handshake = error instanceof ConformFailure ? error.outcome : "missing";
    if (!checks.some((check) => check.id === "handshake")) {
      addCheck(checks, "handshake", false, error.message);
    }
  }
  const passed = checks.length > 0 && checks.every((check) => check.ok);
  return {
    passed,
    verdict: passed ? "PASS" : "FAIL",
    handshake,
    profile,
    live,
    checks,
    warnings,
    fetched,
  };
}

function fixtureRoot(dir) {
  const nested = join(dir, ".well-known", "ai-instructions.json");
  const flat = join(dir, "ai-instructions.json");
  if (existsSync(nested)) return join(dir, ".well-known");
  if (existsSync(flat)) return dir;
  return null;
}

/** Host a fixture directory on loopback. Caller must close the server. */
export async function startFixtureServer(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`fixture directory not found: ${dir}`);
  }
  const root = fixtureRoot(dir);
  if (!root) throw new Error(`no ai-instructions.json in ${dir} or ${join(dir, ".well-known")}`);
  const routes = {};
  const files = [
    ["ai-instructions.json", AI_PATH, "application/json"],
    ["agents.json", CARD_PATH, "application/json"],
    ["llms.txt", CONTEXT_PATH, "text/plain; charset=utf-8"],
  ];
  for (const [name, path, type] of files) {
    const file = join(root, name);
    if (existsSync(file)) routes[path] = { file, type };
  }
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    if (!route) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": route.type });
    res.end(readFileSync(route.file));
  });
  await new Promise((fulfill, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", fulfill);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((fulfill) => { server.closeAllConnections(); server.close(fulfill); }),
  };
}

export async function serveAndConform(dir, options = {}) {
  const server = await startFixtureServer(dir);
  try {
    return await conformOrigin(server.origin, { ...options, allowHttpLocal: true });
  } finally {
    await server.close();
  }
}

function takeFlag(args, name) {
  const long = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === long) {
      if (args[i + 1] === undefined || args[i + 1].startsWith("--")) return { error: true };
      return { value: args[i + 1], consumed: [i, i + 1] };
    }
    if (arg.startsWith(`${long}=`)) return { value: arg.slice(long.length + 1), consumed: [i] };
  }
  return { value: undefined, consumed: [] };
}

function printReport(origin, result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ origin, ...result }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.verdict} ${origin}\n`);
  process.stdout.write(`  handshake: ${result.handshake}\n`);
  if (result.profile) process.stdout.write(`  profile: ${result.profile}\n`);
  if (result.live !== null) process.stdout.write(`  live: ${result.live}\n`);
  for (const check of result.checks) {
    process.stdout.write(`  ${check.ok ? "ok" : "FAIL"} ${check.id}: ${check.detail}\n`);
  }
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
}

async function main(args) {
  const serveFlag = takeFlag(args, "serve");
  if (serveFlag.error) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const consumed = new Set(serveFlag.consumed);
  let origin;
  let json = false;
  let allowHttpLocal = false;
  for (let i = 0; i < args.length; i++) {
    if (consumed.has(i)) continue;
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--allow-http-local") allowHttpLocal = true;
    else if (!arg.startsWith("-") && origin === undefined) origin = arg;
    else {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
  }
  if (serveFlag.value && origin) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (serveFlag.value) {
    let result;
    try {
      result = await serveAndConform(serveFlag.value);
    } catch (error) {
      process.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    printReport(serveFlag.value, result, json);
    return result.passed ? 0 : 1;
  }
  if (!origin) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try { parseOrigin(origin); } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const result = await conformOrigin(origin, { allowHttpLocal });
  printReport(origin, result, json);
  return result.passed ? 0 : 1;
}

let isDirectEntry = false;
try {
  isDirectEntry = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  // An importer may have a non-file argv[1], for example `node -e ... label`.
}
if (isDirectEntry) process.exitCode = await main(process.argv.slice(2));
