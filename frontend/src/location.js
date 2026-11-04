export const MAX_LOCATION_ACCURACY_METERS = 5_000;
export const LOCATION_FIX_STORAGE_KEY = 'salonflow.locationFix';
export const LOCATION_FIX_MAX_AGE_MS = 30 * 60 * 1000;

const distanceBetweenFixes = (first, second) => {
  const radians = (value) => (value * Math.PI) / 180;
  const deltaLat = radians(second.lat - first.lat);
  const deltaLng = radians(second.lng - first.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export function shouldAcceptLocationFix(current, next) {
  if (!Number.isFinite(next.lat) || next.lat < -90 || next.lat > 90 ||
    !Number.isFinite(next.lng) || next.lng < -180 || next.lng > 180 ||
    !Number.isFinite(next.accuracy) || next.accuracy <= 0 ||
    next.accuracy > MAX_LOCATION_ACCURACY_METERS) return false;
  if (!current) return true;

  const displacement = distanceBetweenFixes(current, next);
  const elapsedSeconds = Math.max(0, next.timestamp - current.timestamp) / 1000;
  const plausibleTravel = elapsedSeconds * 50 + current.accuracy + next.accuracy;
  const significantlyMoreAccurate = next.accuracy < current.accuracy / 5;
  if (next.timestamp < current.timestamp || (displacement > plausibleTravel && !significantlyMoreAccurate)) return false;
  return displacement > current.accuracy + next.accuracy || next.accuracy < current.accuracy;
}

export function readStoredLocationFix(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const stored = storage?.getItem(LOCATION_FIX_STORAGE_KEY);
    if (!stored) return null;
    const fix = JSON.parse(stored);
    if (!fix || now - fix.timestamp > LOCATION_FIX_MAX_AGE_MS ||
      now < fix.timestamp || !shouldAcceptLocationFix(null, fix)) return null;
    return fix;
  } catch {
    return null;
  }
}

export function storeLocationFix(fix, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(LOCATION_FIX_STORAGE_KEY, JSON.stringify(fix));
  } catch {
    return false;
  }
  return Boolean(storage);
}

export function formatSalonDistance(distanceKm, accuracyMeters = 0) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 'Distance unknown';
  const meters = Math.round(distanceKm * 1000);
  return meters < 1000 ? `${meters} metres away` : `${distanceKm.toFixed(1)} kilometres away`;
}
