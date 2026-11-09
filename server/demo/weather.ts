// The demo's weather (#257): any city, made-up skies, no network.
import type { WeatherApi } from '../weather.ts';
import { registerDemo } from './registry.ts';

/** A weather word in the demo's city ("Rainytown", "Snow Hill") picks that weather: these WMO codes. */
const DEMO_SKIES: [RegExp, number][] = [
  [/storm|thunder/i, 95],
  [/snow/i, 75],
  [/fog|mist/i, 45],
  [/heavy|pour/i, 65],
  [/rain|drizzle/i, 61],
  [/cloud|grey|gray/i, 3],
  [/sun|clear/i, 0],
];
/** Any other city gets these in turn, a new one every 15 minutes. */
const DEMO_ROTATION = [0, 2, 61, 3, 45, 63, 95, 1, 71];
const demoPlaces = new Map<string, { code: number | null; offline: boolean }>();

/**
 * No network: any city is found ("Atlantis" and "Nowhere" aren't), at made-up coordinates. A weather word in its name
 * picks the weather; "offline" in it makes every reading fail, to see the office fall back to the calm cycle.
 */
const demoWeather: WeatherApi = {
  geocode: async (city) => {
    await new Promise((r) => setTimeout(r, 200));
    if (/atlantis|nowhere/i.test(city)) return null;
    const h = [...city.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const lat = Math.round(((h % 12000) / 100 - 60) * 100) / 100;
    const lon = Math.round((((h >>> 8) % 34000) / 100 - 170) * 100) / 100;
    demoPlaces.set(`${lat},${lon}`, { code: DEMO_SKIES.find(([re]) => re.test(city))?.[1] ?? null, offline: /offline/i.test(city) });
    return { name: `${city} (demo)`, lat, lon };
  },
  current: async (lat, lon) => {
    const p = demoPlaces.get(`${lat},${lon}`);
    if (p?.offline) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (p?.code != null) return { code: p.code, wind: p.code === 95 ? 55 : 12 };
    const slot = Math.floor(Date.now() / (15 * 60_000)) + Math.abs(Math.round(lat + lon));
    return { code: DEMO_ROTATION[slot % DEMO_ROTATION.length], wind: 10 };
  },
};

registerDemo('weather', () => ({ weather: demoWeather }));
