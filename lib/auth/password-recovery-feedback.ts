const messages:Record<string,string>={
 sent:'If an account matches that email, you will receive a link to reset your password. Check your inbox and spam folder.',
 invalid_input:'Enter a valid email address, then try again.',
};
export function passwordRecoveryMessage(result:string|string[]|undefined):string|null{
 return typeof result==='string'&&Object.hasOwn(messages,result)?messages[result]:null;
}
