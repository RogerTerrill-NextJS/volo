import "server-only";
import {runMutation,mutationFailure,type MutationPolicy,type MutationResult,type MutationCode} from "./mutation.ts";
import {readMutationJson} from "./mutation-input.ts";

const status:Record<MutationCode,number>={unauthenticated:401,forbidden:403,unavailable:503,invalid_input:400,too_large:413,unsupported_media_type:415,unsupported_method:405,internal_error:500};
const privateHeaders={"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Expires:"0"};
function response<T>(result:MutationResult<T>,headers:Record<string,string>={}) {
  return Response.json(result,{status:result.ok?200:status[result.code],headers:{...privateHeaders,...headers}});
}
/** Each exported mutation method must enter here independently of page access. */
export async function handleRouteMutation<I,O>(request:Request,options:{method:"POST"|"PUT"|"PATCH"|"DELETE";maxBytes?:number;policy:MutationPolicy<I,O>}):Promise<Response> {
  try {
    if(!options || !["POST","PUT","PATCH","DELETE"].includes(options.method))return response(mutationFailure("internal_error"));
    if(request.method!==options.method)return response(mutationFailure("unsupported_method"),{Allow:options.method});
    return response(await runMutation(request.headers,()=>readMutationJson(request,options.maxBytes),options.policy));
  }catch{return response(mutationFailure("internal_error"));}
}
