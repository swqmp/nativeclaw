#!/usr/bin/env node

/**
 * NativeClaw v1.10.x → v2.0 Migration Script
 * Copies new files, preserves existing config/workspace, updates launchd/bridge.
 * Usage: node scripts/apply-v2.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE;
const V2_ROOT = path.resolve(__dirname, '..');
const BRIDGE_DIR = path.join(HOME, '.claude', 'telegram-bridge');
const WORKSPACE = path.join(HOME, '.claude', 'workspace');

const DRY_RUN = process.argv.includes('--dry-run');

function log(msg) {
  if (DRY_RUN) console.log(`[DRY RUN] ${msg}`);
  else console.log(msg);
}

function copy(src, dst) {
  if (DRY_RUN) { log(`Would copy ${path.relative(V2_ROOT, src)} → ${dst}`); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, fs.readFileSync(src));
  log(`Copied ${path.relative(V2_ROOT, src)} → ${dst}`);
}

function main() {
  console.log(`${DRY_RUN ? 'DRY RUN' : 'LIVE'} — NativeClaw v1.10 → v2.0 Migration\n`);

  // 1. Preserve existing config (only if missing)
  const configSrc = path.join(V2_ROOT, 'static', 'default-config.json');
  const configDst = path.join(BRIDGE_DIR, 'config.json');
  if (fs.existsSync(configDst)) {
    log('Config.json already exists — preserved.');
  } else {
    copy(configSrc, configDst);
  }

  // 2. Copy cron schedule skeleton (only if missing)
  const cronSrc = path.join(V2_ROOT, 'static', 'default-cron-schedule.json');
  const cronDst = path.join(HOME, '.claude', 'cron-schedule.json');
  if (fs.existsSync(cronDst)) {
    log('cron-schedule.json already exists — preserved.');
  } else {
    copy(cronSrc, cronDst);
  }

  // 3. Copy MCP config skeleton (only if missing)
  const mcpSrc = path.join(V2_ROOT, 'static', 'default-mcp-config.json');
  const mcpDst = path.join(HOME, '.claude', '.mcp.json');
  if (fs.existsSync(mcpDst)) {
    log('.mcp.json already exists — preserved.');
  } else {
    copy(mcpSrc, mcpDst);
  }

  // 4. Set up TASK scheduler / launchd entries (only if missing)
  if (process.platform === 'darwin') {
    const plistSrc = path.join(HOME, 'Library', 'LaunchAgents', 'com.njdev.nativeclaw.plist');
    if (!fs.existsSync(plistSrc)) {
      log('LaunchAgent not found. Run `nativeclaw setup` to generate.');
    } else {
      log('LaunchAgent already present.');
    }
  }

  // 5. Rebuild from TypeScript
  log('Running `npm run build`...');
  if (!DRY_RUN) {
    execSync('npm run build', { cwd: V2_ROOT, stdio: 'inherit' });
  }

  // 6. Update PATH symlink
  const localBin = path.join(HOME, '.local', 'bin');
  const linkSrc = path.join(V2_ROOT, 'bin', 'nativeclaw');
  const linkDst = path.join(localBin, 'nativeclaw');
  if (!fs.existsSync(linkDst)) {
    log(`Symlinking ${linkSrc} → ${linkDst}`);
    if (!DRY_RUN) {
      fs.mkdirSync(localBin, { recursive: true });
      fs.symlinkSync(linkSrc, linkDst);
    }
  }

  console.log('\n✅ Migration complete.');
  if (DRY_RUN) console.log('This was a dry run. Remove --dry-run to apply.');
  else console.log('Run `nativeclaw status` to verify the bridge is alive.');
}

main();
