import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeProfilePhoto,readProfilePhoto} from '../lib/profiles/photo-image.ts';

test('normalize real images, resize without enlarging, strip metadata and orient',async()=>{
 const png=await sharp({create:{width:1024,height:512,channels:3,background:'red'}}).png().toBuffer();
 const output=await normalizeProfilePhoto(png,'image/png');
 const meta=await sharp(output).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,512);assert.equal(meta.height,256);assert.equal(meta.exif,undefined);
 for(const [format,mime] of [['jpeg','image/jpeg'],['png','image/png'],['webp','image/webp']] as const){
  const small=await sharp({create:{width:24,height:12,channels:3,background:'blue'}})[format]().toBuffer();
  assert.equal((await sharp(await normalizeProfilePhoto(small,mime)).metadata()).width,24);
 }
 const rotated=await sharp({create:{width:40,height:20,channels:3,background:'red'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const oriented=await sharp(await normalizeProfilePhoto(rotated,'image/jpeg')).metadata();
 assert.equal(oriented.width,20);assert.equal(oriented.height,40);assert.equal(oriented.exif,undefined);
 await assert.rejects(()=>normalizeProfilePhoto(png,'image/jpeg'));
});
test('reject corrupt, unsupported, animated and excessive-pixel images',async()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('not an image'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')])await assert.rejects(()=>normalizeProfilePhoto(bytes,'image/png'));
 const huge=await sharp({create:{width:5001,height:5000,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(()=>normalizeProfilePhoto(huge,'image/png'));
 const gif=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).gif().toBuffer();
 await assert.rejects(()=>normalizeProfilePhoto(gif,'image/gif'));
 const frames=Buffer.alloc(2*4*3,200);frames.fill(20,12);
 const animated=await sharp(frames,{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
 assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
 await assert.rejects(()=>normalizeProfilePhoto(animated,'image/webp'));
 const valid=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).jpeg().toBuffer();
 await assert.rejects(()=>normalizeProfilePhoto(valid.subarray(0,Math.floor(valid.length/2)),'image/jpeg'));
});
test('download bounds actual bytes and cancels a stalled body',async()=>{
 const max=5000000;
 assert.equal((await readProfilePhoto(new Response(new Uint8Array(max)))).length,max);
 let cancelled=false;
 const tooLarge=new ReadableStream({start(c){c.enqueue(new Uint8Array(max));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
 await assert.rejects(()=>readProfilePhoto(new Response(tooLarge)));assert.equal(cancelled,true);
 cancelled=false;
 const stalled=new ReadableStream({cancel(){cancelled=true;}});
 const started=Date.now();await assert.rejects(()=>readProfilePhoto(new Response(stalled)));assert.equal(cancelled,true);assert.ok(Date.now()-started<12000);
});
