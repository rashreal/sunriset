'use strict';

// Sunrise/sunset calculation based on the NOAA Solar Calculator algorithm.
// Pure functions – no DOM access, no network requests.
// Reference: https://gml.noaa.gov/grad/solcalc/calcdetails.html

function _toRad(deg) { return deg * (Math.PI / 180); }
function _toDeg(rad) { return rad * (180 / Math.PI); }

function _julianDay(date) {
    // Converts a JS Date to a Julian Day Number (noon-based)
    return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Calculate sun times for a given location and date.
 *
 * @param {number} lat   Latitude  in decimal degrees (positive = North)
 * @param {number} lon   Longitude in decimal degrees (positive = East)
 * @param {Date}   date  The date to calculate for
 * @returns {object}
 *   type: 'normal' | 'polarDay' | 'polarNight'
 *   For 'normal':
 *     sunrise, sunset, solarNoon   – minutes since UTC midnight
 *     civilDawn, civilDusk         – minutes since UTC midnight (or null at high latitudes)
 */
function calcSunTimes(lat, lon, date) {
    const JD = _julianDay(date);
    // Julian centuries since J2000.0
    const T = (JD - 2451545.0) / 36525.0;

    // Geometric mean longitude of the sun (deg)
    let L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
    if (L0 < 0) L0 += 360;

    // Geometric mean anomaly of the sun (deg)
    let M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
    if (M < 0) M += 360;

    // Eccentricity of Earth's orbit
    const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

    // Equation of center (deg)
    const Mrad = _toRad(M);
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad)
            + (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad)
            + 0.000289 * Math.sin(3 * Mrad);

    // Apparent longitude of the sun (deg), corrected for nutation & aberration
    const omega = 125.04 - 1934.136 * T;
    const lambda = (L0 + C) - 0.00569 - 0.00478 * Math.sin(_toRad(omega));

    // Apparent obliquity of the ecliptic (deg)
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const epsilon = eps0 + 0.00256 * Math.cos(_toRad(omega));

    // Solar declination (deg)
    const decl = _toDeg(Math.asin(Math.sin(_toRad(epsilon)) * Math.sin(_toRad(lambda))));

    // Equation of time (minutes)
    const y = Math.pow(Math.tan(_toRad(epsilon / 2)), 2);
    const eqTime = 4 * _toDeg(
        y * Math.sin(2 * _toRad(L0))
        - 2 * e * Math.sin(Mrad)
        + 4 * e * y * Math.sin(Mrad) * Math.cos(2 * _toRad(L0))
        - 0.5 * y * y * Math.sin(4 * _toRad(L0))
        - 1.25 * e * e * Math.sin(2 * Mrad)
    );

    // Solar noon in minutes since UTC midnight
    const solarNoon = 720 - 4 * lon - eqTime;

    const latRad  = _toRad(lat);
    const declRad = _toRad(decl);

    // Returns cosine of the hour angle for a given solar zenith angle (deg).
    function cosHourAngle(zenithDeg) {
        return Math.cos(_toRad(zenithDeg)) / (Math.cos(latRad) * Math.cos(declRad))
               - Math.tan(latRad) * Math.tan(declRad);
    }

    // Sunrise / sunset: zenith = 90.833° (refraction + solar disc radius)
    const cosHA = cosHourAngle(90.833);
    if (cosHA > 1) return { type: 'polarNight' };
    if (cosHA < -1) return { type: 'polarDay' };
    const HA = _toDeg(Math.acos(cosHA));

    // Civil twilight: zenith = 96°
    const cosHA_c = cosHourAngle(96);
    let civilDawn = null, civilDusk = null;
    if (cosHA_c >= -1 && cosHA_c <= 1) {
        const HA_c = _toDeg(Math.acos(cosHA_c));
        civilDawn = solarNoon - 4 * HA_c;
        civilDusk = solarNoon + 4 * HA_c;
    }

    return {
        type:       'normal',
        sunrise:    solarNoon - 4 * HA,
        sunset:     solarNoon + 4 * HA,
        solarNoon,
        civilDawn,
        civilDusk,
    };
}

/**
 * Convert minutes-since-UTC-midnight on a given date to a local HH:MM string.
 * The device's own timezone is used – correct as long as the device clock
 * is set to the local timezone of the hiking area.
 */
function utcMinToLocalHHMM(minutes, date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    d.setTime(d.getTime() + minutes * 60000);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Format a duration in minutes as "X h YY min" */
function fmtDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h} h ${m.toString().padStart(2, '0')} min`;
}
