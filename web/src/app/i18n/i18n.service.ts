import { DOCUMENT, Injectable, REQUEST, computed, inject, signal } from '@angular/core';
import { de } from './de';
import { en } from './en';
import { DEFAULT_LANG, type Dict, type Lang, asLang, pickLang } from './types';

const DICTS: Record<Lang, Dict> = { de, en };

/**
 * Runtime translation service. Holds the active language as a signal; the UI
 * reads strings via `t(key)` (and `t(key, params)` for {placeholder}
 * interpolation). German is always the fallback for missing keys.
 *
 * Language resolution:
 *   - The active language is driven by the `:lang` URL segment (see
 *     app.routes.ts / LanguageSync in app.ts), so each language has its own URL
 *     (/de/…, /en/…) which is good for SEO and shareable links.
 *   - The initial redirect from `/` is decided server-side from the
 *     Accept-Language header (SSR) and client-side from navigator.language, so
 *     first-time visitors land on their browser language automatically.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly request = inject(REQUEST, { optional: true });
  private readonly document = inject(DOCUMENT);

  /** The currently active UI language. */
  readonly lang = signal<Lang>(DEFAULT_LANG);

  /** Convenience: `true` when the active language is English. */
  readonly isEnglish = computed(() => this.lang() === 'en');

  /**
   * Best-guess initial language for a first-time visitor (no language in the
   * URL yet). On the server this reads the Accept-Language request header; in
   * the browser it reads navigator.language. Used only to pick the redirect
   * target for `/`.
   */
  detectPreferredLang(): Lang {
    // Server-side: use the incoming Accept-Language header.
    const header = this.request?.headers.get('accept-language');
    if (header) return pickLang(header);
    // Browser-side: navigator.language / languages.
    const nav = this.document.defaultView?.navigator;
    if (nav) {
      const list = nav.languages?.length ? nav.languages.join(',') : nav.language;
      return pickLang(list);
    }
    return DEFAULT_LANG;
  }

  /**
   * Sets the active language (if supported) and reflects it on <html lang>.
   * Ignores unsupported values, keeping the current language.
   */
  setLang(value: string | Lang | null | undefined): void {
    const next = asLang(value);
    if (!next) return;
    this.lang.set(next);
    const html = this.document.documentElement;
    if (html) html.setAttribute('lang', next);
  }

  /**
   * Builds an app-absolute, language-prefixed path for use in routerLink, e.g.
   * localized('/impressum') -> '/en/impressum'. Pass '' or '/' for the home map.
   */
  localized(path = ''): string {
    const clean = path.replace(/^\/+/, '');
    return clean ? `/${this.lang()}/${clean}` : `/${this.lang()}`;
  }

  /**
   * Translates a key for the active language, with {placeholder} interpolation.
   * Falls back to German, then to the raw key if the key is unknown.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const active = DICTS[this.lang()] ?? de;
    const raw = active[key] ?? de[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_m, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  }
}
