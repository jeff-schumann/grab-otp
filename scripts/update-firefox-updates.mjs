#!/usr/bin/env node
//
// Regenerates updates.json — the feed Firefox polls to discover new versions of
// the self-distributed add-on.
//
// Firefox reads `update_url` out of the installed add-on's manifest, fetches
// this file, and offers anything newer than what the user has. The .xpi it
// points at must be Mozilla-signed and downloadable over HTTPS without auth,
// which is why it lives on a GitHub release of this (public) repo.
//
// Usage:  node scripts/update-firefox-updates.mjs [version]
//         (defaults to the version in src/manifest-firefox.json)
//
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'jeff-schumann/grab-otp';

const manifest = JSON.parse(
  readFileSync(resolve(projectRoot, 'src/manifest-firefox.json'), 'utf8')
);
const version = process.argv[2] || manifest.version;
const addonId = manifest.browser_specific_settings.gecko.id;
const strictMinVersion = manifest.browser_specific_settings.gecko.strict_min_version;

if (!/^\d+(?:\.\d+)*$/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

// The signed .xpi is uploaded to the matching GitHub release under this name.
const assetName = `grab_otp-${version}.xpi`;
const updateLink = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`;

const entry = { version, update_link: updateLink };

// Hash the local signed build when we have it, so a corrupted or swapped
// download is rejected rather than installed.
const localXpi = resolve(projectRoot, 'signed-packages', assetName);
if (existsSync(localXpi)) {
  const digest = createHash('sha256').update(readFileSync(localXpi)).digest('hex');
  entry.update_hash = `sha256:${digest}`;
} else {
  console.warn(`No local ${assetName} — writing the feed without an update_hash.`);
}

if (strictMinVersion) {
  entry.applications = { gecko: { strict_min_version: strictMinVersion } };
}

const feed = { addons: { [addonId]: { updates: [entry] } } };
const outFile = resolve(projectRoot, 'updates.json');
writeFileSync(outFile, `${JSON.stringify(feed, null, 2)}\n`);

console.log(`updates.json now advertises v${version}`);
console.log(`  ${updateLink}`);
if (!existsSync(localXpi)) {
  console.log('  (no hash — sign the build first if you want one)');
}
