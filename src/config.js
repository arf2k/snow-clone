// src/config.js
const base = new URL('.', window.location.href);
export const RESORTS_JSON_URL = new URL('public/resorts.json', base).toString();

export const WIND_HOLD_GUST_MPH = 32;
export const DEFAULT_OVERLAY = 'snow';
export const DEFAULT_ZOOM = 8;
