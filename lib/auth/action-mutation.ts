import "server-only";
import {headers} from "next/headers";
import {runMutation,type MutationPolicy,type MutationResult} from "./mutation.ts";
import {readMutationForm} from "./mutation-input.ts";

/** Call inside every protected action; never accept identity or headers as args. */
export async function handleActionMutation<I,O>(form:FormData,policy:MutationPolicy<I,O>):Promise<MutationResult<O>> {
  return runMutation(new Headers(await headers()),()=>readMutationForm(form),policy);
}
