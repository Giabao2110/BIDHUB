import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}
check('Node.js', Number(process.versions.node.split('.')[0]) === 24, process.versions.node);
check('Dependencies', existsSync(new URL('../node_modules/typescript/package.json', import.meta.url)), 'run npm ci if missing');
check('Local configuration', existsSync(new URL('../.env', import.meta.url)), 'copy .env.example to .env if missing');
const version = spawnSync('docker', ['compose', 'version', '--short'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
check('Docker Compose', version.status === 0, version.status === 0 ? version.stdout.trim() : 'install Docker Desktop with Compose v2');
const engine = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
check('Docker Engine', engine.status === 0, engine.status === 0 ? engine.stdout.trim() : 'start Docker Desktop in Linux containers mode');
console.log('Checks are read-only; this does not verify migrations, application flows or a production deployment.');
process.exitCode = failures ? 1 : 0;
