import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { Home } from './home';
import { Impressum } from './impressum';
import { Legal } from './legal';
import { Privacy } from './privacy';
import { I18nService } from './i18n/i18n.service';
import { LANGUAGES } from './i18n/types';

/**
 * Language-prefixed routing. Every page lives under `/:lang` (/de/…, /en/…),
 * which gives each language its own shareable, SEO-friendly URL.
 *
 * Bare paths (`/`, `/impressum`, …) redirect to the browser-preferred language
 * (Accept-Language on the server, navigator.language in the browser).
 */

/** Redirects a bare (language-less) path to the detected-language variant. */
function redirectToLang(rest: string): () => UrlTree {
  return () => {
    const i18n = inject(I18nService);
    const router = inject(Router);
    const lang = i18n.detectPreferredLang();
    return router.parseUrl(`/${lang}${rest}`);
  };
}

/** The set of pages served under each language prefix. */
const localizedChildren: Routes = [
  { path: '', component: Home },
  { path: 'impressum', component: Impressum },
  { path: 'legal', component: Legal },
  { path: 'datenschutz', component: Privacy },
  { path: '**', redirectTo: '' },
];

export const routes: Routes = [
  // Language-prefixed pages: /de/…, /en/….
  ...LANGUAGES.map((lang) => ({ path: lang, children: localizedChildren })),

  // Bare paths -> redirect to the preferred language, preserving the sub-path
  // so existing links (/impressum, /datenschutz, /legal) keep working.
  { path: '', pathMatch: 'full', redirectTo: redirectToLang('') },
  { path: 'impressum', redirectTo: redirectToLang('/impressum') },
  { path: 'legal', redirectTo: redirectToLang('/legal') },
  { path: 'datenschutz', redirectTo: redirectToLang('/datenschutz') },
  { path: '**', redirectTo: redirectToLang('') },
];
