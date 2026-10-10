import assert from 'node:assert/strict';
import {test} from 'node:test';
import {passwordSetupError,setupResultMessage} from '../lib/auth/invitation-setup-feedback.ts';
test('password feedback matches Unicode and byte bounds without normalization',()=>{
 assert.equal(passwordSetupError('secure password','secure password'),null);
 assert.equal(passwordSetupError('😀'.repeat(8),'😀'.repeat(8)),null);
 assert.equal(passwordSetupError('é'.repeat(128),'é'.repeat(128)),null);
 for(const [password,confirmation] of [['short','short'],['😀'.repeat(7),'😀'.repeat(7)],['é'.repeat(129),'é'.repeat(129)],[' password','password'],['abcdefgh','abcdefgi']])assert.ok(passwordSetupError(password,confirmation));
});
test('failure feedback accepts only one recognized result and never echoes query input',()=>{
 for(const value of ['invalid_input','password_rejected','retry_later','renew_invitation','access_denied'])assert.ok(setupResultMessage(value));
 for(const value of [undefined,['retry_later','access_denied'],'completed','<script>secret</script>','https://foreign.invalid','toString'])assert.equal(setupResultMessage(value),null);
});
