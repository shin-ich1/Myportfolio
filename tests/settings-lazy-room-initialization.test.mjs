import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src=readFileSync(new URL('../admin/js/settings.js',import.meta.url),'utf8');
const a=src.indexOf('const settingsRoomStartupTasks = new Map();');
const b=src.indexOf('async function start() {',a);
test('Settings expensive initialization is routed to the selected room only',async()=>{
  assert.ok(a>=0&&b>a,'Missing canonical lazy Settings room-data owner');
  const source=src.slice(a,b);
  const calls=[];
  const ctx={
    renderStorageHub:async()=>calls.push('storage'),
    loadInitialization:async()=>calls.push('initialization'),
    renderModuleLifecycleSummary:async()=>calls.push('lifecycle'),
    console:{error:()=>{}},
    state:{startupErrors:[]},
    window:{LANNotice:()=>{}}
  };
  const {startSettingsRoomData}=runInNewContext(source+'\n({startSettingsRoomData})',ctx);
  await startSettingsRoomData('security');
  await startSettingsRoomData('advanced');
  await startSettingsRoomData('backup');
  assert.equal(calls.length,0,'Security/Diagnostics/Vault must not read unrelated collections');
  await Promise.all([startSettingsRoomData('general'),startSettingsRoomData('general')]);
  assert.deepEqual(calls,['storage'],'Control loads its Storage Hub once');
  await Promise.all([startSettingsRoomData('portfolio'),startSettingsRoomData('portfolio')]);
  assert.deepEqual(calls,['storage','initialization','lifecycle'],'Publish initializes once');
});

test('Settings startup and tab navigation share on-demand owner, never eagerly scan all rooms',()=>{
  assert.match(src,/settingsRoomNav\?\.addEventListener\("lan:tabchange"[\s\S]{0,410}startSettingsRoomData\(room\)/);
  const startup=src.slice(src.indexOf('async function start() {'));
  assert.doesNotMatch(startup,/\["module lifecycle",\s*renderModuleLifecycleSummary\]/);
  assert.doesNotMatch(startup,/\["storage hub",\s*renderStorageHub\]/);
  assert.doesNotMatch(startup,/\["initialization state",\s*loadInitialization\]/);
  assert.match(startup,/startSettingsRoomData\(document\.body\.dataset\.settingsRoom\s*\|\|\s*"general"\)/);
});
