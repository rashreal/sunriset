'use strict';

// ── Service Worker registrieren (ermöglicht Offline-Betrieb) ──────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('Service Worker konnte nicht registriert werden:', err);
    });
}

// ── DOM-Elemente ──────────────────────────────────────────────────────────────
const form       = document.getElementById('location-form');
const latInput   = document.getElementById('lat');
const lonInput   = document.getElementById('lon');
const dateInput  = document.getElementById('date');
const gpsBtn     = document.getElementById('gps-btn');
const errorBox   = document.getElementById('error-msg');
const results    = document.getElementById('results');
const polarMsg   = document.getElementById('polar-msg');
const sunResults = document.getElementById('sun-results');

// ── Standardwerte ─────────────────────────────────────────────────────────────
dateInput.value = new Date().toISOString().slice(0, 10);

// ── GPS-Button ────────────────────────────────────────────────────────────────
gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        showError('GPS wird von diesem Browser nicht unterstützt.');
        return;
    }
    gpsBtn.classList.add('loading');
    gpsBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        pos => {
            latInput.value = pos.coords.latitude.toFixed(5);
            lonInput.value = pos.coords.longitude.toFixed(5);
            gpsBtn.classList.remove('loading');
            gpsBtn.disabled = false;
            calculate();
        },
        () => {
            showError('GPS-Zugriff verweigert oder Standort nicht verfügbar.');
            gpsBtn.classList.remove('loading');
            gpsBtn.disabled = false;
        },
        { timeout: 10000 }
    );
});

// ── Formular ──────────────────────────────────────────────────────────────────
form.addEventListener('submit', e => {
    e.preventDefault();
    calculate();
});

// ── Berechnung ────────────────────────────────────────────────────────────────
function calculate() {
    const lat  = parseFloat(latInput.value);
    const lon  = parseFloat(lonInput.value);
    const dateStr = dateInput.value;

    if (!dateStr || isNaN(lat) || isNaN(lon)) {
        showError('Bitte Breitengrad, Längengrad und Datum eingeben.');
        return;
    }
    if (lat < -90 || lat > 90) {
        showError('Breitengrad muss zwischen -90 und 90 liegen.');
        return;
    }
    if (lon < -180 || lon > 180) {
        showError('Längengrad muss zwischen -180 und 180 liegen.');
        return;
    }

    clearError();

    // Mittag UTC verwenden, um Datumsrandprobleme zu vermeiden
    const date = new Date(dateStr + 'T12:00:00Z');
    const res  = calcSunTimes(lat, lon, date);

    results.hidden = false;

    if (res.type === 'polarNight') {
        showPolarMsg('🌑 Polarnacht – die Sonne geht an diesem Tag nicht auf.');
        return;
    }
    if (res.type === 'polarDay') {
        showPolarMsg('☀️ Polartag – die Sonne geht an diesem Tag nicht unter.');
        return;
    }

    // Ergebnisse anzeigen
    polarMsg.hidden  = true;
    sunResults.hidden = false;

    setText('res-sunrise',   utcMinToLocalHHMM(res.sunrise,   date));
    setText('res-sunset',    utcMinToLocalHHMM(res.sunset,    date));
    setText('res-noon',      utcMinToLocalHHMM(res.solarNoon, date));
    setText('res-daylength', fmtDuration(res.sunset - res.sunrise));

    const twilightRow = document.getElementById('twilight-row');
    if (res.civilDawn !== null) {
        setText('res-dawn', utcMinToLocalHHMM(res.civilDawn, date));
        setText('res-dusk', utcMinToLocalHHMM(res.civilDusk, date));
        twilightRow.hidden = false;
    } else {
        twilightRow.hidden = true;
    }

    drawTimeline(res, date);
}

// ── Tageslicht-Balken ─────────────────────────────────────────────────────────
function drawTimeline(res, date) {
    const bar     = document.getElementById('timeline');
    const nowLine = document.getElementById('now-line');
    const nowLabel = document.getElementById('now-label');

    // Prozent des Tages (0–100)
    const pct = m => `${((m / 1440) * 100).toFixed(2)}%`;

    const dawn   = res.civilDawn  ?? res.sunrise;
    const dusk   = res.civilDusk  ?? res.sunset;
    const rise   = res.sunrise;
    const set    = res.sunset;

    // Gradient: Nacht → Dämmerung → Tag → Dämmerung → Nacht
    bar.style.background = `linear-gradient(to right,
        #0f0e17 0%,
        #0f0e17 ${pct(dawn)},
        #c07a3a ${pct(rise)},
        #f4d03f ${pct(res.solarNoon)},
        #c07a3a ${pct(set)},
        #0f0e17 ${pct(dusk)},
        #0f0e17 100%
    )`;

    // Aktuelle Uhrzeit als senkrechter Strich
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowPct = ((nowMin / 1440) * 100).toFixed(2);
    nowLine.style.left  = `${nowPct}%`;
    nowLabel.style.left = `${nowPct}%`;
    nowLabel.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('timeline-wrap').hidden = false;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function setText(id, text) {
    document.getElementById(id).textContent = text;
}
function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
}
function clearError() {
    errorBox.hidden = true;
}
function showPolarMsg(msg) {
    polarMsg.textContent  = msg;
    polarMsg.hidden       = false;
    sunResults.hidden     = true;
    document.getElementById('timeline-wrap').hidden = true;
}
