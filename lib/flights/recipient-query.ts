import 'server-only';
import {createDirectoryQueryPorts,listDirectoryProfiles,type DirectoryQueryPorts,type DirectoryProfile} from '../profiles/directory-query.ts';
type Candidate=Pick<DirectoryProfile,'user_id'|'display_name'|'home_airport'|'photoAvailable'>;
type CandidateResult={status:'authorized';rows:Candidate[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
export async function listRecipientCandidates(input:unknown={},ports:DirectoryQueryPorts=createDirectoryQueryPorts()):Promise<CandidateResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  const result=await listDirectoryProfiles(input,ports);if(result.status!=='authorized')return result;
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};
  if(before.member.userId!==after.member.userId)return {status:'forbidden'};
  return {status:'authorized',rows:result.rows.filter(row=>row.user_id!==after.member.userId).map(({user_id,display_name,home_airport,photoAvailable})=>({user_id,display_name,home_airport,photoAvailable})),nextCursor:result.nextCursor};
 }catch{return {status:'unavailable'};}
}
