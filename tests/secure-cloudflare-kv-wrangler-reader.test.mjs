import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWranglerRead, wranglerReader } from '../scripts/secure-cloudflare-kv-wrangler-reader.mjs';
import { makeVault, inspectVault } from '../scripts/secure-cloudflare-kv-backup.mjs';
const id = 'f'.repeat(32);

test('Wrangler transport only executes pinned read-only commands with no shell and captures binary output', () => {
  let calls = 0;
  const exe = (node, args, opts) => {
    calls++;
    assert.equal(node, process.execPath);
    assert.equal(args[0], '/tmp/wrangler.js');
    assert.deepEqual(args.slice(1,4), ['kv','key','get']);
    assert.equal(args[4], 'private/key with spaces');
    assert.equal(args[5], '--namespace-id');
    assert.equal(args[6], id);
    assert.ok(args.includes('--remote'));
    assert.equal(opts.shell,false);
    assert.equal(opts.stdio[1], 'pipe');
    assert.equal(opts.windowsHide,true);
    assert.equal('CLOUDFLARE_API_TOKEN' in opts.env,false);
    return {status:0,stdout:Buffer.from([0,255,1,13,10,0])};
  };
  const before=process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN='secret-that-must-not-pass-through';
  try {
    assert.deepEqual(runWranglerRead(['get',id,'private/key with spaces'],{wranglerJs:'/tmp/wrangler.js',executor:exe}),Buffer.from([0,255,1,13,10,0]));
    assert.equal(calls,1);
  } finally { if(before===undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN=before; }
});
test('all write commands fail before child process invocation',()=>{
  for(const command of ['put','delete','bulk','remove']){
    assert.throws(()=>runWranglerRead([command,id,'test'],{wranglerJs:'/tmp/wrangler.js',executor:()=>{throw Error('NEVER INVOKE');}}),/READ_ONLY/);
  }
});
test('Wrangler list and binary value pass directly into the existing authenticated vault',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lan-wrangler-kv-'));
  const namespaces=[{binding:'STORAGE_OAUTH',id},{binding:'PORTFOLIO_MESSAGES',id:'a'.repeat(32)}];
  const binary=Buffer.from([0,255,17,0,10,19,201,37]);
  const reads=[];
  const r=await wranglerReader({runner:args=>{
    reads.push(args[0]);
    if(args[0]==='list') return Buffer.from(JSON.stringify(args[1]===id?
      [{name:'private/oauth',metadata:{note:'synthetic'},expiration:1900000000}]:[{name:'test-binary'}]));
    if(args[0]==='get') return binary;
    throw Error('WRITES FORBIDDEN');
  }});
  const path=join(dir,'private-kv.lankv');
  try{
    await makeVault(path,'TEST-ONLY-REHEARSAL-PASSPHRASE',namespaces,r.readKeys,r.readValue);
    assert.deepEqual((await inspectVault(path,'TEST-ONLY-REHEARSAL-PASSPHRASE',namespaces)).counts,{STORAGE_OAUTH:1,PORTFOLIO_MESSAGES:1});
    assert.deepEqual(reads,['list','get','list','get']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Wrangler incomplete/unparseable/failed result refuses backup',async()=>{
  const r=await wranglerReader({runner:args=>Buffer.from('not-json')});
  await assert.rejects(()=>r.readKeys(id),/LIST_FORMAT_INVALID/);
  assert.throws(()=>runWranglerRead(['list',id],{wranglerJs:'/tmp/wrangler.js',executor:()=>({status:1,stdout:Buffer.from('SENSITIVE VALUE'),stderr:Buffer.from('SENSITIVE ERROR')})}),/WRANGLER_REMOTE_KV_READ_FAILED/);
});
