import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Shared branded header for the standalone content pages (Impressum, Legal,
 * Datenschutz): the brand-blue bar with the MountainRADAR logo, which links
 * back to the map (home).
 */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink],
  template: `
    <header class="pageheader">
      <a routerLink="/" class="pageheader__logo-link" aria-label="Zur Karte">
        <img
          class="pageheader__logo"
          src="assets/logo/mountainradar-logo-horizontal-negative.svg"
          alt="MountainRADAR"
        />
      </a>
      <!-- Brand claim, right side (same SVG as the home desktop header). -->
      <img
        class="pageheader__claim"
        src="assets/logo/claim.svg"
        alt="One Search. All Conditions."
      />
    </header>
  `,
  styleUrl: './page-header.css',
})
export class PageHeader {}
