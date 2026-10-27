// Reproduce the app icons from the checked-in vector; no remote assets or fonts.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('scripts/assets/volo-icon.svg',root));
await writeFile(new URL('app/icon.svg',root),source);
for(const [file,size] of [['public/pwa/icon-192.png',192],['public/pwa/icon-512.png',512],['app/apple-icon.png',180]]){
  await sharp(source).resize(size,size).png().toFile(new URL(file,root).pathname);
}
const png=await sharp(source).resize(32,32).png().toBuffer();
// ICO directory with a single PNG-encoded 32px image.
const header=Buffer.alloc(22);
header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
header[6]=32;header[7]=32;
header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);
header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await writeFile(new URL('app/favicon.ico',root),Buffer.concat([header,png]));
