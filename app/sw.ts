import type {PrecacheEntry, SerwistGlobalConfig} from 'serwist';
import {Serwist} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Deliberately minimal and PII-safe. We precache ONLY Next's hashed static build
// assets (JS/CSS chunks, fonts, icons — no customer data). We do NOT register any
// runtime caching for navigations, /api, or Supabase reads: this app is behind
// Google auth and renders customer PII, so an authenticated response must never be
// written to the cache (it could leak across sessions on a shared device). With
// `cacheOnNavigation: false` in next.config, every non-precached request — every
// page and data fetch — falls straight through to the network.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
});

serwist.addEventListeners();
