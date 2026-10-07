import "server-only";

export const MEMBERSHIP_TIMEOUT_MS = 5000;

/** Request-owned PostgREST transport. Failure details never reach SDK diagnostics. */
export function createMembershipTransport() {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unavailable = false;
  let closed = false;
  const terminal = () => {
    unavailable = true;
    return Response.json({message:"Membership service unavailable."}, {status:400});
  };
  return {
    isUnavailable: () => unavailable,
    close() {closed = true;clearTimeout(timer);controller.abort();},
    fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if(closed || unavailable) return terminal();
      timer ??= setTimeout(() => {unavailable = true;controller.abort();}, MEMBERSHIP_TIMEOUT_MS);
      try {
        const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const signal = caller ? AbortSignal.any([controller.signal, caller]) : controller.signal;
        const response = await fetch(input, {...init, signal, cache:"no-store", redirect:"error"});
        if(!response.ok) {await response.body?.cancel();return terminal();}
        const body = await response.text();
        const rows: unknown = JSON.parse(body);
        // maybeSingle collapses [null] and [] to the same value; reject protocol
        // failures before the SDK can turn them into a missing membership.
        if(!Array.isArray(rows) || rows.some(row=>row===null)) return terminal();
        if(unavailable || closed) return terminal();
        return new Response(body, {status:response.status,headers:response.headers});
      } catch {return terminal();}
    }) satisfies typeof globalThis.fetch,
  };
}
