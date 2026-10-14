import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalNamespaces, makeVault, inspectVault, cloudflareReader, safeBackupFailureCode } from '../scripts/secure-cloudflare-kv-backup.mjs';

test('canonical config lists exactly two nonsecurity KV bindings', async () => {
  const bindings = await canonicalNamespaces();
  assert.deepEqual(bindings.map(x => x.binding), ['STORAGE_OAUTH','PORTFOLIO_MESSAGES']);
  assert.equal(new Set(bindings.map(x => x.id)).size, 2);
});
test('encrypted KV vault restores binary value, metadata and expiration integrity; rejects tampering and wrong passphrase', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lan-kv-test-'));
  const namespaces = [{ binding: 'STORAGE_OAUTH', id: 'a'.repeat(32) },{ binding: 'PORTFOLIO_MESSAGES', id: 'b'.repeat(32) }];
  const keys = new Map([
    [namespaces[0].id, [{name:'oauth/profile/ä',metadata:{owner:'test-only'},expiration:1900000000}]],
    [namespaces[1].id, [{name:'binary',metadata:{contentType:'application/octet-stream'}}]]
  ]);
  const expected = new Map([[namespaces[0].id, Buffer.from('TEST-ONLY PRIVATE CONTENT')],[namespaces[1].id,Buffer.from([0,255,0,12,32,255])]]);
  const pw = 'synthetic-only-passphrase-32';
  try {
    const target = join(dir, 'private.lankv');
    const result = await makeVault(target,pw,namespaces,async id=>keys.get(id),async(id)=>expected.get(id));
    assert.deepEqual(result.counts,{STORAGE_OAUTH:1,PORTFOLIO_MESSAGES:1});
    assert.equal((await inspectVault(target,pw,namespaces)).verified,true);
    const bytes=await readFile(target);
    assert.equal(bytes.includes(expected.get(namespaces[0].id)),false);
    assert.equal(bytes.includes(expected.get(namespaces[1].id)),false);
    await assert.rejects(() => inspectVault(target,'not-the-same-passphrase',namespaces),/integrity|passphrase/);
    const corrupted=Buffer.from(bytes);
    corrupted[corrupted.length-1]^=1;
    const damaged=join(dir,'corrupt.lankv');
    await writeFile(damaged,corrupted);
    await assert.rejects(() => inspectVault(damaged,pw,namespaces),/integrity/);
    await assert.rejects(() => makeVault(target,pw,namespaces,async id=>keys.get(id),async id=>expected.get(id)),/EEXIST/);
    assert.deepEqual(await readFile(target),bytes);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('fail closed if any key disappeared or inventories duplicated', async () => {
  const dir=await mkdtemp(join(tmpdir(),'lan-kv-reject-'));
  const namespaces=[{binding:'STORAGE_OAUTH',id:'a'.repeat(32)},{binding:'PORTFOLIO_MESSAGES',id:'b'.repeat(32)}];
  try {
    await assert.rejects(()=>makeVault(join(dir,'a.lankv'),'abcdefghijklmnop',namespaces,async()=>[{name:'x'},{name:'x'}],async()=>Buffer.from('x')),/duplicate/);
    await assert.rejects(()=>makeVault(join(dir,'b.lankv'),'abcdefghijklmnop',namespaces,async()=>[{name:'gone'}],async()=>null),/missing/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Cloudflare reader uses GET-only, cursor pagination, and preserves raw binary payload',async()=>{
  const old=globalThis.fetch;
  const verbs=[];
  const id='f'.repeat(32),acct='e'.repeat(32);
  globalThis.fetch=async(url,opts)=>{
    verbs.push(opts.method);
    const link=String(url);
    if(link.endsWith('/values/my%2Fkey')) return new Response(Uint8Array.from([0,255,7]),{status:200});
    if(link.includes('cursor=continuation')) return Response.json({success:true,result:[{name:'my/key'}],result_info:{}});
    return Response.json({success:true,result:[{name:'first'}],result_info:{cursor:'continuation'}});
  };
  try{
    const reader=await cloudflareReader(acct,'synthetic-token-not-real');
    assert.deepEqual((await reader.readKeys(id)).map(x=>x.name),['first','my/key']);
    assert.deepEqual(await reader.readValue(id,'my/key'),Buffer.from([0,255,7]));
    assert.deepEqual(verbs,['GET','GET','GET']);
  }finally{globalThis.fetch=old;}
});

test('safe diagnostics identify local problems and HTTP statuses without printing provider data', () => {
  assert.equal(safeBackupFailureCode(Error('Passphrases do not match.')), 'PASSPHRASE_CONFIRMATION_MISMATCH');
  assert.equal(safeBackupFailureCode(Error('A private passphrase of at least 16 characters is required.')), 'PASSPHRASE_TOO_SHORT');
  assert.equal(safeBackupFailureCode(Error('Cloudflare KV READ failed: HTTP 403 (no data printed).')), 'CLOUDFLARE_KV_READ_HTTP_403');
  assert.equal(safeBackupFailureCode(Error('Cloudflare KV READ failed: HTTP 401 (no data printed).')), 'CLOUDFLARE_KV_READ_HTTP_401');
  assert.equal(safeBackupFailureCode(Object.assign(Error('secret-value-must-not-appear'),{code:'EEXIST'})), 'LOCAL_ARCHIVE_ALREADY_EXISTS');
  assert.equal(safeBackupFailureCode(Error('SECRET MUST NEVER DISPLAY HERE')), 'OTHER_LOCAL_OR_NETWORK_ERROR');
});
