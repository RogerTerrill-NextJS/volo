const messages:Record<string,string>={
 invalid_input:'Enter your email address and password, then try again.',
 invalid_credentials:'We could not sign you in with those details. Check your email and password.',
 unavailable:'Sign-in is temporarily unavailable. Wait a moment, then try again.',
};
export function loginResultMessage(result:string|string[]|undefined):string|null {
 return typeof result==='string'&&Object.hasOwn(messages,result)?messages[result]:null;
}
