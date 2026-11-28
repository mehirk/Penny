/**
 * Last-seen copies of slow screens (for example Learn's skill map), shown at once while a fresh copy
 * loads, so switching tabs doesn't flash a loading state. Kept in memory and in this tab's
 * sessionStorage (so a reload keeps them too), never in localStorage, and wiped on sign-out.
 * Display only: the server's fresh copy always replaces what's shown here.
 */

const PREFIX = "penny-cache:";
const memory = new Map<string, unknown>();

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked: memory only
  }
}

export function recall<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  const raw = session()?.getItem(PREFIX + key);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function remember<T>(key: string, value: T): void {
  memory.set(key, value);
  try {
    session()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: memory still has it */
  }
}

/** Forgets everything. Called on sign-out so the next person never sees the last one's screens. */
export function forgetAll(): void {
  memory.clear();
  const store = session();
  if (!store) return;
  try {
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
  } catch {
    /* storage blocked: nothing was saved there */
  }
}
