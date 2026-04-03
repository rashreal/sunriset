'use strict';

// Service Worker – cached alle App-Dateien für Offline-Betrieb.
// Version hochzählen, um den Cache bei Updates zu leeren.
const CACHE = 'sunriset-v2';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './sun.js',
    './app.js',
    './manifest.json',
];

// Installation: alle Dateien in den Cache laden
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Aktivierung: alten Cache löschen
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: erst Cache, dann Netzwerk (Cache-First für zuverlässigen Offline-Betrieb)
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
