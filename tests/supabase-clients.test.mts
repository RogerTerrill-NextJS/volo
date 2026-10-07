import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";

test("browser client validates every construction and works during server rendering", () => {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = names.map((name) => process.env[name]);
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_client_fixture";
    assert.equal(typeof window, "undefined");
    assert.equal(typeof document, "undefined");
    const client = createBrowserSupabaseClient();
    assert.ok(client.auth);
    assert.ok(client.from("memberships"));

    // Checked by tsc; never execute requests to a backend.
    const generatedTypes = () => {
      client.from("memberships").select("user_id, organization_id");
      // @ts-expect-error Tables must come from generated Database types.
      client.from("not_a_database_table");
    };
    void generatedTypes;

    for (const name of names) {
      const valid = process.env[name];
      delete process.env[name];
      assert.throws(() => createBrowserSupabaseClient(), /NEXT_PUBLIC_SUPABASE/);
      process.env[name] = "invalid-secret-value-that-must-not-leak";
      assert.throws(() => createBrowserSupabaseClient(), (error: Error) => {
        assert.match(error.message, /NEXT_PUBLIC_SUPABASE/);
        assert.ok(!error.message.includes("invalid-secret-value"));
        return true;
      });
      process.env[name] = valid;
    }
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
