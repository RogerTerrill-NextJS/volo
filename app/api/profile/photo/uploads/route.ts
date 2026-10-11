import {handlePhotoRoute} from '../../../../../lib/profiles/photo-route';
export const runtime='nodejs';
export async function POST(request:Request){return handlePhotoRoute(request,'reserve');}
