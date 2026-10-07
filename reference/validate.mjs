#!/usr/bin/env node
/**
 * AAA reference validator (task-4).
 *
 * Validates an agents.json or ai-instructions.json document against the
 * tightened schemas in ../schemas/. Dependency-free: implements the JSON
 * Schema subset the AAA schemas use (type, required, properties,
 * additionalProperties, items, enum, const, anyOf/oneOf, minLength,
 * minimum, pattern).
 *
 * Advisory rule (not a validity error): if
 * `policy.allow_autonomous_execution` is `true`, emit an ADVISORY warning.
 * AAA never grants authority (spec 00, invariant 1: "Handshake, not
 * authority"); the flag is a publisher-local hint only.
 *
 * Usage:
 *   node reference/validate.mjs <document.json> [--kind agents|ai-instructions]
 *
 * Exit codes: 0 = valid (advisories allowed), 1 = invalid, 2 = usage/IO error.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = {
  agents: join(HERE, "..", "schemas", "agents.schema.json"),
  "ai-instructions": join(HERE, "..", "schemas", "ai-instructions.schema.json"),
};

const ADVISORY_TEXT =
  "ADVISORY: policy.allow_autonomous_execution is true. " +
  "This flag is advisory only — AAA never grants authority " +
  "(spec 00, invariant 1: handshake, not authority).";

function usage() {
  return (
    "usage: node reference/validate.mjs <document.json> [--kind agents|ai-instructions]\n" +
    "validates the document against the AAA JSON schemas. " +
    "exit 0 = valid, 1 = invalid, 2 = usage/IO error."
  );
}

/** Minimal JSON Schema validator for the subset AAA schemas use. */
function validate(schema, instance, path, errors) {
  const at = path || "$";
  const t = schema.type;

  if (t) {
    const ok =
      t === "object"
        ? isPlainObject(instance)
        : t === "array"
          ? Array.isArray(instance)
          : t === "string"
            ? typeof instance === "string"
            : t === "boolean"
              ? typeof instance === "boolean"
              : t === "integer"
                ? Number.isInteger(instance)
                : true;
    if (!ok) {
      errors.push(`${at}: expected ${t}, got ${jsonType(instance)}`);
      return;
    }
  }

  if (schema.const !== undefined && instance !== schema.const) {
    errors.push(`${at}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(instance)) {
    errors.push(`${at}: ${JSON.stringify(instance)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${at}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern) {
      let re;
      try {
        re = new RegExp(schema.pattern);
      } catch {
        errors.push(`${at}: invalid pattern ${schema.pattern} in schema`);
        return;
      }
      if (!re.test(instance)) errors.push(`${at}: does not match pattern ${schema.pattern}`);
    }
  }
  if (typeof instance === "number" && schema.minimum !== undefined && instance < schema.minimum) {
    errors.push(`${at}: ${instance} is less than minimum ${schema.minimum}`);
  }

  for (const key of ["anyOf", "oneOf"]) {
    if (schema[key]) {
      const matches = schema[key].filter((sub) => {
        const subErrors = [];
        validate(sub, instance, at, subErrors);
        return subErrors.length === 0;
      }).length;
      if (key === "oneOf" && matches !== 1) {
        errors.push(`${at}: oneOf matched ${matches} branches, expected exactly 1`);
      } else if (key === "anyOf" && matches < 1) {
        errors.push(`${at}: anyOf matched no branches`);
      }
    }
  }

  if (isPlainObject(instance)) {
    for (const req of schema.required || []) {
      if (!(req in instance)) errors.push(`${at}: missing required property '${req}'`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(instance)) {
      if (Object.hasOwn(props, k)) {
        validate(props[k], v, `${at}.${k}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${at}: additional property '${k}' is not allowed (use 'extensions' for extras)`);
      } else if (isPlainObject(schema.additionalProperties)) {
        validate(schema.additionalProperties, v, `${at}.${k}`, errors);
      }
    }
  }

  if (Array.isArray(instance) && schema.items) {
    instance.forEach((item, i) => validate(schema.items, item, `${at}[${i}]`, errors));
  }
}

function isPlainObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function jsonType(x) {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  return typeof x;
}

function detectKind(doc, filename) {
  const base = basename(filename);
  if (base.startsWith("agents")) return "agents";
  if (base.startsWith("ai-instructions")) return "ai-instructions";
  if (isPlainObject(doc) && "agent_card" in doc) return "agents";
  if (isPlainObject(doc) && "version" in doc) return "ai-instructions";
  return null;
}

function main(argv) {
  const args = argv.slice(2);
  let file;
  let kindFlag;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--kind") {
      if (args[i + 1] === undefined || args[i + 1].startsWith("--")) {
        process.stderr.write(usage() + "\n");
        return 2;
      }
      kindFlag = args[++i];
    } else if (arg.startsWith("--kind=")) {
      kindFlag = arg.slice("--kind=".length);
    } else if (!arg.startsWith("--") && file === undefined) {
      file = arg;
    }
  }
  if (!file) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  if (!existsSync(file)) {
    process.stderr.write(`error: file not found: ${file}\n`);
    return 2;
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stderr.write(`error: ${file} is not valid JSON: ${e.message}\n`);
    return 2;
  }

  const kind = kindFlag ?? detectKind(doc, file);
  if (!kind || !Object.hasOwn(SCHEMAS, kind)) {
    process.stderr.write(
      `error: cannot determine schema kind for ${file}; pass --kind=agents or --kind=ai-instructions\n`,
    );
    return 2;
  }

  let schema;
  try {
    schema = JSON.parse(readFileSync(SCHEMAS[kind], "utf8"));
  } catch (e) {
    process.stderr.write(`error: cannot load schema: ${e.message}\n`);
    return 2;
  }

  const errors = [];
  validate(schema, doc, "$", errors);
  if (errors.length > 0) {
    process.stdout.write(`INVALID ${file} (kind: ${kind})\n`);
    for (const e of errors) process.stdout.write(`  - ${e}\n`);
    return 1;
  }

  process.stdout.write(`VALID ${file} (kind: ${kind})\n`);

  // Advisory-only rule: AAA never grants authority.
  if (
    kind === "ai-instructions" &&
    isPlainObject(doc.policy) &&
    doc.policy.allow_autonomous_execution === true
  ) {
    process.stdout.write(ADVISORY_TEXT + "\n");
  }
  return 0;
}

process.exit(main(process.argv));
