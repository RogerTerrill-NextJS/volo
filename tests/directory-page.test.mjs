import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// The real page must guard both HTML and RSC, consume only the safe query DTO,
// and navigate using its returned cursor rather than leaking the lookahead row.
test('directory renders guarded pilot cards, cursor navigation and recoverable states',{timeout:120000},async()=>{
 const fixture=await startMutationFixture({onboarding:true,photos:true});
 try{
  const viewer=await fixture.seed('directory-ui-reader'),admin=await fixture.seed('directory-ui-admin',{role:'admin'});
  const id=n=>`61000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const row=n=>({user_id:id(n),display_name:`Pilot ${n}`,home_airport:'KPAO',pilot_designation:'licensed',certificates:['Private pilot'],ratings:['Instrument'],aircraft_access:'Club C172',flying_interests:'Day trips',bio:'Local flying',photo_available:false,email:'private-directory-email-canary',photo_storage_path:'private-directory-photo-canary'});
  const directory=fixture.backend.directory;
  directory.rows=Array.from({length:21},(_,i)=>row(i+1));
  directory.rows[0]={...row(1),display_name:'Pilot <One>'};
  const reads=()=>fixture.backend.calls.filter(c=>c.service==='directory');
  const read=async(path='/directory',jar=viewer.jar,init={})=>{
   const page=await fixture.request(path,jar,init);
   for(const key of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(page.response.headers.get(key),/no-store/);
   assert.doesNotMatch(page.body,/private-directory-email-canary|private-directory-photo-canary/);
   return page;
  };
  let page=await read();
  assert.equal(page.response.status,200);
  assert.match(page.body,/<h1[^>]*>Pilot directory<\/h1>/);
  assert.match(page.body,/Pilot &lt;One&gt;/);
  for(const value of ['KPAO','Private pilot','Instrument','Club C172','Day trips','Local flying'])assert.ok(page.body.includes(value));
  assert.match(page.body,/No profile photo available for Pilot/);
  assert.match(page.body,new RegExp(`href="/directory\\?after=${id(20)}"`));
  assert.doesNotMatch(page.body,/Pilot 21|href="\/pilots\/|href="\/profiles\//);
  assert.equal(reads().at(-1).subject,viewer.entry.id);
  assert.deepEqual(reads().at(-1).payload,{p_page_size:20});
  assert.match(page.body,/href="\/directory"/);
  assert.doesNotMatch(page.body,/href="\/admin\/invitations"/);

  directory.rows=[{...row(21),photo_available:true}];
  page=await read(`/directory?after=${id(20)}`);
  assert.match(page.body,/Pilot 21/);
  assert.match(page.body,new RegExp(`/api/profiles/${id(21)}/photo\\?v=0`));
  assert.match(page.body,/Back to first page/);
  assert.doesNotMatch(page.body,/Next page/);
  assert.deepEqual(reads().at(-1).payload,{p_after:id(20),p_page_size:20});

  directory.rows=[row(21)];
  page=await read('/directory?q=%20pAo%20&after='+id(20));
  assert.match(page.body,/Search pilots/);
  assert.match(page.body,/name="q"/);
  assert.match(page.body,/Clear search/);
  assert.match(page.body,/href="\/directory\?q=pAo"/);
  assert.deepEqual(reads().at(-1).payload,{p_after:id(20),p_page_size:20,p_search:'pAo'});
  directory.rows=Array.from({length:21},(_,i)=>row(i+1));
  page=await read('/directory?q=Pilot');
  assert.match(page.body,new RegExp(`href="/directory\\?q=Pilot(?:&amp;|&)after=${id(20)}"`));
  directory.rows=[];
  page=await read('/directory?q=Missing');
  assert.match(page.body,/No pilots match/);
  page=await read('/directory?q=%3Cscript%3E');
  assert.match(page.body,/value="&lt;script&gt;"/);
  assert.deepEqual(reads().at(-1).payload,{p_page_size:20,p_search:'<script>'});
  page=await read('/directory?q=Pilot&after='+id(21));
  assert.match(page.body,/No more pilots on this page/);
  const invalidSearchReads=reads().length;
  for(const query of ['q=a&q=b','q='+ 'x'.repeat(81),'q=bad%00name']){
   page=await read('/directory?'+query);
   assert.match(page.body,/Invalid directory/);
   assert.equal(reads().length,invalidSearchReads);
  }

  const before=reads().length;
  for(const path of ['/directory?after=invalid','/directory?after=a&after=b']){
   page=await read(path);assert.match(page.body,/Invalid directory page/);assert.match(page.body,/href="\/directory"/);
   assert.equal(reads().length,before);
  }
  page=await read('/directory',new Map());
  assert.equal(page.response.headers.get('location'),'/login?reason=authentication-required');
  assert.equal(reads().length,before);
  viewer.entry.status='disabled';page=await read();assert.match(page.body,/Access denied/);assert.doesNotMatch(page.body,/Pilot 21/);assert.equal(reads().length,before);
  viewer.entry.status='active';viewer.entry.membership='absent';page=await read();assert.match(page.body,/Access denied/);assert.equal(reads().length,before);viewer.entry.membership=undefined;

  directory.rows=[];
  page=await read();assert.match(page.body,/No pilots to show yet/);
  page=await read(`/directory?after=${id(21)}`);assert.match(page.body,/No more pilots on this page/);assert.match(page.body,/Back to first page/);
  page=await read('/directory',admin.jar);assert.match(page.body,/href="\/admin\/invitations"/);
  directory.failure='down';page=await read();assert.match(page.body,/Directory temporarily unavailable/);assert.match(page.body,/Try again/);assert.doesNotMatch(page.body,/No pilots to show yet/);
  directory.failure='hang';page=await read();assert.match(page.body,/Loading pilots/);assert.match(page.body,/Directory temporarily unavailable/);directory.failure=null;

  // Page RSC requests are a separate read surface and must use the same guard.
  directory.rows=[row(1)];
  async function readRsc(jar){
   let path='/directory?_rsc=directory-check';
   for(let attempt=0;attempt<3;attempt++){
    const reply=await read(path,jar,{headers:{RSC:'1'}});
    const location=reply.response.headers.get('location');
    if(reply.response.status!==307||!location||new URL(location,fixture.origin).pathname!=='/directory')return reply;
    const target=new URL(location,fixture.origin);assert.equal(target.origin,fixture.origin);
    path=target.pathname+target.search;
   }
   throw new Error('RSC canonicalization did not finish');
  }
  let rsc=await readRsc(viewer.jar);assert.equal(rsc.response.status,200);assert.match(rsc.body,/Pilot 1/);
  viewer.entry.status='disabled';rsc=await readRsc(viewer.jar);assert.match(rsc.body,/Access denied/);assert.doesNotMatch(rsc.body,/Pilot 1/);viewer.entry.status='active';
  rsc=await readRsc(new Map());assert.match(rsc.response.headers.get('location')??rsc.body,/\/login\?reason=authentication-required/);assert.doesNotMatch(rsc.body,/Pilot 1/);
  assert.deepEqual(fixture.backend.unexpected,[]);
 }finally{await fixture.close();}
});
