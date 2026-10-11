import {readCurrentProfilePhoto} from '../../../../../lib/profiles/photo-read';

export async function GET(_request:Request,{params}:{params:Promise<{userId:string}>}){
 return readCurrentProfilePhoto((await params).userId);
}
