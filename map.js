'use strict';

// ── Konfiguration ─────────────────────────────────────────────────────────────
const TOPO_URL       = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const TOPO_SUBS      = ['a', 'b', 'c'];
const TILE_KEY       = 'sunriset-cached-tiles-v1';
const FETCH_DELAY_MS = 40;   // ms zwischen Tile-Requests (Serverbelastung begrenzen)
const TILE_LIMIT     = 1500; // Warnung wenn mehr als diese Anzahl zu laden wäre
const SAVE_ZOOM_MIN  = 8;    // absolutes Minimum beim Speichern
const SAVE_ZOOM_MAX  = 15;   // absolutes Maximum beim Speichern

// ── Gecachte Kacheln persistent verwalten ─────────────────────────────────────
// Wir tracken in localStorage welche Kacheln (z/x/y) bereits geladen wurden,
// um das Cache-Overlay auch nach einem App-Neustart korrekt anzuzeigen.
let cachedTiles = new Set(JSON.parse(localStorage.getItem(TILE_KEY) || '[]'));

function persistTiles() {
    // localStorage-Limit (~5 MB) im Auge behalten: älteste Einträge entfernen
    if (cachedTiles.size > 60000) {
        const arr = [...cachedTiles];
        cachedTiles = new Set(arr.slice(arr.length - 50000));
    }
    try {
        localStorage.setItem(TILE_KEY, JSON.stringify([...cachedTiles]));
    } catch (_) { /* QuotaExceededError ignorieren */ }
}

function tileKey(z, x, y) { return `${z}/${x}/${y}`; }

// ── Karte initialisieren ──────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true })
             .setView([47.4, 11.0], 11);

function _updateZoomDisplay() {
    const el = document.getElementById('zoom-level');
    if (el) el.textContent = `Zoom ${map.getZoom()}`;
}
map.on('zoomend', _updateZoomDisplay);
_updateZoomDisplay();

L.tileLayer(TOPO_URL, {
    attribution: '© <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA) | © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    maxZoom: 17,
    subdomains: TOPO_SUBS,
}).addTo(map);

// Jede geladene Kachel in localStorage registrieren und Overlay aktualisieren
map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
        layer.on('tileload', e => {
            const key = tileKey(e.coords.z, e.coords.x, e.coords.y);
            if (!cachedTiles.has(key)) {
                cachedTiles.add(key);
                persistTiles();
                cacheOverlay.redraw();
            }
        });
    }
});

// ── Cache-Overlay ─────────────────────────────────────────────────────────────
// Zeichnet ein grünes Rechteck über jede Kachel, die bereits gecacht ist.
const CacheOverlay = L.GridLayer.extend({
    createTile(coords) {
        const div = L.DomUtil.create('div', '');
        if (cachedTiles.has(tileKey(coords.z, coords.x, coords.y))) {
            div.className = 'tile-cached';
        }
        return div;
    },
});
const cacheOverlay = new CacheOverlay({ zIndex: 400 });
cacheOverlay.addTo(map);

// tileload-Listener auf alle TileLayer setzen (auch nach addTo)
map.on('layeradd', e => {
    if (e.layer instanceof L.TileLayer) {
        e.layer.on('tileload', ev => {
            const key = tileKey(ev.coords.z, ev.coords.x, ev.coords.y);
            if (!cachedTiles.has(key)) {
                cachedTiles.add(key);
                persistTiles();
                cacheOverlay.redraw();
            }
        });
    }
});

// ── Marker bei Klick auf Karte ────────────────────────────────────────────────
let _marker = null;

map.on('click', e => {
    const { lat, lng } = e.latlng;
    _setMarker(lat, lng);
    document.getElementById('lat').value = lat.toFixed(5);
    document.getElementById('lon').value = lng.toFixed(5);
});

/**
 * Marker auf der Karte setzen und Karte auf diesen Punkt zentrieren.
 * Wird auch von app.js (GPS-Button) aufgerufen.
 */
function setMapMarker(lat, lng) {
    _setMarker(lat, lng);
    map.setView([lat, lng], Math.max(map.getZoom(), 13));
}

function _setMarker(lat, lng) {
    if (_marker) map.removeLayer(_marker);
    _marker = L.circleMarker([lat, lng], {
        radius: 9,
        fillColor: '#f4a261',
        color: '#fff',
        weight: 2.5,
        fillOpacity: 1,
    }).addTo(map);
}

// ── "Bereich offline speichern" ───────────────────────────────────────────────
document.getElementById('save-area-btn').addEventListener('click', saveArea);
document.getElementById('save-all-btn').addEventListener('click', saveAllZooms);
document.getElementById('clear-cache-btn').addEventListener('click', clearTileCache);
document.getElementById('overlay-toggle').addEventListener('change', e => {
    if (e.target.checked) {
        cacheOverlay.addTo(map);
    } else {
        cacheOverlay.remove();
    }
});

// Speicherinfo beim Start laden
updateCacheInfo();

async function saveArea() {
    const btn      = document.getElementById('save-area-btn');
    const progress = document.getElementById('save-progress');
    const bounds   = map.getBounds();
    const z        = map.getZoom();

    const zMin = Math.max(SAVE_ZOOM_MIN, z - 2);
    const zMax = Math.min(SAVE_ZOOM_MAX, z + 1);

    const allTiles  = [];
    for (let zoom = zMin; zoom <= zMax; zoom++) {
        allTiles.push(..._tilesForBounds(bounds, zoom));
    }
    const newTiles = allTiles.filter(t => !cachedTiles.has(tileKey(t.z, t.x, t.y)));

    if (newTiles.length === 0) {
        progress.textContent = '✓ Dieser Bereich ist bereits vollständig gespeichert.';
        return;
    }
    if (newTiles.length > TILE_LIMIT) {
        progress.textContent =
            `⚠ ${newTiles.length.toLocaleString()} Kacheln – bitte weiter reinzoomen ` +
            `(max. ${TILE_LIMIT.toLocaleString()}).`;
        return;
    }

    btn.disabled = true;
    progress.textContent = `0 / ${newTiles.length} Kacheln…`;

    let done = 0;
    for (const { z: tz, x, y } of newTiles) {
        const sub = TOPO_SUBS[(x + y) % TOPO_SUBS.length];
        const url = `https://${sub}.tile.opentopomap.org/${tz}/${x}/${y}.png`;
        try {
            await fetch(url, { mode: 'cors' });
            cachedTiles.add(tileKey(tz, x, y));
        } catch (_) { /* Einzelne Fehler ignorieren */ }

        done++;
        progress.textContent = `${done} / ${newTiles.length} Kacheln…`;

        if (done % 25 === 0) {
            persistTiles();
            cacheOverlay.redraw();
            await updateCacheInfo();
        }
        await _sleep(FETCH_DELAY_MS);
    }

    persistTiles();
    cacheOverlay.redraw();
    await updateCacheInfo();
    progress.textContent = `✓ ${done} Kacheln gespeichert (Zoom ${zMin}–${zMax})`;
    btn.disabled = false;
}

/**
 * Speichert alle Zoomstufen von 1 bis zum aktuellen Zoom
 * für den sichtbaren Kartenausschnitt.
 */
async function saveAllZooms() {
    const btn      = document.getElementById('save-all-btn');
    const progress = document.getElementById('save-progress');
    const bounds   = map.getBounds();
    const zMax     = SAVE_ZOOM_MAX; // immer bis zur maximalen Zoomstufe (15)

    const allTiles = [];
    for (let zoom = 1; zoom <= zMax; zoom++) {
        allTiles.push(..._tilesForBounds(bounds, zoom));
    }
    const newTiles = allTiles.filter(t => !cachedTiles.has(tileKey(t.z, t.x, t.y)));

    if (newTiles.length === 0) {
        progress.textContent = '✓ Alle Zoomstufen bereits gespeichert.';
        return;
    }
    if (newTiles.length > TILE_LIMIT) {
        const mb = (newTiles.length * 20 / 1024).toFixed(0);
        progress.textContent =
            `⚠ ${newTiles.length.toLocaleString('de-DE')} Kacheln (ca. ${mb} MB) – ` +
            `bitte weiter reinzoomen (max. ${TILE_LIMIT.toLocaleString('de-DE')}).`;
        return;
    }

    btn.disabled = true;
    const mb = (newTiles.length * 20 / 1024).toFixed(1);
    progress.textContent = `0 / ${newTiles.length} Kacheln (ca. ${mb} MB)…`;

    let done = 0;
    for (const { z: tz, x, y } of newTiles) {
        const sub = TOPO_SUBS[(x + y) % TOPO_SUBS.length];
        const url = `https://${sub}.tile.opentopomap.org/${tz}/${x}/${y}.png`;
        try {
            await fetch(url, { mode: 'cors' });
            cachedTiles.add(tileKey(tz, x, y));
        } catch (_) { /* ignorieren */ }

        done++;
        progress.textContent = `${done} / ${newTiles.length} Kacheln (ca. ${mb} MB)…`;

        if (done % 25 === 0) {
            persistTiles();
            cacheOverlay.redraw();
            await updateCacheInfo();
        }
        await _sleep(FETCH_DELAY_MS);
    }

    persistTiles();
    cacheOverlay.redraw();
    await updateCacheInfo();
    progress.textContent = `✓ ${done} Kacheln gespeichert (Zoom 1–${zMax})`;
    btn.disabled = false;
}

// ── Cache-Verwaltung ──────────────────────────────────────────────────────────

/**
 * Liest die tatsächliche Kachelanzahl aus dem Service-Worker-Cache
 * und zeigt eine Schätzung des Speicherverbrauchs an.
 * Durchschnittliche Kachelgröße OpenTopoMap: ~20 KB.
 */
async function updateCacheInfo() {
    const infoEl = document.getElementById('cache-info');
    if (!('caches' in window)) {
        infoEl.textContent = '';
        return;
    }
    try {
        const cache = await caches.open('sunriset-tiles-v1');
        const keys  = await cache.keys();
        const count = keys.length;
        if (count === 0) {
            infoEl.textContent = 'Kein Karten-Cache';
        } else {
            const mb = (count * 20 / 1024).toFixed(1);
            infoEl.textContent = `${count.toLocaleString('de-DE')} Kacheln · ca. ${mb} MB`;
        }
    } catch (_) {
        infoEl.textContent = '';
    }
}

/** Löscht den gesamten Karten-Cache und setzt das Overlay zurück. */
async function clearTileCache() {
    const btn    = document.getElementById('clear-cache-btn');
    const info   = document.getElementById('cache-info');
    btn.disabled = true;
    info.textContent = 'Wird gelöscht…';

    try {
        await caches.delete('sunriset-tiles-v1');
    } catch (_) { /* ignorieren */ }

    cachedTiles.clear();
    localStorage.removeItem(TILE_KEY);
    cacheOverlay.redraw();
    document.getElementById('save-progress').textContent = '';
    await updateCacheInfo();
    btn.disabled = false;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Konvertiert lat/lng + Zoomlevel in Leaflet-Kachelkoordinaten */
function _latLngToTile(lat, lng, z) {
    const n      = Math.pow(2, z);
    const x      = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y      = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Gibt alle Kachelkoordinaten innerhalb eines Bounds-Objekts zurück */
function _tilesForBounds(bounds, z) {
    const nw    = _latLngToTile(bounds.getNorth(), bounds.getWest(), z);
    const se    = _latLngToTile(bounds.getSouth(), bounds.getEast(), z);
    const tiles = [];
    for (let x = nw.x; x <= se.x; x++) {
        for (let y = nw.y; y <= se.y; y++) {
            tiles.push({ z, x, y });
        }
    }
    return tiles;
}
