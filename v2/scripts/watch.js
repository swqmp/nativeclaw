// NativeClaw v2.0 — TypeScript compilation watcher
// Usage: node scripts/watch.js  (or npm run dev)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');

function run(cmd, args) {
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`Command "${cmd}" exited with code ${code}`);
      process.exit(code);
    }
  });
}

console.log('Starting TypeScript watch mode...');
run('npx', ['tsc', '--watch', '-p', TSCONFIG]);
