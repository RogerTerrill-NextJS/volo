import assert from "node:assert/strict";
import {test} from "node:test";
import {resolveMutationOrigin,resolvePreviewAliasOrigin} from "../lib/auth/mutation-origin.mjs";

test('preview alias is exact build metadata and is never enabled on Netlify or production',()=>{
  assert.equal(resolvePreviewAliasOrigin({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_BRANCH_URL:'volo-git-feature-volo7.vercel.app'}),'https://volo-git-feature-volo7.vercel.app');
  assert.equal(resolvePreviewAliasOrigin({VERCEL:'1',VERCEL_ENV:'preview'}),'');
  assert.equal(resolvePreviewAliasOrigin({VERCEL:'1',VERCEL_ENV:'production',VERCEL_BRANCH_URL:'volo-git-main-volo7.vercel.app'}),'');
  assert.equal(resolvePreviewAliasOrigin({CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:'https://deploy-preview-9--voloapp.netlify.app'}),'');
  assert.throws(()=>resolvePreviewAliasOrigin({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_BRANCH_URL:'https://evil.invalid/path'}),/Invalid mutation origin configuration/);
});

test('Vercel preview pins its deployment origin rather than production or local overrides',()=>{
  assert.equal(resolveMutationOrigin({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'volo-a1b2c3-volo7.vercel.app',VERCEL_PROJECT_PRODUCTION_URL:'volo-six-woad.vercel.app',VOLO_MUTATION_ORIGIN:'https://evil.invalid'}),'https://volo-a1b2c3-volo7.vercel.app');
});

test('Vercel production requires the explicit canonical origin, not an automatically selected domain',()=>{
  assert.equal(resolveMutationOrigin({VERCEL:'1',VERCEL_ENV:'production',VERCEL_URL:'volo-a1b2c3-volo7.vercel.app',VERCEL_PROJECT_PRODUCTION_URL:'volo-six-woad.vercel.app',VOLO_MUTATION_ORIGIN:'https://flight.example/'}),'https://flight.example');
  assert.throws(()=>resolveMutationOrigin({VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'volo-six-woad.vercel.app'}),/Invalid mutation origin configuration/);
});

test('Vercel rejects malformed metadata, ambiguous hosting and unsupported contexts without leaking input',()=>{
  const bad=[
    {VERCEL:'1'},
    {VERCEL:'1',VERCEL_ENV:'development',VOLO_MUTATION_ORIGIN:'http://localhost:3000'},
    {VERCEL_ENV:'custom',VOLO_MUTATION_ORIGIN:'https://flight.example'},
    {VERCEL:'1',VERCEL_ENV:'preview'},
    {VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'volo-a1b2c3-volo7.vercel.app',NETLIFY:'true',CONTEXT:'production',URL:'https://voloapp.netlify.app'},
    ...['https://flight.example','//flight.example','user:origin-secret-canary@flight.example','flight.example/path','flight.example?secret=origin-secret-canary','flight.example#fragment','*.vercel.app','flight.example:444','localhost','127.0.0.1','flight.example/',' flight.example','flight.example\\path'].map(VERCEL_URL=>({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL})),
    ...['http://localhost:3000','https://*.vercel.app','https://flight.example/path','https://user:origin-secret-canary@flight.example'].map(VOLO_MUTATION_ORIGIN=>({VERCEL:'1',VERCEL_ENV:'production',VOLO_MUTATION_ORIGIN})),
  ];
  for(const env of bad)assert.throws(()=>resolveMutationOrigin(env),error=>error instanceof Error && error.message==='Invalid mutation origin configuration.');
});

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
