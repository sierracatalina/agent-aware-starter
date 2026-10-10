#!/usr/bin/env node
/**
 * Dependency-free, read-only AAA consumer (Node >= 20).
 *
 * readOrigin(origin, { strict = false, action, allowHttpLocal = false,
 *   allowCrossOriginDiscovery = false, localPolicy = {}, timeoutMs = 5000 })
 * returns { outcome, map, warnings, fetched }. `fetched` lists attempted URLs.
 * Outcomes: ok, settings_profile, missing, invalid, fetch_refused, unknown_action.
 * All failures return map:null. An absent UNDECLARED default llms.txt is optional:
 * it warns and preserves the validated JSON map. Explicit context fetch failures
 * fail closed. Neither full_text nor the prose markdown_twin rule is fetched.
 *
 * The normalized map is descriptive, never executable authority. localPolicy's
 * deny, require_human_confirmation, and ignore_elements string arrays are unioned
 * with publisher restrictions, including the equivalent nested policy/safety
 * fields. Permissive publisher fields never alter the map or grant authority.
 * The consumer must still enforce its existing user/tool/confirmation policy.
 *
 * Production requests require public HTTPS. The initial AI file may redirect to
 * a canonical public origin; all discovery starts there and stays there unless
 * the caller explicitly opts in to cross-origin discovery. DNS is checked once
 * per hop and pinned, without replacing the TLS hostname or certificate check.
 * allowHttpLocal is only for direct requests to an explicit initial loopback
 * fixture origin. It NEVER permits a private/loopback redirect destination.
 * timeoutMs can tighten, but never increase, the five-second per-file deadline.
 *
 * CLI: node reference/read.mjs <origin> [--strict] [--action <id>] [--json]
 *       [--allow-http-local]
 * Exit 0: ok/settings_profile; 1: other outcomes; 2: usage.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocument } from "./validate.mjs";

const MAX_BYTES = 65_536;
const MAX_REDIRECTS = 3;
const MAX_TIMEOUT = 5_000;
const SCHEMAS = Object.fromEntries(["agents", "ai-instructions"].map((kind) => [
  kind, JSON.parse(readFileSync(new URL(`../schemas/${kind}.schema.json`, import.meta.url), "utf8")),
]));
const ownObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = (...lists) => [...new Set(lists.flat())];

class ReadFailure extends Error {
  constructor(outcome, message) {
    super(message);
    this.outcome = outcome;
  }
}
const refused = (message) => new ReadFailure("fetch_refused", message);
const missing = (message) => new ReadFailure("missing", message);

function hostname(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function ipv4Value(address) {
  return address.split(".").reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function inRange(value, start, bits, width) {
  return value >> BigInt(width - bits) === start >> BigInt(width - bits);
}

function ipv6Value(address) {
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const index = input.lastIndexOf(":");
    const v4 = ipv4Value(input.slice(index + 1));
    input = `${input.slice(0, index)}:${(v4 >> 16n).toString(16)}:${(v4 & 65535n).toString(16)}`;
  }
  const halves = input.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n);
}

const IPV4_DENY = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
  // Azure's virtual infrastructure address is not an ordinary public server.
  ["168.63.129.16", 32],
].map(([address, bits]) => [ipv4Value(address), bits]);
const IPV6_DENY = [
  ["2001::", 23], // Special-purpose space, including Teredo, benchmarking and ORCHID.
  ["2001:db8::", 32], ["2002::", 16], // Documentation and IPv4-embedding 6to4.
  ["3ffe::", 16], ["3fff::", 20], // Retired 6bone and documentation space.
].map(([address, bits]) => [ipv6Value(address), bits]);

function isPublic(address) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    return !IPV4_DENY.some(([start, bits]) => inRange(value, start, bits, 32));
  }
  if (family === 6) {
    const value = ipv6Value(address);
    // A conservative global-unicast allowlist also refuses mapped/compatible
    // IPv4, NAT64, loopback, unspecified, link-local, ULA and multicast addresses.
    return inRange(value, ipv6Value("2000::"), 3, 128) &&
      !IPV6_DENY.some(([start, bits]) => inRange(value, start, bits, 128));
  }
  return false;
}

function isLoopback(address) {
  return (isIP(address) === 4 && inRange(ipv4Value(address), ipv4Value("127.0.0.0"), 8, 32)) ||
    (isIP(address) === 6 && ipv6Value(address) === 1n);
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

function checkUrl(url, { initialOrigin, discoveryOrigin, allowHttpLocal, allowCrossOriginDiscovery }, redirects) {
  if (url.username || url.password || url.hash) throw refused("Credentials and fragments are not permitted in fetch URLs.");
  if (discoveryOrigin && !allowCrossOriginDiscovery && url.origin !== discoveryOrigin) {
    throw refused(`Cross-origin discovery refused: ${url.origin}.`);
  }
  const host = hostname(url);
  const localFixture = allowHttpLocal && redirects === 0 && url.origin === initialOrigin &&
    url.protocol === "http:" && (isLoopback(host) || host.toLowerCase() === "localhost");
  if (url.protocol !== "https:" && !localFixture) {
    throw refused("Only public HTTPS is permitted; HTTP loopback fixtures must be explicitly enabled and cannot be redirect targets.");
  }
  return localFixture;
}

/** Exactly one resolver invocation; aborting DNS never proceeds to a connection. */
function resolveOnce(host, signal) {
  return new Promise((fulfill, reject) => {
    const onAbort = () => { cleanup(); reject(missing("Fetch exceeded its time limit during DNS.")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
      cleanup();
      if (signal.aborted) return;
      if (error) reject(missing(`DNS lookup failed: ${error.code || error.message}.`));
      else fulfill(addresses);
    });
  });
}

function requestOnce(url, address, signal) {
  return new Promise((fulfill, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const fail = (error) => reject(error instanceof ReadFailure ? error :
      missing(signal.aborted ? "Fetch exceeded its time limit." : `Fetch failed: ${error.message}.`));
    const request = transport.request(url, {
      method: "GET",
      agent: false,
      rejectUnauthorized: true, // Also override NODE_TLS_REJECT_UNAUTHORIZED=0.
      signal,
      family: address.family,
      autoSelectFamily: false,
      headers: { Accept: "application/json, text/plain;q=0.9", "Accept-Encoding": "identity" },
      // This returns the checked result, never another DNS lookup. Keep the URL
      // hostname untouched so Host, SNI and TLS certificate checks stay correct.
      lookup: (_host, options, callback) => {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const status = response.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) fail(missing("Redirect has no Location header."));
        else fulfill({ location });
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
          fulfill({ text });
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
      const localFixture = checkUrl(url, policy, redirects);
      fetched.push(url.href);
      const addresses = await resolveOnce(hostname(url), controller.signal);
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((address) =>
        !address || isIP(address.address) !== address.family ||
        !(localFixture ? isLoopback(address.address) : isPublic(address.address)))) {
        throw refused("DNS returned a non-public, invalid, or disallowed destination.");
      }
      if (controller.signal.aborted) throw missing("Fetch exceeded its time limit.");
      const response = await requestOnce(url, addresses[0], controller.signal);
      if (!response.location) return { text: response.text, url };
      if (redirects === MAX_REDIRECTS) throw refused(`More than ${MAX_REDIRECTS} redirects refused.`);
      try { url = new URL(response.location, url); } catch { throw refused("Invalid redirect URL."); }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Strip ONLY additional properties forbidden by the actual schema. Free-form
 * extensions and typed maps retain their intended schema semantics. */
function stripUnknown(value, schema, path, warnings) {
  if (Array.isArray(value) && schema.items) {
    return value.map((item, index) => stripUnknown(item, schema.items, `${path}[${index}]`, warnings));
  }
  if (!ownObject(value)) return value;
  const entries = [];
  const properties = schema.properties || {};
  const patterns = Object.entries(schema.patternProperties || {}).map(([pattern, sub]) => [new RegExp(pattern), sub]);
  for (const [key, child] of Object.entries(value)) {
    const matching = patterns.filter(([pattern]) => pattern.test(key)).map(([, sub]) => sub);
    if (Object.hasOwn(properties, key)) matching.unshift(properties[key]);
    if (matching.length) {
      let cleaned = child;
      for (const sub of matching) cleaned = stripUnknown(cleaned, sub, `${path}.${key}`, warnings);
      entries.push([key, cleaned]);
    } else if (schema.additionalProperties === false) {
      warnings.push(`${path}.${key}: unknown field ignored.`);
    } else if (ownObject(schema.additionalProperties)) {
      entries.push([key, stripUnknown(child, schema.additionalProperties, `${path}.${key}`, warnings)]);
    } else entries.push([key, child]);
  }
  // Object.fromEntries treats __proto__ as data, never a prototype mutation.
  return Object.fromEntries(entries);
}

function parseDocument(text, kind, strict, warnings) {
  let document;
  try { document = JSON.parse(text); } catch { throw missing(`${kind}.json is malformed JSON.`); }
  if (!strict) document = stripUnknown(document, SCHEMAS[kind], "$", warnings);
  const result = validateDocument(document, kind);
  warnings.push(...result.warnings);
  if (!result.valid) throw new ReadFailure("invalid", `${kind}.json: ${result.errors.join("; ")}`);
  return document;
}

function stringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ReadFailure("invalid", `${label} must be an array of strings.`);
  }
  return value;
}

function normalize(origin, ai, agents, context, localPolicy, action) {
  const list = (value, label) => stringList(value, `localPolicy.${label}`);
  const local = ownObject(localPolicy) ? localPolicy : null;
  if (!local) throw new ReadFailure("invalid", "localPolicy must be an object.");
  const deny = unique(list(local.deny, "deny"), list(local.prohibit_direct_input_to, "prohibit_direct_input_to"),
    list(local.safety?.prohibit_direct_input_to, "safety.prohibit_direct_input_to"), ai.safety?.prohibit_direct_input_to || []);
  const confirmation = unique(
    list(local.require_human_confirmation, "require_human_confirmation"),
    list(local.require_human_confirmation_for, "require_human_confirmation_for"),
    list(local.require_human_approval_for, "require_human_approval_for"),
    list(local.safety?.require_human_confirmation_for, "safety.require_human_confirmation_for"),
    list(local.policy?.require_human_approval_for, "policy.require_human_approval_for"),
    ai.policy?.require_human_approval_for || [], ai.safety?.require_human_confirmation_for || [],
    (ai.out_of_settings_actions || []).filter((entry) => entry.requires_human_confirmation).map((entry) => entry.id),
  );
  const ignore = unique(list(local.ignore_elements, "ignore_elements"),
    list(local.interaction_rules?.ignore_elements, "interaction_rules.ignore_elements"),
    ai.interaction_rules?.ignore_elements || [], ["[data-agent-untrusted]"]);
  const actions = [
    ...(agents.endpoints || []).map((entry) => ({ ...entry, id: entry.name, kind: "endpoint" })),
    ...(ai.settings_actions || []).map((entry) => ({ ...entry, kind: "settings" })),
    ...(ai.out_of_settings_actions || []).map((entry) => ({ ...entry, kind: "out_of_settings" })),
  ];
  // False flags on descriptive actions never remove a stronger merged rule.
  for (const entry of actions) {
    if (confirmation.some((rule) => [entry.id, entry.path, entry.data_agent_action].includes(rule))) {
      entry.requires_human_confirmation = true;
    }
  }
  const matches = action === undefined ? [] : actions.filter((entry) => entry.id === action);
  if (matches.length > 1) throw new ReadFailure("invalid", `Action '${action}' is ambiguous: multiple declarations share that ID.`);
  const selected = matches[0] || null;
  if (action !== undefined && !selected) throw new ReadFailure("unknown_action", `Action '${action}' is not declared.`);
  // A declaration of no HTTP API can only tighten an inconsistent publisher map.
  const actionRoot = [ai.http_action_api, agents.http_action_api, agents.agent_card.endpoints.action_root].includes("none")
    ? "none" : agents.agent_card.endpoints.action_root;
  return {
    origin,
    action_root: actionRoot,
    grants_authority: false,
    restrictions: { deny, require_human_confirmation: confirmation, ignore_elements: ignore },
    actions,
    selected_action: selected,
    settings_anchors: ai.settings_anchors || [],
    priority_selectors: ai.priority_selectors || {},
    context: context === null ? null : { text: context, untrusted: true },
  };
}

export async function readOrigin(origin, options = {}) {
  const warnings = [];
  const fetched = [];
  try {
    const initial = parseOrigin(origin);
    const timeoutMs = options.timeoutMs ?? MAX_TIMEOUT;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) {
      throw new ReadFailure("invalid", "timeoutMs must be positive and cannot exceed 5000 ms.");
    }
    const policy = {
      initialOrigin: initial.origin,
      allowHttpLocal: options.allowHttpLocal === true,
      allowCrossOriginDiscovery: options.allowCrossOriginDiscovery === true,
    };
    const primary = await fetchFile(new URL("/.well-known/ai-instructions.json", initial), policy, fetched, timeoutMs);
    const ai = parseDocument(primary.text, "ai-instructions", options.strict === true, warnings);
    const canonicalOrigin = primary.url.origin;
    const discoveryPolicy = { ...policy, discoveryOrigin: canonicalOrigin };
    const pointer = (value, fallback) => {
      try { return new URL(value === undefined ? fallback : value, `${canonicalOrigin}/`); }
      catch { throw refused("Invalid discovery URL."); }
    };
    const card = await fetchFile(pointer(ai.discovery?.actions, "/.well-known/agents.json"), discoveryPolicy, fetched, timeoutMs);
    const agents = parseDocument(card.text, "agents", options.strict === true, warnings);
    let context = null;
    try {
      const file = await fetchFile(pointer(ai.discovery?.context, "/.well-known/llms.txt"), discoveryPolicy, fetched, timeoutMs);
      context = file.text;
    } catch (error) {
      if (ai.discovery?.context !== undefined || !(error instanceof ReadFailure) || error.outcome !== "missing") throw error;
      warnings.push(`Optional default llms.txt missing: ${error.message}`);
    }
    const map = normalize(canonicalOrigin, ai, agents, context, options.localPolicy ?? {}, options.action);
    return { outcome: map.action_root === "none" ? "settings_profile" : "ok", map, warnings, fetched };
  } catch (error) {
    warnings.push(error.message);
    return { outcome: error instanceof ReadFailure ? error.outcome : "missing", map: null, warnings, fetched };
  }
}

const USAGE = "usage: node reference/read.mjs <origin> [--strict] [--action <id>] [--json] [--allow-http-local]";
async function main(args) {
  let origin;
  let json = false;
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--json") json = true;
    else if (arg === "--allow-http-local") options.allowHttpLocal = true;
    else if (arg === "--action" && args[index + 1] && !args[index + 1].startsWith("--")) options.action = args[++index];
    else if (!arg.startsWith("-") && origin === undefined) origin = arg;
    else { process.stderr.write(`${USAGE}\n`); return 2; }
  }
  if (!origin) { process.stderr.write(`${USAGE}\n`); return 2; }
  try { parseOrigin(origin); } catch { process.stderr.write(`${USAGE}\n`); return 2; }
  const result = await readOrigin(origin, options);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`${result.outcome}\n`);
    for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
    if (result.map) process.stdout.write(`${JSON.stringify(result.map, null, 2)}\n`);
  }
  return ["ok", "settings_profile"].includes(result.outcome) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
