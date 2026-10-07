import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnvironment } from "../lib/environment.mjs";

test("public config exposes only the URL and publishable key despite privileged environment values", async (t) => {
  const fixture = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_test_canary",
    SUPABASE_ACCESS_TOKEN: "cli-token-canary",
    SUPABASE_DB_PASSWORD: "db-password-canary",
  };
  const previous = Object.fromEntries(Object.keys(fixture).map((key) => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { getSupabasePublicConfig } = await import("../lib/supabase/public-config.mjs");
  assert.deepEqual(getSupabasePublicConfig(), {
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test_fixture",
  });
});

test("startup rejects additional browser-public Supabase variables without echoing their values", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
  };
  for (const key of ["NEXT_PUBLIC_SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_DB_PASSWORD"]) {
    assert.throws(() => validateEnvironment({ ...base, [key]: "private-canary-value" }), (error) => {
      assert.match(error.message, /browser-public/);
      assert.ok(error.message.includes(key));
      assert.ok(!error.message.includes("private-canary-value"));
      return true;
    });
  }
});
