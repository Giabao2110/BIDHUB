import { lstat, readdir, unlink, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only regular BIDHUB timestamped archives, no recursion or symlink traversal. */
export async function retainBackups(directory, keep = 7, apply = false) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a positive integer');
  const path = resolve(directory);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Directory must be a real directory');
  if (await realpath(path) !== path) throw new Error('Directory must be its canonical path');
  const entries = await readdir(path, {withFileTypes:true});
  const archives = entries.filter(e=>e.isFile() && /^bidhub-\d{8}T\d{6}Z\.dump$/.test(e.name)).map(e=>e.name).sort().reverse();
  const candidates = archives.slice(keep);
  if (apply) for (const name of candidates) {
    const target = join(path,name);
    // Recheck entry immediately before unlink; unlink never recursively follows links.
    const current = await lstat(target);
    if (!current.isFile() || current.isSymbolicLink()) throw new Error('Archive entry changed');
    await unlink(target);
  }
  return {mode:apply?'apply':'dry-run',keep,total:archives.length,candidates};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, count='7', flag] = process.argv.slice(2);
  if (!directory || (flag && flag !== '--apply')) throw new Error('Usage: node scripts/backup-retention.mjs /canonical/backup/directory [keep=7] [--apply]');
  console.log(JSON.stringify(await retainBackups(directory,Number(count),flag==='--apply'),null,2));
}
