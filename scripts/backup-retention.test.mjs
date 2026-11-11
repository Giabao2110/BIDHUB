import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {retainBackups} from './backup-retention.mjs';
test('retention defaults to dry-run, preserves newest and ignores unrelated files/subdirectories',async()=>{
  const path = await realpath(await mkdtemp(join(tmpdir(),'bidhub-retention-')));
  try {
    const names=['bidhub-20261101T020000Z.dump','bidhub-20261102T020000Z.dump','bidhub-20261103T020000Z.dump'];
    for(const name of names) await writeFile(join(path,name),'test archive');
    await writeFile(join(path,'manual-backup.dump'),'preserve');
    await mkdir(join(path,'bidhub-20261001T020000Z.dump'));
    assert.deepEqual((await retainBackups(path,2)).candidates,[names[0]]);
    assert.equal((await readdir(path)).length,5);
    await retainBackups(path,2,true);
    assert.deepEqual((await readdir(path)).sort(),['bidhub-20261001T020000Z.dump',names[1],names[2],'manual-backup.dump'].sort());
    await assert.rejects(retainBackups(path,0));
  } finally {await rm(path,{recursive:true,force:true});}
});
