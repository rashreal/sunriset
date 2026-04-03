'use strict';

const CACHE      = 'sunriset-v4.5';
const TILE_CACHE = 'sunriset-tiles-v1';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './sun.js',
    './app.js',
    './map.js',
    './manifest.json',
];

// Installation: App-Dateien cachen
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Aktivierung: alten App-Cache löschen (Tile-Cache bleibt erhalten)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE && k !== TILE_CACHE)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch-Handler
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Kartenkacheln: cache-first, bei Miss aus Netz laden und cachen
    if (url.includes('.tile.opentopomap.org') || url.includes('.tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(TILE_CACHE).then(cache =>
                cache.match(event.request).then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        // Opaque (no-cors) und normale Antworten cachen
                        if (response) cache.put(event.request, response.clone());
                        return response;
                    }).catch(() => new Response('', { status: 503 }));
                })
            )
        );
        return;
    }

    // App-Dateien und Leaflet-CDN: cache-first
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // Leaflet-CDN-Dateien beim ersten Laden cachen
                if (url.includes('unpkg.com/leaflet')) {
                    caches.open(CACHE).then(c => c.put(event.request, response.clone()));
                }
                return response;
            });
        })
    );
});
