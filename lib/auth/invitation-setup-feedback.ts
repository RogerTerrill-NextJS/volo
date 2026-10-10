/** UI feedback only; the completion handler remains authoritative. */
export function passwordSetupError(password:string,confirmation:string):string|null {
 if([...password].length<8)return 'Use at least 8 characters for your password.';
 if(new TextEncoder().encode(password).byteLength>256)return 'Your password is too long. Use fewer characters.';
 if(password!==confirmation)return 'Your passwords do not match. Enter the same password in both fields.';
 return null;
}
const resultMessages:Record<string,string>={
 invalid_input:'Check that your password has at least 8 characters and both fields match, then try again.',
 password_rejected:'That password could not be accepted. Choose a different password and try again.',
 retry_later:'We could not finish setting up your account. Wait a moment, then try again.',
 renew_invitation:'Ask the person who invited you to renew your invitation before trying again.',
 access_denied:'This invitation cannot complete your account. Ask the person who invited you for help.',
};
export function setupResultMessage(result:string|string[]|undefined):string|null {
 return typeof result==='string'&&Object.hasOwn(resultMessages,result)?resultMessages[result]:null;
}
