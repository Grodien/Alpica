import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from './i18n/i18n.service';
import { LangSwitcher } from './i18n/lang-switcher';

/**
 * Shared branded header for the standalone content pages (Impressum, Legal,
 * Datenschutz): the brand-blue bar with the MountainRADAR logo, which links
 * back to the map (home), plus the language switcher.
 */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, LangSwitcher],
  template: `
    <header class="pageheader">
      <a [routerLink]="i18n.localized('/')" class="pageheader__logo-link" [attr.aria-label]="i18n.t('page.toMapAria')">
        <img
          class="pageheader__logo"
          src="assets/logo/mountainradar-logo-horizontal-negative.svg"
          [attr.alt]="i18n.t('app.logoAlt')"
        />
      </a>
      <div class="pageheader__right">
        <!-- Brand claim, right side (same SVG as the home desktop header). -->
        <img
          class="pageheader__claim"
          src="assets/logo/claim.svg"
          [attr.alt]="i18n.t('app.claimAlt')"
        />
        <app-lang-switcher />
      </div>
    </header>
  `,
  styleUrl: './page-header.css',
})
export class PageHeader {
  protected readonly i18n = inject(I18nService);
}
