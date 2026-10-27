import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {NetworkProfileResult} from '../profiles/directory-query.ts';
import type {RequestStatus} from './interest-query.ts';
export type IncomingCursor={createdAt:string;id:string};
export type IncomingPorts={readDeleted?:(id:string)=>Promise<boolean>;access:()=>Promise<AccessResult>;readOwnedFlight:(flight:string,viewer:string)=>Promise<unknown>;readRows:(flight:string,after:IncomingCursor|null)=>Promise<unknown>;readPilot:(id:string)=>Promise<NetworkProfileResult>};
export type IncomingRequest={id:string;requesterId:string;note:string|null;status:RequestStatus;createdAt:string;pilot:{userId:string;displayName:string;homeAirport:string}|null;deletedPilot?:boolean};
export type IncomingResult={status:'authorized';rows:IncomingRequest[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'missing'|'invalid'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unavailable=()=>new Error('Incoming requests unavailable.');
function instant(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
 if(!match)return null;
 const canonical=`${match[1]}.${(match[2]??'').padEnd(6,'0')}Z`;
 const date=new Date(canonical);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===match[1]?canonical:null;
}
function cursor(value:unknown):IncomingCursor|null|false{
 if(value===null||value===undefined)return null;
 if(typeof value!=='string')return false;
 const parts=value.split('~');
 return parts.length===2&&instant(parts[0])===parts[0]&&uuid.test(parts[1])?{createdAt:parts[0],id:parts[1]}:false;
}
const older=(a:IncomingCursor,b:IncomingCursor)=>a.createdAt<b.createdAt||(a.createdAt===b.createdAt&&a.id<b.id);
function project(value:unknown,flight:string):IncomingRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();
 const row=value as Record<string,unknown>,createdAt=instant(row.created_at);
 if(typeof row.id!=='string'||!uuid.test(row.id)||row.flight_id!==flight||typeof row.requester_id!=='string'||!uuid.test(row.requester_id)
  ||!createdAt||typeof row.status!=='string'||!['pending','accepted','declined','withdrawn','cancelled'].includes(row.status)
  ||(row.introductory_note!==null&&(typeof row.introductory_note!=='string'||!row.introductory_note.isWellFormed()||row.introductory_note.includes('\u0000')||[...row.introductory_note].length>500)))throw unavailable();
 return {id:row.id,requesterId:row.requester_id,note:row.introductory_note as string|null,status:row.status as RequestStatus,createdAt,pilot:null};
}
function createPorts():IncomingPorts{
 // Each operation needs its own deadline: a slow optional profile lookup must
 // not abort the final ownership check or erase otherwise readable requests.
 const session=()=>import('./client.ts').then(m=>m.flightMutationClient());
 return {readDeleted:async id=>(await import('../deletion/labels.ts')).requestHasDeletedPilot(id),access:async()=>(await import('../auth/access.ts')).getAccess(),readPilot:async id=>(await import('../profiles/directory-query.ts')).getNetworkProfile(id),
  async readOwnedFlight(flight,viewer){
   const result=await(await session()).from('flights').select('id,owner_id').eq('id',flight).eq('owner_id',viewer).retry(false).maybeSingle();
   if(result.error)throw unavailable();return result.data;
  },
  async readRows(flight,after){
   let query=(await session()).from('flight_requests').select('id,flight_id,requester_id,introductory_note,status,created_at').eq('flight_id',flight).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(21);
   // Only canonical, strictly validated timestamp/UUID values enter filter syntax.
   if(after)query=query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
   const result=await query.retry(false);if(result.error)throw unavailable();return result.data;
  },
 };
}
/** Owner-only read through ordinary session RLS. Retained requester history is not an owner grant. */
export async function listIncomingRequests(flight:unknown,after:unknown=null,ports:IncomingPorts=createPorts()):Promise<IncomingResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof flight!=='string'||!uuid.test(flight.toLowerCase()))return {status:'missing'};
  const target=flight.toLowerCase(),viewer=before.member.userId,page=cursor(after);
  if(page===false)return {status:'invalid'};
  const owns=(row:unknown)=>Boolean(row&&typeof row==='object'&&'id' in row&&row.id===target&&'owner_id' in row&&row.owner_id===viewer);
  if(!owns(await ports.readOwnedFlight(target,viewer)))return {status:'missing'};
  const data=await ports.readRows(target,page);
  if(!Array.isArray(data)||data.length>21)throw unavailable();
  const rows=data.map(row=>project(row,target));let previous=page;
  const requesters=new Set<string>();
  for(const row of rows){
   if((previous&&!older(row,previous))||requesters.has(row.requesterId)||row.requesterId===viewer)throw unavailable();
   previous=row;requesters.add(row.requesterId);
  }
  const visible=rows.slice(0,20);
  const profiles=await Promise.all(visible.map(row=>ports.readPilot(row.requesterId).catch(()=>({status:'unavailable'} as const))));
  for(let i=0;i<visible.length;i++){
   const profile=profiles[i];
   if(profile.status==='unauthenticated'||profile.status==='forbidden')return {status:profile.status};
   if(profile.status==='authorized'){
    if(profile.profile.user_id!==visible[i].requesterId)throw unavailable();
    visible[i].pilot={userId:profile.profile.user_id,displayName:profile.profile.display_name,homeAirport:profile.profile.home_airport};
   }
  }
  await Promise.all(visible.filter(row=>!row.pilot).map(async row=>{if(await ports.readDeleted?.(row.id))row.deletedPilot=true;}));
  const owned=await ports.readOwnedFlight(target,viewer),current=await ports.access();
  if(current.status!=='authorized')return {status:current.status};
  if(current.member.userId!==viewer)return {status:'forbidden'};
  if(!owns(owned))return {status:'missing'};
  const last=visible.at(-1);
  return {status:'authorized',rows:visible,nextCursor:rows.length>20&&last?`${last.createdAt}~${last.id}`:null};
 }catch{return {status:'unavailable'};}
}
