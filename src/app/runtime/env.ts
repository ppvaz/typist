// Facts about the running browser, recorded with setups and calibrations.
// None of this is sent anywhere; it labels local results.

export function browserLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const firefox = /Firefox\/(\d+(?:\.\d+)?)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  const edge = /Edg\/(\d+)/.exec(ua);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = /Chrome\/(\d+(?:\.\d+)*)/.exec(ua);
  if (chrome) return `Chromium ${chrome[1]}`;
  const safari = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua);
  if (safari) return `Safari ${safari[1]}`;
  return ua.slice(0, 60);
}

export function osLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac OS X/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

const SESSION_KEY = 'typist.browserSession';

/**
 * An ID for this browser session: it survives reloads of the tab but not a
 * browser restart, which makes calibration require the short probe again.
 */
export function browserSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return 'no-session-storage';
  }
}

export function tabId(): string {
  return crypto.randomUUID();
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
