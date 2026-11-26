import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [candidatePath, currentPath, project] = process.argv.slice(2);
if (!candidatePath || !currentPath || !/^bidhub-release-lab-[a-z0-9-]+$/.test(project ?? '')) {
  throw new Error('Usage: node scripts/release-lab.mjs CANDIDATE CURRENT bidhub-release-lab-NAME');
}
const port = process.env.BIDHUB_LAB_PORT ?? '18080';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error('Invalid loopback lab port');
}
const origin = 'http://127.0.0.1:' + port;
const env = { ...process.env, WEB_ORIGIN: origin, BIDHUB_LAB_PORT: port };
const compose = ['compose', '-p', project, '-f', 'infra/compose.app.yaml', '-f', 'infra/compose.release-lab.yaml'];
const state = resolve(currentPath);
const lock = state + '.lock';

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {
    env, stdio: 'inherit', timeout: 150_000, ...settings,
  });
  if (result.error || result.status !== 0) throw new Error(command + ' failed', { cause: result.error });
  return result.stdout?.trim();
}

function manifest(path) {
  const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  for (const service of ['api', 'web']) {
    const image = value[service];
    if (!image || !/^[a-z0-9][a-z0-9./:@_-]+$/i.test(image.ref ?? '') ||
        !/^sha256:[a-f0-9]{64}$/.test(image.id ?? '')) throw new Error('Invalid ' + service + ' image manifest');
    const observed = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image.ref],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    if (observed !== image.id) throw new Error('Unexpected image ID for ' + service);
  }
  return value;
}

function deploy(pair) {
  const releaseEnv = { ...env, BIDHUB_API_IMAGE: pair.api.ref, BIDHUB_WEB_IMAGE: pair.web.ref };
  run('docker', [...compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '75', 'api', 'web'],
    { env: releaseEnv });
  for (const name of ['api', 'web']) {
    const id = run('docker', [...compose, 'ps', '-q', name],
      { env: releaseEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const observed = run('docker', ['inspect', '--format', '{{.Image}}', id],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    if (observed !== pair[name].id) throw new Error('Running ' + name + ' image mismatch');
  }
  run(process.execPath, ['scripts/smoke-compose.mjs'], { env: releaseEnv });
  run(process.execPath, ['--input-type=module', '-e',
    "const r=await fetch(process.env.WEB_ORIGIN+'/api/v1/auctions',{signal:AbortSignal.timeout(5000)}); if(!r.ok || !Array.isArray((await r.json()).items)) process.exit(1);"],
    { env: releaseEnv });
}

mkdirSync(lock);
try {
  const candidate = manifest(candidatePath);
  const previous = manifest(state);
  const started = Date.now();
  try {
    deploy(candidate);
    const pending = state + '.next';
    writeFileSync(pending, JSON.stringify(candidate, null, 2) + '\n');
    renameSync(pending, state);
    console.log('Release verified and promoted');
  } catch (error) {
    console.error('Candidate failed: ' + error.message);
    try {
      deploy(previous);
      console.log('Previous pair restored and verified after ' + (Date.now() - started) + ' ms from start');
      process.exitCode = 1;
    } catch (rollbackError) {
      console.error('Rollback verification failed: ' + rollbackError.message);
      process.exitCode = 2;
    }
  }
} finally {
  rmdirSync(lock);
}
