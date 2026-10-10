import 'server-only';
import {confirmationDigest} from './invitation-confirmation-crypto.ts';
export function completionCsrf(cookie:string):string{return confirmationDigest('volo-completion-csrf-v1:'+cookie);}
export async function readCompletionInput(request:Request):Promise<{password:string;passwordConfirmation:string;csrf:string}|null>{
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))return null;
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>4096)){void request.body?.cancel().catch(()=>{});return null;}
 const reader=request.body?.getReader();if(!reader)return null;let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error()),5000);});
 try{
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.byteLength;if(size>4096)throw new Error();chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  // URLSearchParams silently replaces invalid UTF8 percent sequences; reject them.
  for(const part of text.split('&'))for(const value of part.split('='))decodeURIComponent(value.replaceAll('+',' '));
  const pairs=[...new URLSearchParams(text)],fields=new Map(pairs);
  if(pairs.length!==3||fields.size!==3||!['password','passwordConfirmation','csrf'].every(k=>fields.has(k)))return null;
  const password=fields.get('password')!,passwordConfirmation=fields.get('passwordConfirmation')!,csrf=fields.get('csrf')!;
  if(password!==passwordConfirmation||[...password].length<8||Buffer.byteLength(password,'utf8')>256||!/^[a-f0-9]{64}$/.test(csrf))return null;
  return {password,passwordConfirmation,csrf};
 }catch{void reader.cancel().catch(()=>{});return null;}finally{clearTimeout(timer);reader.releaseLock();}
}
