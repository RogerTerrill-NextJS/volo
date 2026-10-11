import 'server-only';
import sharp from 'sharp';
export const PROFILE_PHOTO_MAX_BYTES=5_000_000;
export const PROFILE_PHOTO_TIMEOUT_MS=10_000;
export class InvalidProfilePhoto extends Error {constructor(){super('Invalid profile image.');}}

/** Count streamed bytes even when the provider omits Content-Length. */
export async function readProfilePhoto(response:Response):Promise<Uint8Array>{
 if(!response.ok||!response.body)throw new InvalidProfilePhoto();
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new InvalidProfilePhoto());},PROFILE_PHOTO_TIMEOUT_MS);});
 try{
  return await Promise.race([(async()=>{
   while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>PROFILE_PHOTO_MAX_BYTES)throw new InvalidProfilePhoto();chunks.push(value);}
   if(size===0)throw new InvalidProfilePhoto();
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
  })(),deadline]);
 }catch{void reader.cancel().catch(()=>{});throw new InvalidProfilePhoto();}
 finally{clearTimeout(timer);}
}
export async function normalizeProfilePhoto(bytes:Uint8Array,mime:string):Promise<Uint8Array>{
 try{
  if(bytes.byteLength===0||bytes.byteLength>PROFILE_PHOTO_MAX_BYTES)throw new InvalidProfilePhoto();
  const allowed:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
  if(!allowed[mime])throw new InvalidProfilePhoto();
  // APNG is otherwise decoded as a still image by some libvips builds.
  if(mime==='image/png'){const buffer=Buffer.from(bytes);let offset=8;while(offset+12<=buffer.length){const length=buffer.readUInt32BE(offset);if(buffer.toString('ascii',offset+4,offset+8)==='acTL')throw new InvalidProfilePhoto();offset+=12+length;}}
  const image=sharp(bytes,{limitInputPixels:25_000_000,failOn:'warning',animated:true});
  const metadata=await image.metadata();
  if(metadata.format!==allowed[mime]||(metadata.pages??1)!==1||!metadata.width||!metadata.height||metadata.width*metadata.height>25_000_000)throw new InvalidProfilePhoto();
  // No withMetadata/keepMetadata: Sharp strips EXIF, GPS and source profiles.
  return await image.autoOrient().resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).webp({quality:80}).timeout({seconds:10}).toBuffer();
 }catch{throw new InvalidProfilePhoto();}
}
