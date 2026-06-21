#!/usr/bin/env node

/**
 * NativeClaw Bridge Integrator
 *
 * Deprecated in v2.0.1 cleanup:
 * - The old version patched the live bridge to import v2/lib/compaction.
 * - That module was removed because live bridge-owned compaction is the
 *   maintained implementation.
 *
 * Keep this file as a guarded no-op so stale docs or habits cannot corrupt the
 * live bridge by injecting deleted module imports.
 */

const path = require('path');

const BRIDGE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'telegram-bridge', 'bridge.js'
);

function patchBridge() {
  console.error('Refusing to patch bridge.js.');
  console.error('v2/lib/compaction was removed; bridge-owned inline compaction is the supported path.');
  console.error(`Bridge path left untouched: ${BRIDGE_PATH}`);
  process.exit(1);
}

function dryRun() {
  console.log('--- V2 Integration Dry Run ---');
  console.log('Bridge path:', BRIDGE_PATH);
  console.log('No patch is needed. This script is deprecated and guarded.');
  console.log('');
  console.log('To update a live bridge, mirror bridge/bridge.js and helper modules directly, then restart the service.');
}

const apply = process.argv.includes('--apply');
if (apply) {
  patchBridge();
} else {
  dryRun();
}
