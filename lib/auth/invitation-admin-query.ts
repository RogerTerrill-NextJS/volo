import 'server-only';
import type {AccessResult} from './access.ts';
import {createInvitationServiceClient} from './invitation-send-provider.ts';
import {invitationUuid,invitationEmail} from './invitation-send.ts';
import type {Database} from '../supabase/database.types';
export type InvitationAdminRow={id:string;version:number;email:string;invitationStatus:string;sendStatus:string;updatedAt:string};
export type InvitationAdminResult={status:'authorized';rows:InvitationAdminRow[];hasMore:boolean}|{status:'unauthenticated'|'forbidden'|'unavailable'};
export type InvitationQueryPorts={access:()=>Promise<AccessResult>;readRows:()=>Promise<unknown>};
const labels:Record<Database['public']['Enums']['invitation_status'],string>={
 pending_issuance:'Pending',issued:'Awaiting signup',setup_verified:'Setup in progress',
 password_established:'Setup in progress',redeemed:'Redeemed',revoked:'Revoked',superseded:'Superseded',
};
const outcomes=['started','accepted','rejected','unknown'];
const unavailable=()=>new Error('Invitation list unavailable.');
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();
 return value as Record<string,unknown>;
}
function version(value:unknown):value is number{return Number.isSafeInteger(value)&&(value as number)>0;}
function timestamp(value:unknown):value is string{return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function project(value:unknown):InvitationAdminRow{
 const row=object(value);
 if(typeof row.id!=='string'||!invitationUuid.test(row.id)||!version(row.version)
  ||typeof row.recipient_email!=='string'||invitationEmail(row.recipient_email)!==row.recipient_email
  ||typeof row.status!=='string'||!Object.hasOwn(labels,row.status)
  ||!timestamp(row.created_at)||!timestamp(row.updated_at)||Date.parse(row.updated_at)<Date.parse(row.created_at)
  ||!Array.isArray(row.invitation_send_attempts)||row.invitation_send_attempts.length>1)throw unavailable();
 let sendStatus='Not sent';
 if(row.invitation_send_attempts.length){
  const attempt=object(row.invitation_send_attempts[0]);
  if(!version(attempt.invitation_version)||attempt.invitation_version>row.version
   ||typeof attempt.outcome!=='string'||!outcomes.includes(attempt.outcome)
   ||(attempt.reconciled_outcome!==null&&(!['started','unknown'].includes(attempt.outcome)
    ||!['accepted','rejected'].includes(String(attempt.reconciled_outcome)))))throw unavailable();
  if(attempt.invitation_version===row.version){
   const outcome=attempt.reconciled_outcome??attempt.outcome;
   sendStatus=outcome==='accepted'?'Accepted for sending':outcome==='rejected'?'Send failed':'Needs review';
  }
 }
 return {id:row.id,version:row.version,email:row.recipient_email,
  invitationStatus:labels[row.status as keyof typeof labels],sendStatus,updatedAt:row.updated_at};
}

/** One bounded statement keeps invitation and nested attempt in one snapshot. */
export function createInvitationQueryPorts():InvitationQueryPorts{
 return {access:async()=>(await import('./access.ts')).getAccess(),async readRows(){
  const result=await createInvitationServiceClient().from('invitations')
   .select('id,version,recipient_email,status,created_at,updated_at,invitation_send_attempts(invitation_version,outcome,reconciled_outcome)')
   .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51)
   .order('invitation_version',{ascending:false,referencedTable:'invitation_send_attempts'})
   .limit(1,{referencedTable:'invitation_send_attempts'}).retry(false);
  if(result.error)throw unavailable();return result.data;
 }};
}

/** No layout decision or caller-provided role grants access to these private rows. */
export async function listAdminInvitations(ports:InvitationQueryPorts=createInvitationQueryPorts()):Promise<InvitationAdminResult>{
 try{
  const before=await ports.access();
  if(before.status!=='authorized')return {status:before.status};
  if(before.member.role!=='admin')return {status:'forbidden'};
  const data=await ports.readRows();
  if(!Array.isArray(data)||data.length>51)throw unavailable();
  const rows=data.map(project);
  const after=await ports.access();
  if(after.status!=='authorized')return {status:after.status};
  if(after.member.role!=='admin'||after.member.userId!==before.member.userId)return {status:'forbidden'};
  return {status:'authorized',rows:rows.slice(0,50),hasMore:rows.length>50};
 }catch{return {status:'unavailable'};}
}
