import { Component, DOCUMENT, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { I18nService } from './i18n/i18n.service';
import { LANGUAGES, asLang } from './i18n/types';

/** Public site origin, used to build absolute canonical / hreflang URLs. */
const SITE_ORIGIN = 'https://www.mountain-radar.com';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  template: '<router-outlet />',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);

  ngOnInit(): void {
    // Keep the active language in sync with the `:lang` URL segment. Runs once
    // on init (SSR + first client render) and on every navigation.
    this.syncFromUrl();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.syncFromUrl());
  }

  /** Reads the first path segment as the active language, then updates meta. */
  private syncFromUrl(): void {
    const path = this.router.url.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const lang = asLang(segments[0]);
    if (!lang) return;
    this.i18n.setLang(lang);
    this.updateMeta(segments.slice(1).join('/'));
  }

  /**
   * Keeps language-dependent document metadata in sync: <title>, meta
   * description, og:locale, the canonical URL, and the hreflang alternates
   * (one per language + x-default). `subPath` is the path WITHOUT the leading
   * language segment (e.g. 'impressum').
   */
  private updateMeta(subPath: string): void {
    this.document.title = this.i18n.t('meta.title');
    this.setMetaByName('description', this.i18n.t('meta.description'));
    this.setMetaByProperty('og:locale', this.i18n.lang() === 'de' ? 'de_CH' : 'en');
    this.setMetaByProperty('og:title', this.i18n.t('meta.title'));
    this.setMetaByProperty('og:description', this.i18n.t('meta.description'));

    const suffix = subPath ? `/${subPath}` : '';
    this.setCanonical(`${SITE_ORIGIN}/${this.i18n.lang()}${suffix}`);
    this.setHreflangAlternates(suffix);
  }

  private setMetaByName(name: string, content: string): void {
    const el = this.document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute('content', content);
  }

  private setMetaByProperty(property: string, content: string): void {
    const el = this.document.querySelector(`meta[property="${property}"]`);
    if (el) el.setAttribute('content', content);
  }

  private setCanonical(href: string): void {
    let link = this.document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  /**
   * Rebuilds the hreflang alternate <link>s for the current sub-path: one per
   * supported language plus an x-default (pointing at the default language).
   */
  private setHreflangAlternates(suffix: string): void {
    // Drop any previously-inserted alternates, then re-add for this path.
    this.document
      .querySelectorAll('link[rel="alternate"][data-i18n="hreflang"]')
      .forEach((el) => el.remove());

    const add = (hreflang: string, lang: string): void => {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', hreflang);
      link.setAttribute('href', `${SITE_ORIGIN}/${lang}${suffix}`);
      link.setAttribute('data-i18n', 'hreflang');
      this.document.head.appendChild(link);
    };

    for (const lang of LANGUAGES) add(lang, lang);
    add('x-default', LANGUAGES[0]);
  }
}
