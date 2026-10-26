import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {memberAdminUuid} from '../auth/member-admin-validation.ts';
export type ModerationStatePorts={access:()=>Promise<AccessResult>;read:(id:string)=>Promise<unknown>};
type Result={status:'authorized';hidden:boolean}|{status:'unauthenticated'|'forbidden'|'unavailable'|'missing'};
function createPorts():ModerationStatePorts{return {access:async()=>(await import('../auth/access.ts')).getAccess(),async read(id){const client=await(await import('./client.ts')).flightMutationClient();const result=await client.rpc('is_flight_hidden_for_participant',{p_flight_id:id}).retry(false);if(result.error)throw Error('Moderation status unavailable');return result.data;}};}
/** A boolean notice for existing participants, never a grant to hidden post data. */
export async function getFlightModerationState(id:unknown,ports:ModerationStatePorts=createPorts()):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!memberAdminUuid.test(id.toLowerCase()))return {status:'missing'};
  const hidden=await ports.read(id.toLowerCase());if(typeof hidden!=='boolean')throw Error('Invalid moderation status');
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};if(after.member.userId!==before.member.userId)return {status:'forbidden'};
  return {status:'authorized',hidden};
 }catch{return {status:'unavailable'};}
}
