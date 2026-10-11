#!/usr/bin/env node
// Distribution policy guard. This project is academic and experimental and
// does NOT publish prebuilt installers, binaries, or registry packages.
// CI runs this first; it fails if anything is added that would package or
// publish the software. Removing this check is a deliberate policy change:
// see DISCLAIMER.md ("No official builds") before doing it.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];
const rel = (p) => relative(root, p);

// 1. Every package must be private, so `npm publish` refuses.
const pkgFiles = ['package.json', ...['packages', 'apps'].flatMap((d) =>
  existsSync(join(root, d)) ? readdirSync(join(root, d)).map((n) => join(d, n, 'package.json')) : [],
)].map((p) => join(root, p)).filter(existsSync);

const PACKAGERS = ['electron-builder', 'electron-forge', '@electron-forge/cli', 'electron-packager', '@electron/packager', 'electron-installer-dmg', 'electron-winstaller', 'pkg', '@yao-pkg/pkg', 'nexe', 'electron-updater', 'update-electron-app'];
for (const f of pkgFiles) {
  const pkg = JSON.parse(readFileSync(f, 'utf8'));
  if (pkg.private !== true) problems.push(`${rel(f)}: must have "private": true (blocks npm publish).`);
  if (pkg.publishConfig) problems.push(`${rel(f)}: "publishConfig" is not allowed.`);
  if (pkg.build) problems.push(`${rel(f)}: electron-builder "build" config is not allowed.`);
  if (pkg.config?.forge) problems.push(`${rel(f)}: electron-forge config is not allowed.`);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const d of PACKAGERS) if (d in deps) problems.push(`${rel(f)}: packaging/auto-update dependency "${d}" is not allowed.`);
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (/\b(npm|pnpm|yarn)\s+publish\b|electron-builder|electron-forge\s+(make|publish)|electron-packager|gh\s+release/.test(String(cmd))) {
      problems.push(`${rel(f)}: script "${name}" packages or publishes the app.`);
    }
  }
}

// 2. No packaging config files.
for (const f of ['electron-builder.yml', 'electron-builder.yaml', 'electron-builder.json', 'electron-builder.json5', 'forge.config.js', 'forge.config.cjs', 'forge.config.ts', '.goreleaser.yml', 'apps/desktop/electron-builder.yml', 'apps/desktop/forge.config.js']) {
  if (existsSync(join(root, f))) problems.push(`${f}: packaging config is not allowed.`);
}

// 3. Workflows must not publish anything or hold write permissions.
const wfDir = join(root, '.github', 'workflows');
const PUBLISH = /upload-artifact|action-gh-release|create-release|upload-release-asset|gh\s+release|npm\s+publish|electron-builder|electron-forge|docker\/build-push-action|softprops|ncipollo\/release-action/i;
if (existsSync(wfDir)) {
  for (const n of readdirSync(wfDir)) {
    const f = join(wfDir, n);
    if (!statSync(f).isFile()) continue;
    const text = readFileSync(f, 'utf8');
    if (PUBLISH.test(text)) problems.push(`${rel(f)}: workflow publishes artifacts or releases.`);
    if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text)) problems.push(`${rel(f)}: must declare top-level "permissions: contents: read" so it cannot create releases.`);
    if (/:\s*write\b/.test(text)) problems.push(`${rel(f)}: write permissions are not allowed.`);
    if (/^\s*(release|registry_package|workflow_dispatch):/m.test(text) && /release|registry_package/.test(text.match(/^on:[\s\S]*?^\S/m)?.[0] ?? '')) problems.push(`${rel(f)}: release-triggered workflows are not allowed.`);
  }
}

if (problems.length) {
  console.error('Distribution policy violated (this project publishes no installers or packages):\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Distribution policy OK: no packaging, no publishing, all packages private, CI is read-only.');
