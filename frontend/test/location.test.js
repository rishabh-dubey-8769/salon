import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSalonDistance,
  LOCATION_FIX_STORAGE_KEY,
  readStoredLocationFix,
  shouldAcceptLocationFix,
} from '../src/location.js';

test('a later coarse location cannot replace a precise location across town', () => {
  const preciseFix = {
    lat: 25.5814174,
    lng: 84.8322081,
    accuracy: 5,
    timestamp: 1000,
  };
  const coarseFix = {
    lat: 25.5941,
    lng: 85.1376,
    accuracy: 100,
    timestamp: 2000,
  };

  assert.equal(shouldAcceptLocationFix(preciseFix, coarseFix), false);
});

test('a nearby newer fix is accepted when movement is plausible', () => {
  const currentFix = {
    lat: 25.5814174,
    lng: 84.8322081,
    accuracy: 5,
    timestamp: 1000,
  };
  const nextFix = {
    lat: 25.5816174,
    lng: 84.8322081,
    accuracy: 5,
    timestamp: 10_000,
  };

  assert.equal(shouldAcceptLocationFix(currentFix, nextFix), true);
});

test('a significantly more accurate GPS fix replaces an inaccurate network location', () => {
  const coarseNetworkFix = {
    lat: 25.5941,
    lng: 85.1376,
    accuracy: 1000,
    timestamp: 1000,
  };
  const preciseGpsFix = {
    lat: 25.5814174,
    lng: 84.8322081,
    accuracy: 5,
    timestamp: 2000,
  };

  assert.equal(shouldAcceptLocationFix(coarseNetworkFix, preciseGpsFix), true);
});

test('a valid recent location fix is reused across a page refresh', () => {
  const fix = {
    lat: 25.5814174,
    lng: 84.8322081,
    accuracy: 8,
    timestamp: 1_000_000,
  };
  const storage = {
    getItem: (key) => key === LOCATION_FIX_STORAGE_KEY ? JSON.stringify(fix) : null,
  };

  assert.deepEqual(readStoredLocationFix(storage, 1_000_001), fix);
  assert.equal(readStoredLocationFix(storage, 1_000_000 + 31 * 60 * 1000), null);
});

test('distances use metres below one kilometre and kilometres at or above it', () => {
  assert.equal(formatSalonDistance(0.0044, 500), '4 metres away');
  assert.equal(formatSalonDistance(0.2, 100), '200 metres away');
  assert.equal(formatSalonDistance(0.9996), '1.0 kilometres away');
  assert.equal(formatSalonDistance(6.8, 200), '6.8 kilometres away');
  assert.equal(formatSalonDistance(1), '1.0 kilometres away');
  assert.equal(formatSalonDistance(null), 'Distance unknown');
});
