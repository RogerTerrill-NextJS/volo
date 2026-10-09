import 'server-only';
import {isConfirmationSecret,type ConfirmationPayloadWithoutCsrf} from './invitation-confirmation-crypto.ts';
export function parseConfirmationLink(url:URL):ConfirmationPayloadWithoutCsrf|null{
 if(url.href.length>2048||url.hash)return null;const seen=new Set<string>();
 for(const [name] of url.searchParams){if(!['token_hash','type','flow','resume'].includes(name)||seen.has(name))return null;seen.add(name);}
 const tokenHash=url.searchParams.get('token_hash'),type=url.searchParams.get('type'),resume=url.searchParams.get('resume'),flow=url.searchParams.get('flow');
 if(!tokenHash||!/^[A-Za-z0-9_-]{1,256}$/.test(tokenHash)||(type!=='invite'&&type!=='recovery')
  ||(flow!==null&&flow!=='invitation')||(resume!==null&&!isConfirmationSecret(resume))||(type==='recovery'&&resume===null))return null;
 return {tokenHash,type,resume};
}
export async function readConfirmationCsrf(request:Request):Promise<string|null>{
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))return null;
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>1024)){void request.body?.cancel().catch(()=>{});return null;}
 const reader=request.body?.getReader();if(!reader)return null;let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Invalid confirmation input.')),5000);});
 try{
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const chunk=await Promise.race([reader.read(),deadline]);if(chunk.done)break;size+=chunk.value.byteLength;if(size>1024)throw new Error();chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/%(?![a-f0-9]{2})/i.test(text))return null;
  const pairs=[...new URLSearchParams(text)];return pairs.length===1&&pairs[0][0]==='csrf'&&isConfirmationSecret(pairs[0][1])?pairs[0][1]:null;
 }catch{void reader.cancel().catch(()=>{});return null;}finally{clearTimeout(timer);reader.releaseLock();}
}
