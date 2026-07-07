#!/usr/bin/env node
// polyrig.mjs — the `polyrig` CLI entry point (package.json "bin").
//
// A thin dispatcher over the human-facing scripts. It exists so users never
// need to know where the package is installed or set $POLYRIG_ROOT by hand:
// `npx polyrig <subcommand>` (or a global `polyrig <subcommand>`) locates the
// package itself and forwards to the right script.
//
// Subcommands:
//   install       Install/link the PolyRig skills for your agent platforms.
//                 (default when no subcommand is given, for back-compat with
//                 `npx polyrig` / `npx polyrig install`.)
//   pack-group    Bundle a group + its members into an upload .tar.gz.
//
// Anything after the subcommand is forwarded verbatim to the target script,
// so all existing flags keep working (e.g. `polyrig install --platform codex`,
// `polyrig pack-group groups/auth --out /tmp/auth.tar.gz`).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = {
  install: 'link-skill.mjs',
  'pack-group': 'pack-group.mjs',
};

function help() {
  console.log(`usage: polyrig <command> [options]

commands:
  install       Install/link the PolyRig skills for your agent platforms (default).
                options: [--platform <name|all>] [--copy] [--force] [--home <dir>]
  pack-group    Bundle a group + its members into an upload .tar.gz.
                usage: polyrig pack-group <group.yaml | group-dir> [--roots <dir,...>] [--out <file>]

Run \`polyrig <command> --help\` for command-specific options.`);
}

const argv = process.argv.slice(2);
const first = argv[0];

if (first === '--help' || first === '-h' || first === 'help') {
  help();
  process.exit(0);
}

// Resolve the subcommand. A leading flag or no args at all means the default
// `install` (so `polyrig` and `polyrig --platform codex` still install).
let script;
let forward;
if (first !== undefined && Object.prototype.hasOwnProperty.call(SUBCOMMANDS, first)) {
  script = SUBCOMMANDS[first];
  forward = argv.slice(1);
} else if (first === undefined || first.startsWith('-')) {
  script = SUBCOMMANDS.install;
  forward = argv; // keep leading flags for link-skill.mjs
} else {
  console.error(`error: unknown command '${first}'`);
  help();
  process.exit(1);
}

const target = join(SCRIPT_DIR, script);
const result = spawnSync(process.execPath, [target, ...forward], { stdio: 'inherit' });
if (result.error) {
  console.error(`error: failed to run ${script}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 0);
