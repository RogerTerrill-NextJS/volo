import 'server-only';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
export type ConfirmationPayload={tokenHash:string;type:'invite'|'recovery';resume:string|null;csrf:string;flow?:'recovery'};
export type ConfirmationPayloadWithoutCsrf=Omit<ConfirmationPayload,'csrf'>;
export type Binding={lookupDigest:string;origin:string;expiresAt:string};
export type ConfirmationEnvelope={keyId:string;nonce:string;ciphertext:string;tag:string;expiresAt:string};
const unavailable=()=>new Error('Confirmation service unavailable.');
export function newConfirmationSecret():string{return randomBytes(32).toString('base64url');}
export function confirmationDigest(secret:string):string{return createHash('sha256').update(secret).digest('hex');}
function decode(value:unknown,size?:number):Buffer{
 if(typeof value!=='string'||value.length>2048||!value.length)throw unavailable();
 const bytes=Buffer.from(value,'base64url');
 if(bytes.toString('base64url')!==value||(size!==undefined&&bytes.length!==size))throw unavailable();
 return bytes;
}
export function isConfirmationSecret(value:unknown):value is string{
 try{return decode(value,32).length===32;}catch{return false;}
}
function keys():{active:string;keys:Record<string,Buffer>}{
 try{
  const raw=process.env.VOLO_CONFIRMATION_KEYS;if(!raw||raw.length>1024)throw unavailable();
  const parsed=JSON.parse(raw),result:Record<string,Buffer>=Object.create(null);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).sort().join(',')!=='active,keys'
   ||typeof parsed.active!=='string'||!parsed.keys||typeof parsed.keys!=='object'||Array.isArray(parsed.keys)
   ||Object.keys(parsed.keys).length<1||Object.keys(parsed.keys).length>2)throw unavailable();
  for(const [id,value] of Object.entries(parsed.keys)){
   if(!/^[A-Za-z0-9_-]{1,32}$/.test(id)||typeof value!=='string')throw unavailable();
   const bytes=Buffer.from(value,'base64');if(bytes.length!==32||bytes.toString('base64')!==value)throw unavailable();result[id]=bytes;
  }
  if(!Object.hasOwn(result,parsed.active))throw unavailable();return {active:parsed.active,keys:result};
 }catch{throw unavailable();}
}
function aad(binding:Binding):Buffer{
 if(!/^[a-f0-9]{64}$/.test(binding.lookupDigest)||!Number.isFinite(Date.parse(binding.expiresAt))
  ||new Date(binding.expiresAt).toISOString()!==binding.expiresAt)throw unavailable();
 const url=new URL(binding.origin);if(url.origin!==binding.origin||!['https:','http:'].includes(url.protocol))throw unavailable();
 return Buffer.from(JSON.stringify(['volo-confirmation-v1',binding.lookupDigest,binding.origin,binding.expiresAt]));
}
function validPayload(raw:unknown):raw is ConfirmationPayload{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;const p=raw as ConfirmationPayload;
 return ['csrf,resume,tokenHash,type','csrf,flow,resume,tokenHash,type'].includes(Object.keys(p).sort().join(','))&&typeof p.tokenHash==='string'
  &&/^[A-Za-z0-9_-]{1,256}$/.test(p.tokenHash)&&['invite','recovery'].includes(p.type)
  &&(p.resume===null||isConfirmationSecret(p.resume))&&(p.flow==='recovery'?p.type==='recovery'&&p.resume===null:p.flow===undefined&&(p.type!=='recovery'||p.resume!==null))&&isConfirmationSecret(p.csrf);
}
export function sealConfirmation(payload:ConfirmationPayload,binding:Binding):ConfirmationEnvelope{
 try{
  if(!validPayload(payload))throw unavailable();const configured=keys(),nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',configured.keys[configured.active],nonce);cipher.setAAD(aad(binding));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return {keyId:configured.active,nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),expiresAt:binding.expiresAt};
 }catch{throw unavailable();}
}
export function openConfirmation(envelope:ConfirmationEnvelope,binding:Binding):ConfirmationPayload|null{
 try{
  if(envelope.expiresAt!==binding.expiresAt||Date.parse(binding.expiresAt)<=Date.now())return null;
  const configured=keys();if(!Object.hasOwn(configured.keys,envelope.keyId))return null;
  const decipher=createDecipheriv('aes-256-gcm',configured.keys[envelope.keyId],decode(envelope.nonce,12));
  decipher.setAAD(aad(binding));decipher.setAuthTag(decode(envelope.tag,16));
  const plaintext=Buffer.concat([decipher.update(decode(envelope.ciphertext)),decipher.final()]);
  const payload=JSON.parse(plaintext.toString('utf8'));return validPayload(payload)?payload:null;
 }catch{return null;}
}
