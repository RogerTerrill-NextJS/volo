import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/verify-invitation-upgrade.mjs',import.meta.url));
// A missing/relaxed guard would let developer or self-hosted machines reset a database.
for (const [name,args,env,expected] of [
  ['rejects destination arguments',['--db-url','postgres://example.invalid'],{},/accepts no arguments/],
  ['refuses ordinary developer execution',[],{},/requires a GitHub-hosted disposable runner/],
  ['refuses self-hosted runner execution',[],{GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted'},/requires a GitHub-hosted disposable runner/],
]) {
  test(`invitation upgrade verifier ${name}`,()=>{
    // No PATH or credentials: rejection must occur before attempting any external command.
    const result=spawnSync(process.execPath,[script,...args],{env,encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,expected);
    assert.equal(result.stdout,'');
  });
}
