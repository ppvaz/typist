// Minimal hash router: the app is a static offline bundle, so routes live in
// the fragment and never require a server.
import { useSyncExternalStore } from 'react';

export interface Route {
  readonly path: string;
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
}

function parse(): Route {
  const hash = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  const [pathPart = '/', queryPart = ''] = hash.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(queryPart) };
}

let current = parse();
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse();
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function navigate(path: string): void {
  const next = `#${path}`;
  if (location.hash !== next) location.hash = next;
}

export function href(path: string): string {
  return `#${path}`;
}
