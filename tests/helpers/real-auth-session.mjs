import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

export function createCookieJar(entries=[]) {
  const values=new Map(entries.map(({name,value})=>[name,value]));
  const jar={
    getAll:()=>[...values].map(([name,value])=>({name,value})),
    setAll(cookies){for(const {name,value,options} of cookies){if(!value||options?.maxAge===0)values.delete(name);else values.set(name,value);}},
    cookieHeader:()=>[...values].map(([name,value])=>`${name}=${value}`).join('; '),
    clone:()=>createCookieJar(jar.getAll()),
    applyResponse(response){
      for(const header of response.headers.getSetCookie()){
        const [pair,...attributes]=header.split(';'),split=pair.indexOf('=');if(split<1)continue;
        const name=pair.slice(0,split).trim(),value=pair.slice(split+1);
        const expired=attributes.some(part=>/^\s*max-age=0\s*$/i.test(part)||(/^\s*expires=/i.test(part)&&Date.parse(part.split('=').slice(1).join('='))<=Date.now()));
        if(expired||!value)values.delete(name);else values.set(name,value);
      }
    },
  };return jar;
}

function localFetch(stack) {
  validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  return (input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!==stack.apiUrl||url.username||url.password)throw new Error('Session forbids outbound request');
    return fetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(10000)});
  };
}
function client(stack,jar){return createServerClient(stack.apiUrl,stack.publicKey,{auth:{autoRefreshToken:false},cookies:{getAll:jar.getAll,setAll:jar.setAll},global:{fetch:localFetch(stack)}});}
function payload(jar){
  const entries=jar.getAll().filter(({name})=>/auth-token(?:\.\d+)?$/.test(name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const value=entries.map(x=>x.value).join('');
  if(!value.startsWith('base64-'))throw new Error('Session cookie unavailable');
  try{return JSON.parse(Buffer.from(value.slice(7),'base64url').toString());}catch{throw new Error('Invalid session cookie');}
}
const internals=new WeakMap();
function wrap(stack,jar,canaries=new Set()) {
  const remember=()=>{for(const entry of jar.getAll())canaries.add(entry.value);try{const data=payload(jar);canaries.add(data.access_token);canaries.add(data.refresh_token);}catch{/* Negative fixtures may be malformed. */}};
  remember();
  const session={
    get userId(){return payload(jar).user.id;},get expiresAt(){return payload(jar).expires_at;},
    cookieHeader:jar.cookieHeader,
    applyResponse(response){jar.applyResponse(response);remember();},
    clone(){return wrap(stack,jar.clone(),new Set(canaries));},
    assertNoCredentialLeaks(text){remember();if([...canaries].some(value=>value&&text.includes(value)))throw new Error('Session credential leak detected');},
    async refresh(){const data=payload(jar);const result=await client(stack,jar).auth.refreshSession({refresh_token:data.refresh_token});if(result.error)throw new Error('Real session refresh rejected');remember();},
    async signOut(){const result=await client(stack,jar).auth.signOut({scope:'local'});if(result.error)throw new Error('Real signout rejected');remember();},
    async probeRetainedCredentials(){
      const data=payload(jar);const fresh=()=>createClient(stack.apiUrl,stack.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch(stack)}});
      const claims=await fresh().auth.getClaims(data.access_token),user=await fresh().auth.getUser(data.access_token),refresh=await fresh().auth.refreshSession({refresh_token:data.refresh_token});
      return {claims:claims.error?'rejected':'accepted',user:user.error?'rejected':'accepted',refresh:refresh.error?'rejected':'accepted'};
    },
    async membership(method,targetId,body){
      if(!/^[a-f0-9-]{36}$/i.test(targetId))throw new Error('Invalid RLS target');
      const data=payload(jar);
      const response=await localFetch(stack)(`${stack.apiUrl}/rest/v1/memberships?user_id=eq.${targetId}&select=*`,{method,headers:{apikey:stack.publicKey,Authorization:`Bearer ${data.access_token}`,'content-type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,rows:await response.json()};
    },
  };internals.set(session,{stack,jar,canaries});return session;
}

export async function signInSession(stack,account) {
  const jar=createCookieJar();const result=await client(stack,jar).auth.signInWithPassword({email:account.email,password:account.password});
  if(result.error||result.data.user?.id!==account.id||!result.data.session)throw new Error('Real password sign-in failed');
  return wrap(stack,jar,new Set([account.password]));
}

export function invalidSession(session,mode) {
  const {stack,jar,canaries}=internals.get(session);const copy=jar.clone(),data=payload(copy);
  if(mode==='signature'){
    const parts=data.access_token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);data.access_token=parts.join('.');
    // Prevent successful refresh from repairing a deliberately invalid credential.
    data.refresh_token='invalid-refresh-token';
  }else if(mode==='refresh')data.refresh_token='invalid-refresh-token';
  else if(mode!=='malformed')throw new Error('Unknown invalid session mode');
  const name=copy.getAll().find(x=>/auth-token(?:\.\d+)?$/.test(x.name)).name.replace(/\.\d+$/,'');
  const negative=createCookieJar([{name,value:mode==='malformed'?'base64-invalid-json':'base64-'+Buffer.from(JSON.stringify(data)).toString('base64url')}]);
  return wrap(stack,negative,new Set(canaries));
}
