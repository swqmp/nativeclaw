#!/usr/bin/env node

/**
 * NativeClaw Bridge Integrator
 * A thin migration script that patches the live bridge.js to use V2 libs.
 * Run once after V2 is built.
 */

const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'telegram-bridge', 'bridge.js'
);
const V2_LIB = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'workspace', 'projects', 'nativeclaw', 'v2', 'dist', 'lib'
);

function patchBridge() {
  if (!fs.existsSync(BRIDGE_PATH)) {
    console.error('bridge.js not found at:', BRIDGE_PATH);
    process.exit(1);
  }

  let bridge = fs.readFileSync(BRIDGE_PATH, 'utf8');

  // Inject V2 compaction module require at top
  const compRequire = `const { ContextCompaction, MODEL_COMPACTION_THRESHOLDS } = require('${V2_LIB}/compaction');\n`;
  if (!bridge.includes('ContextCompaction')) {
    bridge = bridge.replace(
      "const { runOpenCode } = require('./bridge-opencode');",
      compRequire + "const { runOpenCode } = require('./bridge-opencode');"
    );
  }

  // Replace inline MODEL_COMPACTION_THRESHOLDS with V2 import
  bridge = bridge.replace(
    /const MODEL_COMPACTION_THRESHOLDS\s*=\s*\{[\s\S]*?\};/,
    '// MODEL_COMPACTION_THRESHOLDS imported from v2 compaction module'
  );

  fs.writeFileSync(BRIDGE_PATH, bridge);
  console.log('✅ bridge.js patched with V2 compaction module');
}

function dryRun() {
  console.log('--- V2 Integration Dry Run ---');
  console.log('Bridge path:', BRIDGE_PATH, '(exists:', fs.existsSync(BRIDGE_PATH), ')');
  console.log('V2 lib path:', V2_LIB, '(exists:', fs.existsSync(V2_LIB), ')');
  console.log('');
  console.log('To patch, run: node v2/integrator.js --apply');
}

const apply = process.argv.includes('--apply');
if (apply) {
  patchBridge();
} else {
  dryRun();
}
