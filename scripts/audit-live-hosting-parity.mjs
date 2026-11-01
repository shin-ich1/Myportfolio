import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";

const site="https://rolando-portfolio-3f1a3.web.app";
const frozenHead="ef8ed543fb2184de40c0f197d5212bd6534d880b";
const oldHashes={
  "app.js":"d570bfd036fb6dc2a9b5a1de94c5f2cac0031257",
  "message-service.js":"764a353722a63067b0335f80c17c09fbbfc00a06",
  "styles.css":"fce337ffba12417d122a73a5cbbc86ae2a8e11a4"
};
const required=["app.js","message-service.js","styles.css","index.html","admin/index.html","config.js"];
const cfg=JSON.parse(readFileSync("firebase.json","utf8"));
const worker=JSON.parse(readFileSync("telemetry-worker/wrangler.jsonc","utf8"));
if(cfg.hosting.public!=="."||worker.name!=="lan-cloudinary-telemetry"||worker.vars.FIREBASE_PROJECT_ID!=="rolando-portfolio-3f1a3") throw Error("Wrong hosting/worker target");
const paths=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const isIgnored=path=>{
 const segments=path.split("/");
 if(segments.some(p=>p.startsWith(".")))return true;
 if(["firebase.json","firestore.rules","storage.rules","package.json","package-lock.json"].includes(path))return true;
 if(["scripts","telemetry-worker","tests"].includes(segments[0]))return true;
 if(/\.(?:md|txt|zip|pem|key|p12|pfx)$/i.test(path))return true;
 if(/credentials.*\.json$|service-account.*\.json$/i.test(path))return true;
 return false;
};
const published=paths.filter(p=>!isIgnored(p));
if(required.some(p=>!published.includes(p)))throw Error("Required published files missing");
if(published.length<170||published.length>400)throw Error("Unexpected publishing inventory size: "+published.length);
const blob=bytes=>createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const expected=Object.fromEntries(published.map(p=>[p,oldHashes[p]||blob(readFileSync(p))]));
const results=[];
const normalizedOnly=[];
let cursor=0;
async function workerCheck(){
 while(cursor<published.length){
  const path=published[cursor++];
  const url=site+"/"+path.split("/").map(encodeURIComponent).join("/")+"?audit="+randomUUID();
  try{
   const res=await fetch(url,{headers:{"cache-control":"no-cache"},signal:AbortSignal.timeout(20000)});
   if(!res.ok)throw Error("HTTP "+res.status);
   const bytes=Buffer.from(await res.arrayBuffer());
   const actual=blob(bytes);
   const contentType=(res.headers.get("content-type")||"").toLowerCase();
   const isText=/^(text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/.test(contentType) || (/\.webmanifest$/.test(path) && /json/.test(contentType));
   // GitHub Actions' fetch network can return CRLF where the owner's curl
   // and GitHub source blobs use LF. Tolerate only an exact CRLF-to-LF conversion:
   // NO whitespace trimming, reformatting, CSS rewriting or ignored differences.
   let equivalent=actual===expected[path];
   let normalizedHash=null;
   if(!equivalent && isText && bytes.includes(Buffer.from("\r\n"))) {
     const normalized=Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
     normalizedHash=blob(normalized);
     if(normalizedHash===expected[path]) {
       equivalent=true;
       normalizedOnly.push(path);
     }
   }
   if(["admin/index.html","admin/admin.css","admin/manifest.webmanifest","app.js","styles.css","index.html"].includes(path)) {
     console.log("SAMPLE",path,"status",res.status,"type",contentType,"bytes",bytes.length,
       "raw",actual,"normalized",normalizedHash||"none","expected",expected[path],
       "result",equivalent?"MATCH":"MISMATCH");
   }
   if(!equivalent)results.push({path,actual,normalizedHash,expected:expected[path],error:"different published content"});
  }catch(error){results.push({path,error:String(error?.message||error)});}
 }
}
await Promise.all(Array.from({length:10},()=>workerCheck()));
console.log("LIVE Hosting tracked-file parity with fresh per-file cache-busters; site:",site);
console.log("Checked:",published.length,"Unchanged expected:",published.length-3,"Allowed planned changes: app.js, message-service.js, styles.css");
console.log("Line-ending-only equal files:",normalizedOnly.length);
console.log("Unexpected mismatches:",results.length);
console.log("Mismatches grouped by top-level folder:",Object.entries(Object.groupBy(results,r=>r.path.split("/")[0])).map(([k,v])=>k+":"+v.length).join(" "));
for(const r of results.slice(0,35))console.log("MISMATCH",r.path,r.error,"live:",r.actual||"download-failed","CRLF-normalized:",r.normalizedHash||"n/a","expected:",r.expected||"n/a");
if(results.length)throw Error("STOP: candidate would change or lose published files beyond authorized three; investigate remote-only assets separately.");
console.log("READ-ONLY LIVE HOSTING TRACKED-FILE PARITY: PASS; remote-only deployment assets still require release-manifest review");
