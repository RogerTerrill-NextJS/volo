import type {MetadataRoute} from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'VOLO',
    short_name: 'VOLO',
    description: 'Connect with fellow pilots and coordinate shared flights.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
    ],
  };
}
