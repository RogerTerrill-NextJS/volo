import 'server-only';
import type {AccessResult,ActiveMember} from '../auth/access.ts';
export type RequestStatus='pending'|'accepted'|'withdrawn'|'declined'|'cancelled';
export type InterestQueryPorts={access:()=>Promise<AccessResult>;readRequest:(flight:string,viewer:string)=>Promise<unknown>;readVisibleFlight:(id:string)=>Promise<unknown>;readProfile:(member:ActiveMember)=>Promise<'complete'|'missing'|'unavailable'>};
export type InterestQueryResult={status:'authorized';requestStatus:RequestStatus|'none'|'unavailable';requestId?:string;profileStatus:'complete'|'missing'|'unavailable'}|{status:'unauthenticated'|'forbidden'|'unavailable'|'missing'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function createPorts():InterestQueryPorts{
 let client:ReturnType<typeof import('./client.ts')['flightMutationClient']>|undefined;
 const sessionClient=()=>client??=(import('./client.ts').then(m=>m.flightMutationClient()));
 return {
  access:async()=>(await import('../auth/access.ts')).getAccess(),
  readProfile:async member=>(await import('../profiles/query.ts')).getOwnProfileStatus(member),
  async readRequest(flight,viewer){
   const result=await(await sessionClient()).from('flight_requests').select('id,flight_id,requester_id,status').eq('flight_id',flight).eq('requester_id',viewer).retry(false).maybeSingle();
   if(result.error)throw Error('Request status unavailable');return result.data;
  },
  async readVisibleFlight(id){
   const result=await(await sessionClient()).from('flights').select('id').eq('id',id).retry(false).maybeSingle();
   if(result.error)throw Error('Flight unavailable');return result.data;
  },
 };
}
function requestStatus(row:unknown,flight:string,viewer:string):RequestStatus|'none'|'unavailable'{
 if(row===null)return 'none';
 if(!row||typeof row!=='object'||Array.isArray(row))return 'unavailable';
 const value=row as Record<string,unknown>;
 if(value.flight_id!==flight||value.requester_id!==viewer||typeof value.status!=='string'||!['pending','accepted','withdrawn','declined','cancelled'].includes(value.status))return 'unavailable';
 if(['accepted','withdrawn','cancelled'].includes(value.status)&&(typeof value.id!=='string'||!uuid.test(value.id)))return 'unavailable';
 return value.status as RequestStatus;
}
/** Own-request read, not an owner list. History never grants current PRIVATE visibility. */
export async function getOwnFlightInterest(id:unknown,ports:InterestQueryPorts=createPorts()):Promise<InterestQueryResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!uuid.test(id))return {status:'missing'};
  const target=id.toLowerCase(),viewer=before.member.userId;
  const [request,profileStatus]=await Promise.all([
   ports.readRequest(target,viewer).then(row=>{const status=requestStatus(row,target,viewer);return {requestStatus:status,...(['accepted','withdrawn','cancelled'].includes(status)?{requestId:((row as Record<string,unknown>).id as string).toLowerCase()}:{})};}).catch(()=>({requestStatus:'unavailable' as const})),
   ports.readProfile(before.member).catch(()=>'unavailable' as const),
  ]);
  // Recheck live flight access after reading independent retained history.
  const visible=await ports.readVisibleFlight(target);
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==viewer)return {status:'forbidden'};
  if(visible===null)return {status:'missing'};
  if(!visible||typeof visible!=='object'||!('id' in visible)||visible.id!==target)return {status:'unavailable'};
  return {status:'authorized',...request,profileStatus};
 }catch{return {status:'unavailable'};}
}
