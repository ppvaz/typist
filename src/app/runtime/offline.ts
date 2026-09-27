// Offline operation (docs/architecture.md, "Offline operation and updates").
// The service worker precaches the shell, fonts and corpora. The page only
// claims offline readiness after the worker confirms every asset is cached,
// and an update activates between sessions, never during a timed block.
import type { AppStore } from '../store/AppStore';

interface StatusMessage {
  readonly type: 'status';
  readonly version: string;
  readonly total: number;
  readonly missing: readonly string[];
}

export function registerOffline(store: AppStore): void {
  if (import.meta.env.DEV) {
    store.setOffline({ state: 'dev', missing: [], updateReady: false });
    return;
  }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    store.setOffline({ state: 'unsupported', missing: [], updateReady: false });
    return;
  }
  const sw = navigator.serviceWorker;
  // Whether a worker already controlled this page when it loaded: only then
  // is a controller change an update (the first install merely claims it).
  const hadController = !!sw.controller;
  let updateReady = false;
  let reloading = false;

  const check = async () => {
    const registration = await sw.ready;
    registration.active?.postMessage({ type: 'check' });
  };

  sw.addEventListener('message', (event: MessageEvent<StatusMessage>) => {
    if (event.data?.type !== 'status') return;
    store.setOffline({ state: event.data.missing.length === 0 ? 'ready' : 'partial', missing: event.data.missing, updateReady });
  });

  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      void check();
      return;
    }
    if (reloading) return;
    reloading = true;
    // Reached only after the user applied an update between sessions.
    location.reload();
  });

  const markUpdate = () => {
    updateReady = true;
    store.setOffline({ ...store.getState().offline, updateReady: true });
  };

  store.setOffline({ state: 'installing', missing: [], updateReady: false });
  sw.register('./sw.js', { scope: './' })
    .then((registration) => {
      if (registration.waiting && sw.controller) markUpdate();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && sw.controller && hadController) markUpdate();
          if (installing.state === 'activated') void check();
          if (installing.state === 'redundant' && !registration.active) store.setOffline({ state: 'error', missing: ['The offline cache could not be installed (an asset failed to download).'], updateReady });
        });
      });
      void check();
      window.addEventListener('typist:apply-update', () => {
        if (store.getState().activeRun) return;
        registration.waiting?.postMessage({ type: 'skip-waiting' });
      });
      // Look for updates occasionally; installing never interrupts practice.
      setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
    })
    .catch((error: unknown) => {
      store.setOffline({ state: 'error', missing: [error instanceof Error ? error.message : String(error)], updateReady: false });
    });
}
