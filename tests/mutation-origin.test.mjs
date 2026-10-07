import assert from "node:assert/strict";
import {test} from "node:test";
import {resolveMutationOrigin} from "../lib/auth/mutation-origin.mjs";

test("build origin follows context and rejects unsafe configuration", () => {
  assert.equal(resolveMutationOrigin({}), "");
  assert.equal(resolveMutationOrigin({VOLO_MUTATION_ORIGIN:"http://localhost:3000"}), "http://localhost:3000");
  assert.equal(resolveMutationOrigin({VOLO_MUTATION_ORIGIN:"http://[::1]:3000/"}), "http://[::1]:3000");
  assert.equal(resolveMutationOrigin({NETLIFY:"true",CONTEXT:"deploy-preview",DEPLOY_PRIME_URL:"https://deploy-preview-18--voloapp.netlify.app",URL:"https://voloapp.netlify.app",VOLO_MUTATION_ORIGIN:"https://evil.invalid"}),"https://deploy-preview-18--voloapp.netlify.app");
  assert.equal(resolveMutationOrigin({NETLIFY:"true",CONTEXT:"production",URL:"https://voloapp.netlify.app/"}),"https://voloapp.netlify.app");
  for (const env of [
    {NETLIFY:"true"}, {CONTEXT:"branch-deploy",VOLO_MUTATION_ORIGIN:"https://evil.invalid"},
    {CONTEXT:"deploy-preview",VOLO_MUTATION_ORIGIN:"http://localhost:3000"},
    {CONTEXT:"production",URL:"http://localhost:3000"},
    ...["http://evil.invalid", "https://evil.invalid/path", "https://user:password@evil.invalid", "https://evil.invalid?token=origin-secret-canary", "https://evil.invalid#fragment", "https://*.netlify.app", "https://a.invalid,https://b.invalid", " https://a.invalid", "https://a.invalid/../"].map(VOLO_MUTATION_ORIGIN=>({VOLO_MUTATION_ORIGIN})),
  ]) assert.throws(()=>resolveMutationOrigin(env),error=>error instanceof Error && !/evil|password|origin-secret-canary/.test(error.message));
});
