'use client';

import {useEffect} from 'react';

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // Browsing and auth must continue to work when registration is unavailable.
    void navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => {});
  }, []);
  return null;
}
