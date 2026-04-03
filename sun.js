'use strict';

// Sunrise/sunset calculation based on the NOAA Solar Calculator algorithm.
// Pure functions – no DOM access, no network requests.
// Reference: https://gml.noaa.gov/grad/solcalc/calcdetails.html

function _toRad(deg) { return deg * (Math.PI / 180); }
function _toDeg(rad) { return rad * (180 / Math.PI); }

function _julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Calculate sun times for one specific set of zenith angles.
 * Returns { type, sunrise, sunset, solarNoon, civilDawn, civilDusk }
 * or { type: 'polarDay' } / { type: 'polarNight' }.
 */
function _calcForZeniths(zenithRise, zenithCivil, solarNoon, latRad, declRad) {
    function cosHA(z) {
        return Math.cos(_toRad(z)) / (Math.cos(latRad) * Math.cos(declRad))
               - Math.tan(latRad) * Math.tan(declRad);
    }

    const c = cosHA(zenithRise);
    if (c > 1) return { type: 'polarNight' };
    if (c < -1) return { type: 'polarDay' };
    const HA = _toDeg(Math.acos(c));

    const cc = cosHA(zenithCivil);
    let civilDawn = null, civilDusk = null;
    if (cc >= -1 && cc <= 1) {
        const HAc = _toDeg(Math.acos(cc));
        civilDawn = solarNoon - 4 * HAc;
        civilDusk = solarNoon + 4 * HAc;
    }

    return {
        type: 'normal',
        sunrise:   solarNoon - 4 * HA,
        sunset:    solarNoon + 4 * HA,
        solarNoon,
        civilDawn,
        civilDusk,
    };
}

/**
 * Calculate sun times for a given location, date, and optional elevation.
 *
 * @param {number} lat         Latitude  in decimal degrees (positive = North)
 * @param {number} lon         Longitude in decimal degrees (positive = East)
 * @param {Date}   date        The date to calculate for
 * @param {number} elevationM  Elevation above sea level in metres (default 0)
 *
 * @returns {{ sealevel: object, openHorizon: object }}
 *   Both objects have the same shape:
 *     type: 'normal' | 'polarDay' | 'polarNight'
 *   For 'normal':
 *     sunrise, sunset, solarNoon, civilDawn, civilDusk  (minutes since UTC midnight)
 *
 *   sealevel    – standard calculation (horizon at 0 m)
 *   openHorizon – corrected for elevation assuming a clear, unobstructed horizon
 *                 (reality lies somewhere between the two when mountains surround you)
 */
function calcSunTimes(lat, lon, date, elevationM = 0) {
    const JD = _julianDay(date);
    const T  = (JD - 2451545.0) / 36525.0;

    let L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
    if (L0 < 0) L0 += 360;

    let M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
    if (M < 0) M += 360;

    const e    = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    const Mrad = _toRad(M);
    const C    = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad)
               + (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad)
               + 0.000289 * Math.sin(3 * Mrad);

    const omega   = 125.04 - 1934.136 * T;
    const lambda  = (L0 + C) - 0.00569 - 0.00478 * Math.sin(_toRad(omega));
    const eps0    = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const epsilon = eps0 + 0.00256 * Math.cos(_toRad(omega));

    const decl    = _toDeg(Math.asin(Math.sin(_toRad(epsilon)) * Math.sin(_toRad(lambda))));
    const y       = Math.pow(Math.tan(_toRad(epsilon / 2)), 2);
    const eqTime  = 4 * _toDeg(
        y * Math.sin(2 * _toRad(L0))
        - 2 * e * Math.sin(Mrad)
        + 4 * e * y * Math.sin(Mrad) * Math.cos(2 * _toRad(L0))
        - 0.5 * y * y * Math.sin(4 * _toRad(L0))
        - 1.25 * e * e * Math.sin(2 * Mrad)
    );

    const solarNoon = 720 - 4 * lon - eqTime;
    const latRad    = _toRad(lat);
    const declRad   = _toRad(decl);

    // Standard zenith angles (sea level, atmospheric refraction included)
    const Z_RISE  = 90.833; // sunrise/sunset
    const Z_CIVIL = 96.0;   // civil twilight

    // Horizon dip due to elevation (degrees).
    // Formula includes terrestrial refraction correction factor.
    // At 2000 m: ~1.6°  /  At 4000 m: ~2.2°
    const dip = elevationM > 0 ? 0.0353 * Math.sqrt(elevationM) : 0;

    const sealevel    = _calcForZeniths(Z_RISE,       Z_CIVIL,       solarNoon, latRad, declRad);
    const openHorizon = _calcForZeniths(Z_RISE + dip, Z_CIVIL + dip, solarNoon, latRad, declRad);

    return { sealevel, openHorizon, dipDeg: dip };
}

/**
 * Convert minutes since UTC midnight on a given date to a local HH:MM string.
 * Uses the device's local timezone.
 */
function utcMinToLocalHHMM(minutes, date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    d.setTime(d.getTime() + minutes * 60000);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Format a duration in minutes as "13h02m" */
function fmtDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h${m.toString().padStart(2, '0')}m`;
}

/** Format a signed minute difference as e.g. "−3 min" or "+3 min" */
function fmtDiff(diffMinutes) {
    const sign = diffMinutes <= 0 ? '−' : '+';
    return `${sign}${Math.abs(Math.round(diffMinutes))} min`;
}
