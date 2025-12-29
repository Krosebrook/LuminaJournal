
const CACHE_NAME = 'lumina-v4-cache';
const DYNAMIC_CACHE_NAME = 'lumina-dynamic-v1';
const TERMINAL_CACHE = 'lumina-terminal-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './index.tsx',
  'https://cdn.tailwindcss.com',
  'https://img.icons8.com/fluency/192/000000/sparkling-diamond.png'
];

// Fallback image for when media is unavailable offline
const OFFLINE_IMAGE_URL = 'https://img.icons8.com/fluency/192/000000/offline.png';

/**
 * Installation: Cache the core application shell and terminal interface assets.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching App Shell & Terminal Assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

/**
 * Activation: Cleanup stale caches.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE_NAME && key !== TERMINAL_CACHE) {
            console.log('[SW] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

/**
 * Fetch handling with specialized logic for Terminal API requests and offline fallbacks.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Specialized handling for Gemini API (Neural Engine)
  if (url.hostname === 'generativelanguage.googleapis.com') {
    event.respondWith(handleNeuralRequest(request));
    return;
  }

  // 2. Navigation Strategy: Network-First with Fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3. Asset Strategy: Cache-First (Fonts, Icons, Scripts, Terminal Templates)
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('icons8.com') ||
    url.hostname === 'esm.sh'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4. Everything else: Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Strategy: Neural Engine Request Handler
 * Implements a Network-First strategy for AI calls with a meaningful 
 * offline fallback for the Terminal playground.
 */
async function handleNeuralRequest(request) {
  try {
    const networkResponse = await fetch(request);
    // Note: We typically don't cache POST responses in the standard Cache API, 
    // but we can log successful interactions if needed.
    return networkResponse;
  } catch (err) {
    console.log('[SW] Neural connection failed. Generating offline fallback.');
    
    // Check if the request is likely a terminal prompt (based on typical usage)
    // We return a synthetic JSON response that the Gemini SDK/App can interpret.
    const offlineMessage = {
      candidates: [{
        content: {
          parts: [{
            text: "--- OFFLINE LOG ---\nLumina neural engine is currently disconnected. Your request has been logged to the local buffer in Dexie. Please check your connection to resume real-time collaboration with Gemini."
          }]
        },
        finishReason: "OTHER"
      }]
    };

    return new Response(JSON.stringify(offlineMessage), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Strategy: Network-First
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await cache.match(request);
    return cachedResponse || (await caches.match('./index.html'));
  }
}

/**
 * Strategy: Cache-First
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE_NAME);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (request.destination === 'image') {
      return caches.match(OFFLINE_IMAGE_URL);
    }
    throw err;
  }
}

/**
 * Strategy: Stale-While-Revalidate
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || fetchPromise;
}
