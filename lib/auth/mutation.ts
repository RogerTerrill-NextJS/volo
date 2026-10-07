import "server-only";
import {getAccess,type ActiveMember,type MemberRole} from "./access";
import {checkMutationOrigin,MutationInputError} from "./mutation-request.ts";

export type MutationCode = "unauthenticated"|"forbidden"|"unavailable"|"invalid_input"|"too_large"|"unsupported_media_type"|"unsupported_method"|"internal_error";
export type MutationResult<T> = {ok:true;data:T}|{ok:false;code:MutationCode;message:string};
export type MutationPolicy<I,O> = {
  allowedRoles: readonly MemberRole[];
  parse: (value:unknown)=>{ok:true;value:I}|{ok:false};
  authorize: (member:ActiveMember,input:I)=>boolean|Promise<boolean>;
  effect: (member:ActiveMember,input:I)=>O|Promise<O>;
};
const messages:Record<MutationCode,string>={unauthenticated:"Authentication required.",forbidden:"Access denied.",unavailable:"Access service unavailable.",invalid_input:"Invalid input.",too_large:"Input too large.",unsupported_media_type:"Unsupported media type.",unsupported_method:"Method not allowed.",internal_error:"Unable to complete request."};
export function mutationFailure(code:MutationCode):MutationResult<never> {return {ok:false,code,message:messages[code]};}

/** Fresh request verification. Permission callbacks must be side-effect-free. */
export async function runMutation<I,O>(headers:Headers,readInput:()=>unknown|Promise<unknown>,policy:MutationPolicy<I,O>):Promise<MutationResult<O>> {
  try {
    const originError=checkMutationOrigin(headers,process.env.VOLO_MUTATION_ORIGIN??"");
    if(originError)return mutationFailure(originError);
    const access=await getAccess();
    if(access.status!=="authorized")return mutationFailure(access.status);
    if(!policy || !Array.isArray(policy.allowedRoles) || policy.allowedRoles.length===0 ||
      !policy.allowedRoles.every(role=>role==="member"||role==="admin") ||
      typeof policy.parse!=="function" || typeof policy.authorize!=="function" || typeof policy.effect!=="function") {
      return mutationFailure("internal_error");
    }
    if(!policy.allowedRoles.includes(access.member.role))return mutationFailure("forbidden");
    let raw:unknown;
    try {raw=await readInput();}catch(error){
      if(error instanceof MutationInputError)return mutationFailure(error.code);
      throw error;
    }
    const parsed=policy.parse(raw);
    if(!parsed || parsed.ok!==true)return mutationFailure("invalid_input");
    if(await policy.authorize(access.member,parsed.value)!==true)return mutationFailure("forbidden");
    return {ok:true,data:await policy.effect(access.member,parsed.value)};
  }catch{return mutationFailure("internal_error");}
}
