import {handlePhotoRoute} from '../../../../lib/profiles/photo-route';
export const runtime='nodejs';
export async function POST(request:Request){return handlePhotoRoute(request,'finalize');}
export async function DELETE(request:Request){return handlePhotoRoute(request,'remove');}
