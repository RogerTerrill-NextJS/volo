import assert from "node:assert/strict";
import { test } from "node:test";

// These catch missing startup validation, unsafe URL acceptance, and value leaks.
// Import inside each test so missing implementation is reported per behavior.
const validate = async (env) => {
  const { validateEnvironment } = await import("../lib/environment.mjs");
  return validateEnvironment(env);
};

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
};

test("missing configuration reports both variable names and setup guidance", async () => {
  await assert.rejects(validate({}), (error) => {
    assert.match(error.message, /NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(error.message, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(error.message, /\.env\.local/);
    return true;
  });
});

test("hosted HTTPS and local HTTP Supabase configurations are accepted", async () => {
  await validate(valid);
  await validate({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
  await validate({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" });
});

test("invalid configuration never includes supplied values in errors", async () => {
  for (const url of ["not-a-url", "http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=sensitive", "https://example.com#token"]) {
    await assert.rejects(validate({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url }), (error) => {
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_URL/);
      assert.ok(!error.message.includes(url));
      assert.ok(!error.message.includes("password"));
      assert.ok(!error.message.includes("sensitive"));
      return true;
    });
  }
});

test("blank, placeholder, and secret keys are rejected without echoing values", async () => {
  for (const key of ["", "  ", "your-publishable-key", "sb_publishable_", "sb_secret_sensitive_fixture"]) {
    await assert.rejects(validate({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), (error) => {
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
      assert.ok(!error.message.includes("sb_secret_sensitive_fixture"));
      return true;
    });
  }
});
