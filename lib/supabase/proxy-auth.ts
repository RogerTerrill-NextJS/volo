import "server-only";

export const AUTH_VERIFICATION_TIMEOUT_MS = 5000;
export const AUTH_CREDENTIAL_CODES = new Set(["bad_jwt", "session_not_found", "refresh_token_not_found",
  "refresh_token_already_used", "user_not_found", "user_banned"]);

/** Local terminal response prevents SDK retries; the caller owns the 503 policy. */
export function createProxyAuthTransport(credentialCodes:ReadonlySet<string> = AUTH_CREDENTIAL_CODES) {
  const controller = new AbortController();
  let unavailable = false;
  let closed = false;
  const terminal = () => {
    unavailable = true;
    return Response.json({ error_code: "volo_auth_unavailable", message: "Auth unavailable" }, { status: 400 });
  };
  const timer = setTimeout(() => { unavailable = true; controller.abort(); }, AUTH_VERIFICATION_TIMEOUT_MS);
  return {
    isUnavailable: () => unavailable,
    close() {
      closed = true;
      clearTimeout(timer);
      controller.abort();
    },
    fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (closed || unavailable) return terminal();
      try {
        const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const signal = requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal;
        const response = await fetch(input, { ...init, signal, redirect: "error" });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          return terminal();
        }
        const body = await response.text();
        const data = JSON.parse(body);
        if (!response.ok) {
          // Older Auth responses use a numeric HTTP code beside error_code.
          const upstreamCode = typeof data?.code === "string" ? data.code : data?.error_code;
          if (!credentialCodes.has(upstreamCode)) return terminal();
          const code = upstreamCode;
          return Response.json({code, error_code:code, message:"Authentication rejected."}, {status:response.status, headers:response.headers});
        }
        if (response.ok) {
          const user = data?.user ?? data;
          if (typeof user?.id !== "string" || !user.id) return terminal();
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.pathname.endsWith("/token") && (
            typeof data.access_token !== "string" || !data.access_token ||
            typeof data.refresh_token !== "string" || !data.refresh_token ||
            !Number.isFinite(data.expires_in) || data.expires_in <= 0
          )) return terminal();
        }
        if (unavailable || closed) return terminal();
        return new Response(body, { status: response.status, headers: response.headers });
      } catch {
        return terminal();
      }
    }) satisfies typeof globalThis.fetch,
  };
}
