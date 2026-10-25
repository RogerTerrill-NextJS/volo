import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {NetworkProfileResult} from '../profiles/directory-query.ts';
export type ConversationCursor={createdAt:string;id:string};
export type ConversationRow={id:string;requestId:string;ownerId:string;requesterId:string;createdAt:string;closed:boolean};
export type ConversationItem=ConversationRow&{pilotName:string|null;preview:string|null;flight:{id:string;departure:string;destination:string}|null};
export type ListResult={status:'authorized';rows:ConversationItem[];nextCursor:string|null}|{[S in 'unauthenticated'|'forbidden'|'unavailable'|'invalid']:{status:S}}['unauthenticated'|'forbidden'|'unavailable'|'invalid'];
export type ListPorts={access:()=>Promise<AccessResult>;rows:(cursor:ConversationCursor|null)=>Promise<unknown>;pilot:(id:string)=>Promise<NetworkProfileResult>;preview:(id:string)=>Promise<unknown>;flight:(request:string)=>Promise<unknown>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function instant(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
 if(!match)return null;
 const result=`${match[1]}.${(match[2]??'').padEnd(6,'0')}Z`;
 return Number.isFinite(Date.parse(result))&&new Date(result).toISOString().slice(0,19)===match[1]?result:null;
}
const fail=()=>{throw Error('Conversations unavailable');};
function project(value:unknown,viewer:string):ConversationRow{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const r=value as Record<string,unknown>,createdAt=instant(r.created_at);
 if(![r.id,r.flight_request_id,r.owner_id,r.requester_id].every(id=>typeof id==='string'&&uuid.test(id))||!createdAt||r.owner_id===r.requester_id||![r.owner_id,r.requester_id].includes(viewer)||(r.closed_at!==null&&(!instant(r.closed_at)||instant(r.closed_at)!<createdAt)))return fail();
 return {id:r.id as string,requestId:r.flight_request_id as string,ownerId:r.owner_id as string,requesterId:r.requester_id as string,createdAt,closed:r.closed_at!==null};
}
function createPorts():ListPorts{
 const session=()=>import('../flights/client.ts').then(m=>m.flightMutationClient());
 return {access:async()=>(await import('../auth/access.ts')).getAccess(),pilot:async id=>(await import('../profiles/directory-query.ts')).getNetworkProfile(id),
  async rows(after){let query=(await session()).from('conversations').select('id,flight_request_id,owner_id,requester_id,created_at,closed_at').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(21);if(after)query=query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);const r=await query.retry(false);if(r.error)return fail();return r.data;},
  async preview(id){const r=await(await session()).from('messages').select('body').eq('conversation_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).retry(false).maybeSingle();if(r.error)return fail();return r.data;},
  async flight(request){const client=await session(),r=await client.from('flight_requests').select('flight_id').eq('id',request).retry(false).maybeSingle();if(r.error)return fail();if(!r.data)return null;const f=await client.from('flights').select('id,departure_airport,destination_airport').eq('id',r.data.flight_id).retry(false).maybeSingle();if(f.error)return fail();return f.data;},
 };
}
/** Ordinary session RLS for every read, including the separately permitted flight context. */
export async function listConversations(after:unknown=null,ports:ListPorts=createPorts()):Promise<ListResult>{
 try{
  const access=await ports.access();if(access.status!=='authorized')return {status:access.status};const viewer=access.member.userId;
  let cursor:ConversationCursor|null=null;
  if(after!==null&&after!==undefined){if(typeof after!=='string')return {status:'invalid'};const [date,id,...rest]=after.split('~');if(rest.length||!date||instant(date)!==date||!id||!uuid.test(id))return {status:'invalid'};cursor={createdAt:date,id};}
  const data=await ports.rows(cursor);if(!Array.isArray(data)||data.length>21)return fail();const rows=data.map(r=>project(r,viewer));let previous=cursor;const requests=new Set();
  for(const row of rows){if((previous&&!(row.createdAt<previous.createdAt||(row.createdAt===previous.createdAt&&row.id<previous.id)))||requests.has(row.requestId))return fail();requests.add(row.requestId);previous=row;}
  const visible=rows.slice(0,20);
  const names=await Promise.all(visible.map(async row=>{const id=row.ownerId===viewer?row.requesterId:row.ownerId;const profile=await ports.pilot(id).catch(()=>({status:'unavailable'} as const));if(profile.status==='authorized'){if(profile.profile.user_id!==id)return fail();return profile.profile.display_name;}if(profile.status==='forbidden'||profile.status==='unauthenticated')return fail();return null;}));
  // Optional profile reads can be slow. Re-read the retained participant bindings
  // before fetching previews and current flight visibility.
  const fresh=await ports.rows(cursor);if(!Array.isArray(fresh)||JSON.stringify(fresh.map(r=>project(r,viewer)))!==JSON.stringify(rows))return {status:'unavailable'};
  const items=await Promise.all(visible.map(async(row,i)=>{const [message,context]=await Promise.all([ports.preview(row.id),ports.flight(row.requestId)]);let preview:string|null=null,flight:ConversationItem['flight']=null;
   if(message!==null){if(!message||typeof message!=='object'||!('body'in message)||typeof message.body!=='string'||!message.body.isWellFormed()||message.body.includes('\u0000')||[...message.body].length>4000||!message.body.trim())return fail();const chars=[...message.body.replace(/\s+/gu,' ').trim()];preview=chars.slice(0,160).join('')+(chars.length>160?'…':'');}
   if(context!==null){if(!context||typeof context!=='object'||!('id'in context)||typeof context.id!=='string'||!uuid.test(context.id)||!('departure_airport'in context)||typeof context.departure_airport!=='string'||!('destination_airport'in context)||typeof context.destination_airport!=='string'||![context.departure_airport,context.destination_airport].every(v=>/^[A-Z0-9]{2,8}$/.test(v)))return fail();flight={id:context.id,departure:context.departure_airport,destination:context.destination_airport};}
   return {...row,pilotName:names[i],preview,flight};}));
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.userId!==viewer)return {status:'forbidden'};
  const last=visible.at(-1);return {status:'authorized',rows:items,nextCursor:rows.length>20&&last?`${last.createdAt}~${last.id}`:null};
 }catch{return {status:'unavailable'};}
}
