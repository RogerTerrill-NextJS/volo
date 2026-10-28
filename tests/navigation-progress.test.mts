import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shouldShowDocumentProgress} from '../lib/navigation-progress.ts';
const origin='https://voloapp.netlify.app/dashboard';
const click={button:0,defaultPrevented:false,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false};
const anchor={href:'/messages',target:'',download:false};
test('internal document navigation and query changes show feedback, including intentional reloads',()=>{
 for(const href of ['/messages','/dashboard?after=next','/dashboard'])assert.equal(shouldShowDocumentProgress(click,{...anchor,href},origin),true);
});
test('ignored clicks preserve modified, cancelled and other-target behavior',()=>{
 for(const event of [{button:1},{defaultPrevented:true},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true}])assert.equal(shouldShowDocumentProgress({...click,...event},anchor,origin),false);
 for(const change of [{download:true},{target:'_blank'},{target:'other'},{href:'https://example.com/'},{href:'mailto:help@example.com'},{href:'javascript:void(0)'},{href:'#section'},{href:'/dashboard#section'},{href:'/dashboard#'},{href:''}])assert.equal(shouldShowDocumentProgress(click,{...anchor,...change},origin),false);
 assert.equal(shouldShowDocumentProgress(click,{...anchor,target:'_self'},origin),true);
 assert.equal(shouldShowDocumentProgress(click,{...anchor,href:'/messages#last'},origin),true);
});
