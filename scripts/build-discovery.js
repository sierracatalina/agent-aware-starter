'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { writeDiscovery } = require('../src/discovery');

const outputDir = path.resolve(__dirname, '../public/generated');
fs.rmSync(outputDir, { force: true, recursive: true });
const written = writeDiscovery(loadConfig(), outputDir);

process.stdout.write(`Generated ${written.length} discovery artifacts in ${outputDir}.\n`);
