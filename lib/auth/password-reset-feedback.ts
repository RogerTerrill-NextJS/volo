const messages:Record<string,string>={
 invalid_input:'Check that your password has at least 8 characters and both fields match, then try again.',
 link_required:'This reset link cannot be used. Request a new link. If you already submitted a new password, try signing in with it.',
 unavailable:'Password reset is temporarily unavailable. Wait a moment, then try again.',
};
export function passwordResetMessage(result:string|string[]|undefined):string|null{
 return typeof result==='string'&&Object.hasOwn(messages,result)?messages[result]:null;
}
