/* Runs every browser test in turn and stops at the first failure. */
const { spawnSync } = require('child_process');
const path = require('path');
for (const f of ['smoke.js', 'learner.js', 'learn.js', 'studio.js', 'gameplay.js', 'phone.js', 'topics.js']) {
  console.log('---', f);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').slice(-6).join('\n'));
  if (r.status !== 0 || /\b(FAIL|FATAL)\b|errors [1-9]|fails [1-9]/.test(r.stdout + r.stderr)) { console.error(r.stderr.slice(-1500)); process.exit(1); }
}
console.log('all browser tests passed');
