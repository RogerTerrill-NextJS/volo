import "server-only";
import {MutationInputError} from "./mutation-request.ts";

const defaultLimit = 16384;
export async function readMutationJson(request: Request, maxBytes = defaultLimit): Promise<unknown> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 65536) throw new Error("Invalid mutation input limit.");
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type") ?? "")) {
    throw new MutationInputError("unsupported_media_type");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new MutationInputError("invalid_input");
  if (length !== null && Number(length) > maxBytes) { void request.body?.cancel().catch(()=>{}); throw new MutationInputError("too_large"); }
  const reader = request.body?.getReader();
  if (!reader) throw new MutationInputError("invalid_input");
  let timer: ReturnType<typeof setTimeout>|undefined;
  const deadline = new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new MutationInputError("invalid_input")),5000);});
  try {
    let size=0; const chunks: Uint8Array[]=[];
    for (;;) {
      const chunk = await Promise.race([reader.read(),deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new MutationInputError("too_large");
      chunks.push(chunk.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  } catch(error) {
    void reader.cancel().catch(()=>{});
    if(error instanceof MutationInputError) throw error;
    throw new MutationInputError("invalid_input");
  } finally {clearTimeout(timer);reader.releaseLock();}
}

/** Normalize application fields only; Next owns reserved action selection data. */
export function readMutationForm(form: FormData): Record<string,string> {
  const result: Record<string,string>=Object.create(null);let size=0;
  const encoder=new TextEncoder();
  for(const [name,value] of form) {
    if(typeof value!=="string") throw new MutationInputError("invalid_input");
    size+=encoder.encode(name).byteLength+encoder.encode(value).byteLength;
    if(size>defaultLimit) throw new MutationInputError("too_large");
    if(name.startsWith("$ACTION_"))continue;
    if(Object.hasOwn(result,name))throw new MutationInputError("invalid_input");
    result[name]=value;
  }
  return result;
}
