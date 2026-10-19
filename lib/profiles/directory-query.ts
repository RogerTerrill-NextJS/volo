import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {validateProfile,type ProfileFields} from './validation.ts';
import {normalizeDirectorySearch} from './directory-search.ts';

export type DirectoryProfile=ProfileFields & {user_id:string;photoAvailable:boolean};
export type DirectoryPage={after:string|null;pageSize:number;search?:string};
export type DirectoryQueryPorts={access:()=>Promise<AccessResult>;readRows:(page:DirectoryPage)=>Promise<unknown>};
export type NetworkProfileQueryPorts={access:()=>Promise<AccessResult>;readRow:(userId:string)=>Promise<unknown>};
export type NetworkProfileResult={status:'authorized';profile:DirectoryProfile}
 | {status:'unauthenticated'|'forbidden'|'unavailable'|'missing'};
export type DirectoryResult={status:'authorized';rows:DirectoryProfile[];nextCursor:string|null}
 | {status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable=()=>new Error('Directory unavailable.');

function pageInput(input:unknown):DirectoryPage|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>key!=='after'&&key!=='pageSize'&&key!=='search'))return null;
 const search=normalizeDirectorySearch(value.search);
 if(search===null)return null;
 const pageSize=value.pageSize===undefined?20:value.pageSize,after=value.after??null;
 if(typeof pageSize!=='number'||!Number.isInteger(pageSize)||pageSize<1||pageSize>50
  ||(after!==null&&(typeof after!=='string'||!uuid.test(after))))return null;
 return {after:typeof after==='string'?after.toLowerCase():null,pageSize,...(search?{search}:{})};
}

function project(input:unknown):DirectoryProfile{
 if(!input||typeof input!=='object'||Array.isArray(input))throw unavailable();
 const row=input as Record<string,unknown>;
 if(typeof row.user_id!=='string'||!uuid.test(row.user_id)||typeof row.photo_available!=='boolean'
  ||!Array.isArray(row.certificates)||!Array.isArray(row.ratings)
  ||!['aircraft_access','flying_interests','bio'].every(key=>row[key]===null||typeof row[key]==='string'))throw unavailable();
 const result=validateProfile({display_name:row.display_name,home_airport:row.home_airport,
  pilot_designation:row.pilot_designation,certificates:row.certificates,ratings:row.ratings,
  aircraft_access:row.aircraft_access,flying_interests:row.flying_interests,bio:row.bio});
 if(!result.ok)throw unavailable();
 return {...result.value,user_id:row.user_id.toLowerCase(),photoAvailable:row.photo_available};
}

async function networkReadClient(){
  const {createServerSupabaseClient}=await import('../supabase/server.ts');
  const signal=AbortSignal.timeout(5000);
  const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
   const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
   return new Response(await response.text(),{status:response.status,headers:response.headers});
  }});
  return {client,signal};
}

/** Session credentials only: invoker RPCs preserve profile RLS. No shared cache. */
export function createDirectoryQueryPorts():DirectoryQueryPorts{
 return {access:async()=>(await import('../auth/access.ts')).getAccess(),async readRows(page){
  const {client,signal}=await networkReadClient();
  const result=await client.rpc('list_directory_profiles',{p_after:page.after??undefined,p_page_size:page.pageSize,...(page.search?{p_search:page.search}:{})}).abortSignal(signal).retry(false);
  if(result.error)throw unavailable();
  return result.data;
 }};
}

export function createNetworkProfileQueryPorts():NetworkProfileQueryPorts{
 return {access:async()=>(await import('../auth/access.ts')).getAccess(),async readRow(userId){
  const {client,signal}=await networkReadClient();
  const result=await client.rpc('get_network_profile',{p_user_id:userId}).abortSignal(signal).retry(false).maybeSingle();
  if(result.error)throw unavailable();
  return result.data;
 }};
}

/** One requested identity; absent/inactive targets share the same missing outcome. */
export async function getNetworkProfile(userId:unknown,ports:NetworkProfileQueryPorts=createNetworkProfileQueryPorts()):Promise<NetworkProfileResult>{
 try{
  const before=await ports.access();
  if(before.status!=='authorized')return {status:before.status};
  if(typeof userId!=='string'||!uuid.test(userId))return {status:'missing'};
  const target=userId.toLowerCase(),data=await ports.readRow(target);
  const profile=data===null?null:project(data);
  if(profile&&profile.user_id!==target)throw unavailable();
  const after=await ports.access();
  if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==before.member.userId)return {status:'forbidden'};
  return profile?{status:'authorized',profile}:{status:'missing'};
 }catch{return {status:'unavailable'};}
}

/** Active members may browse without a profile. Never accept a caller's access grant. */
export async function listDirectoryProfiles(input:unknown={},ports:DirectoryQueryPorts=createDirectoryQueryPorts()):Promise<DirectoryResult>{
 try{
  const before=await ports.access();
  if(before.status!=='authorized')return {status:before.status};
  const page=pageInput(input);
  if(!page)return {status:'invalid'};
  const data=await ports.readRows(page);
  if(!Array.isArray(data)||data.length>page.pageSize+1)throw unavailable();
  const rows=data.map(project);
  let previous=page.after;
  for(const row of rows){
   if(previous!==null&&row.user_id<=previous)throw unavailable();
   previous=row.user_id;
  }
  const after=await ports.access();
  if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==before.member.userId)return {status:'forbidden'};
  const visible=rows.slice(0,page.pageSize);
  return {status:'authorized',rows:visible,nextCursor:rows.length>page.pageSize?visible[visible.length-1].user_id:null};
 }catch{return {status:'unavailable'};}
}
