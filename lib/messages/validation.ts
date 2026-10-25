/** Canonical values used in message filters and safe DTOs. Never interpolate raw input. */
export const messageUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function messageInstant(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
 if(!match)return null;
 const result=`${match[1]}.${(match[2]??'').padEnd(6,'0')}Z`;
 return Number.isFinite(Date.parse(result))&&new Date(result).toISOString().slice(0,19)===match[1]?result:null;
}
/** PostgreSQL already enforces nonblank persisted text using its own character classes. */
export function validPersistedMessageBody(value:unknown):value is string{
 return typeof value==='string'&&value.isWellFormed()&&!value.includes('\u0000')&&value.length>0&&[...value].length<=4000;
}
export function validMessageBody(value:unknown):value is string{
 return validPersistedMessageBody(value)&&value.trim().length>0;
}
export type MessageThread={id:string;requestId:string;ownerId:string;requesterId:string;createdAt:string;closed:boolean};
export function projectMessageThread(value:unknown,target:string,viewer:string):MessageThread|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>,createdAt=messageInstant(row.created_at),closedAt=messageInstant(row.closed_at);
 if(row.id!==target||![row.id,row.flight_request_id,row.owner_id,row.requester_id].every(id=>typeof id==='string'&&messageUuid.test(id))||!createdAt||row.owner_id===row.requester_id||![row.owner_id,row.requester_id].includes(viewer)||(row.closed_at!==null&&(!closedAt||closedAt<createdAt)))return null;
 return {id:target,requestId:row.flight_request_id as string,ownerId:row.owner_id as string,requesterId:row.requester_id as string,createdAt,closed:row.closed_at!==null};
}
