'use strict';

// ── Service Worker registrieren (ermöglicht Offline-Betrieb) ──────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('Service Worker konnte nicht registriert werden:', err);
    });
}

// ── DOM-Elemente ──────────────────────────────────────────────────────────────
const form          = document.getElementById('location-form');
const latInput      = document.getElementById('lat');
const lonInput      = document.getElementById('lon');
const elevInput     = document.getElementById('elevation');
const dateInput     = document.getElementById('date');
const gpsBtn        = document.getElementById('gps-btn');
const errorBox      = document.getElementById('error-msg');
const results       = document.getElementById('results');
const polarMsg      = document.getElementById('polar-msg');
const sunResults    = document.getElementById('sun-results');

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
            latInput.value  = pos.coords.latitude.toFixed(5);
            lonInput.value  = pos.coords.longitude.toFixed(5);
            // GPS-Höhe übernehmen, wenn verfügbar (kann ungenau sein)
            if (pos.coords.altitude !== null) {
                elevInput.value = Math.round(pos.coords.altitude);
            }
            gpsBtn.classList.remove('loading');
            gpsBtn.disabled = false;
            calculate();
        },
        () => {
            showError('GPS-Zugriff verweigert oder Standort nicht verfügbar.');
            gpsBtn.classList.remove('loading');
            gpsBtn.disabled = false;
        },
        { timeout: 10000, enableHighAccuracy: true }
    );
});

// ── Formular ──────────────────────────────────────────────────────────────────
form.addEventListener('submit', e => {
    e.preventDefault();
    calculate();
});

// ── Berechnung ────────────────────────────────────────────────────────────────
function calculate() {
    const lat      = parseFloat(latInput.value);
    const lon      = parseFloat(lonInput.value);
    const elevRaw  = elevInput.value.trim();
    const elev     = elevRaw === '' ? 0 : parseFloat(elevRaw);
    const dateStr  = dateInput.value;

    if (!dateStr || isNaN(lat) || isNaN(lon)) {
        showError('Bitte Breitengrad, Längengrad und Datum eingeben.');
        return;
    }
    if (lat < -90 || lat > 90)   { showError('Breitengrad muss zwischen -90 und 90 liegen.');   return; }
    if (lon < -180 || lon > 180) { showError('Längengrad muss zwischen -180 und 180 liegen.');  return; }
    if (isNaN(elev) || elev < 0) { showError('Höhe muss eine positive Zahl sein (oder leer lassen für 0 m).'); return; }

    clearError();

    const date    = new Date(dateStr + 'T12:00:00Z');
    const { sealevel, openHorizon, dipDeg } = calcSunTimes(lat, lon, date, elev);
    const hasElev = elev > 0;

    results.hidden = false;

    if (sealevel.type === 'polarNight') { showPolarMsg('🌑 Polarnacht – die Sonne geht an diesem Tag nicht auf.'); return; }
    if (sealevel.type === 'polarDay')   { showPolarMsg('☀️ Polartag – die Sonne geht an diesem Tag nicht unter.'); return; }

    polarMsg.hidden   = true;
    sunResults.hidden = false;

    // ── Spaltenüberschrift für Höhen-Spalte ───────────────────────────────────
    const colElev = document.getElementById('col-elev');
    colElev.hidden = !hasElev;
    if (hasElev) colElev.textContent = `${Math.round(elev)} m (freier Horizont)`;

    // ── Hinweistext ───────────────────────────────────────────────────────────
    const hint = document.getElementById('elevation-hint');
    if (hasElev) {
        hint.textContent =
            `Horizontabsenkung durch Höhe: ${dipDeg.toFixed(2)}°. ` +
            `Der tatsächliche Wert liegt zwischen den beiden Spalten – ` +
            `je nachdem wie weit die umliegenden Berge den Horizont anheben.`;
        hint.hidden = false;
    } else {
        hint.hidden = true;
    }

    // ── Werte eintragen ───────────────────────────────────────────────────────
    fillRow('sunrise',   sealevel, openHorizon, date, hasElev, /* früherer Aufgang = negativ gut */ true);
    fillRow('sunset',    sealevel, openHorizon, date, hasElev, false);
    fillRow('noon',      sealevel, openHorizon, date, hasElev, null);
    fillRow('daylength', sealevel, openHorizon, date, hasElev, false);

    // ── Dämmerung ─────────────────────────────────────────────────────────────
    const twilightRow = document.getElementById('twilight-row');
    if (sealevel.civilDawn !== null) {
        setText('res-dawn-sl', utcMinToLocalHHMM(sealevel.civilDawn, date));
        setText('res-dusk-sl', utcMinToLocalHHMM(sealevel.civilDusk, date));
        if (hasElev && openHorizon.civilDawn !== null) {
            setText('res-dawn-oh', utcMinToLocalHHMM(openHorizon.civilDawn, date));
            setText('res-dusk-oh', utcMinToLocalHHMM(openHorizon.civilDusk, date));
        }
        setColVisible('cell-dawn-oh', hasElev);
        setColVisible('cell-dusk-oh', hasElev);
        twilightRow.hidden = false;
    } else {
        twilightRow.hidden = true;
    }

    drawTimeline(sealevel, date);
}

/**
 * Befüllt eine Ergebniszeile für Meereshöhe und ggf. Höhenkorrektur.
 * @param {string}  key       'sunrise' | 'sunset' | 'noon' | 'daylength'
 * @param {object}  sl        sealevel-Ergebnis
 * @param {object}  oh        openHorizon-Ergebnis
 * @param {Date}    date
 * @param {boolean} hasElev   Ob Höhe eingegeben wurde
 * @param {boolean|null} lowerIsBetter  true = früherer Wert gut (Aufgang), false = später gut (Untergang), null = kein Pfeil
 */
function fillRow(key, sl, oh, date, hasElev, lowerIsBetter) {
    const isDuration = key === 'daylength';

    const slVal = isDuration
        ? fmtDuration(sl.sunset - sl.sunrise)
        : utcMinToLocalHHMM(sl[key === 'daylength' ? 'sunrise' : key], date);

    setText(`res-${key}-sl`, slVal);

    const cellId = `cell-${key}-oh`;
    setColVisible(cellId, hasElev);

    if (!hasElev) return;

    const ohVal = isDuration
        ? fmtDuration(oh.sunset - oh.sunrise)
        : utcMinToLocalHHMM(oh[key === 'daylength' ? 'sunrise' : key], date);

    setText(`res-${key}-oh`, ohVal);

    // Differenz anzeigen
    const diffEl = document.getElementById(`diff-${key}`);
    if (!diffEl) return;

    let diffMin;
    if (isDuration) {
        diffMin = (oh.sunset - oh.sunrise) - (sl.sunset - sl.sunrise);
    } else {
        diffMin = oh[key] - sl[key];
    }

    diffEl.textContent = fmtDiff(diffMin);
    diffEl.className   = 'diff';
}

// ── Tageslicht-Balken ─────────────────────────────────────────────────────────
function drawTimeline(res, date) {
    const nowLine  = document.getElementById('now-line');
    const nowLabel = document.getElementById('now-label');
    const bar      = document.getElementById('timeline');

    const pct  = m => `${((m / 1440) * 100).toFixed(2)}%`;
    const dawn = res.civilDawn ?? res.sunrise;
    const dusk = res.civilDusk ?? res.sunset;

    bar.style.background = `linear-gradient(to right,
        #0f0e17 0%,
        #0f0e17 ${pct(dawn)},
        #c07a3a ${pct(res.sunrise)},
        #f4d03f ${pct(res.solarNoon)},
        #c07a3a ${pct(res.sunset)},
        #0f0e17 ${pct(dusk)},
        #0f0e17 100%)`;

    const now    = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowPct = ((nowMin / 1440) * 100).toFixed(2);
    nowLine.style.left  = `${nowPct}%`;
    nowLabel.style.left = `${nowPct}%`;
    nowLabel.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('timeline-wrap').hidden = false;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
function setColVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
}
function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
}
function clearError() {
    errorBox.hidden = true;
}
function showPolarMsg(msg) {
    polarMsg.textContent = msg;
    polarMsg.hidden      = false;
    sunResults.hidden    = true;
    document.getElementById('timeline-wrap').hidden = true;
}
