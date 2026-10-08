// Conservative test policy model, not a Netlify runtime emulator.
export function createSharedCache() {
  const entries=new Map();
  const copy=reply=>({...reply,headers:new Headers(reply.headers)});
  return {
    size:()=>entries.size,
    async request(key,load) {
      const cached=entries.get(key);
      if(cached && cached.until>Date.now()) return {reply:copy(cached.reply),hit:true};
      entries.delete(key);
      const reply=await load();
      const policy=reply.headers.get("Netlify-CDN-Cache-Control") ?? reply.headers.get("CDN-Cache-Control") ?? reply.headers.get("Cache-Control") ?? "";
      const directives=new Map(policy.toLowerCase().split(",").map(part=>part.trim().split("=").map(x=>x.trim())));
      const ttl=Number(directives.get("s-maxage") ?? directives.get("max-age") ?? 0);
      if(reply.status===200 && directives.has("public") && !["private","no-store","no-cache"].some(key=>directives.has(key)) && Number.isFinite(ttl) && ttl>0) {
        entries.set(key,{reply:copy(reply),until:Date.now()+ttl*1000});
      }
      return {reply:copy(reply),hit:false};
    },
  };
}
