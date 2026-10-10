// Directory entry point for `node --test reference/` on Node 20 and later.
const { readdirSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");

(async () => {
  for (const file of readdirSync(__dirname).filter((name) => name.endsWith(".test.mjs")).sort()) {
    await import(pathToFileURL(join(__dirname, file)).href);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
