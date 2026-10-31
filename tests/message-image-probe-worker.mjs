// Workerd-only external image probe. No real secrets or production calls.
const originals=[
  ["landscape","Landscape-3773899_1280.jpg","7/72"],
  ["chitkul","Chitkul.JPG","4/4e"],
  ["yosemite","Yosemite_valley_and_half_dome_from_glacier_point.jpg","6/6b"]
];
export default { async fetch(request) {
  if (new URL(request.url).pathname !== "/probe") return new Response("Not found",{status:404});
  const responses=[];
  for (const [name,file,hash] of originals) {
    const encoded=encodeURIComponent(file);
    const urls=[
      "https://commons.wikimedia.org/wiki/Special:FilePath/"+encoded+"?width=1024",
      "https://upload.wikimedia.org/wikipedia/commons/thumb/"+hash+"/"+encoded+"/1024px-"+encoded
    ];
    for(const [index,url] of urls.entries()){
      const started=Date.now();
      try {
        const res=await fetch(url,{
          headers:{"Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8"},
          redirect:"follow",signal:AbortSignal.timeout(7000)
        });
        responses.push({name,variant:index===0?"commons-redirect":"upload-direct",
          status:res.status,type:res.headers.get("content-type"),ms:Date.now()-started,
          finalHost:new URL(res.url).host});
        try { await res.body?.cancel(); } catch {}
      }catch(e){responses.push({name,variant:index===0?"commons-redirect":"upload-direct",
        error:e.name||"FetchError",ms:Date.now()-started});}
    }
  }
  return new Response(JSON.stringify(responses),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}};
