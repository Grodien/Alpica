/**
 * Supported UI languages. The first entry is the default/fallback used when the
 * browser language can't be matched.
 */
export const LANGUAGES = ['de', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const DEFAULT_LANG: Lang = 'de';

/** Narrows an arbitrary string to a supported Lang, or null if unsupported. */
export function asLang(value: string | null | undefined): Lang | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (LANGUAGES as readonly string[]).includes(lower) ? (lower as Lang) : null;
}

/**
 * Picks the best supported language from a raw Accept-Language-style string or
 * a single `navigator.language` value (e.g. "en-US,en;q=0.9,de;q=0.8").
 * Falls back to DEFAULT_LANG when nothing matches.
 */
export function pickLang(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  // Split on comma, strip the ;q=... weight, take the primary subtag (en-US -> en).
  const candidates = header
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase().split('-')[0]);
  for (const c of candidates) {
    const match = asLang(c);
    if (match) return match;
  }
  return DEFAULT_LANG;
}

/** A flat dictionary of translation keys to strings for one language. */
export type Dict = Record<string, string>;
