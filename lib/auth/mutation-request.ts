import "server-only";
import {parseMutationOrigin} from "./mutation-origin.mjs";

/** Browser Origin evidence is compared only with the build-pinned origin. */
export function checkMutationOrigin(headers: Headers, trustedOrigin: string): "forbidden"|"unavailable"|null {
  try { if (parseMutationOrigin(trustedOrigin, true) !== trustedOrigin) return "unavailable"; }
  catch { return "unavailable"; }
  const origin = headers.get("origin");
  if (!origin || origin !== trustedOrigin) return "forbidden";
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return "forbidden";
  return null;
}

export type MutationInputCode = "invalid_input"|"too_large"|"unsupported_media_type";
const messages = {invalid_input:"Invalid input.",too_large:"Input too large.",unsupported_media_type:"Unsupported media type."};
export class MutationInputError extends Error {
  readonly code: MutationInputCode;
  constructor(code: MutationInputCode) { super(messages[code]); this.name="MutationInputError"; this.code=code; }
}
