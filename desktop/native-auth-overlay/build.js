'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write('native-auth: macOS native overlay build skipped\n');
  process.exit(0);
}

execFileSync('pnpm', ['exec', 'node-gyp', 'rebuild'], {
  cwd: path.resolve(__dirname),
  stdio: 'inherit',
});
