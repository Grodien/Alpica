import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';
import { I18nService } from './i18n/i18n.service';
import { TPipe } from './i18n/t.pipe';

/**
 * Static legal-notice page ("Rechtliche Aspekte") — terms of use, liability,
 * copyright, data protection reference, applicable law and the Skitourenguru
 * addendum. Content supplied by Bergportal GmbH.
 *
 * The page keeps two full language variants of the body (DE/EN) rather than
 * per-sentence keys, because legal text is best translated and reviewed as a
 * whole. The German version is the authoritative one.
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink, PageHeader, TPipe],
  templateUrl: './legal.html',
  styleUrl: './legal.css',
})
export class Legal {
  protected readonly i18n = inject(I18nService);
}
