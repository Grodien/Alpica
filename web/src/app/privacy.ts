import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';
import { I18nService } from './i18n/i18n.service';
import { TPipe } from './i18n/t.pipe';

/**
 * Static privacy-policy page ("Datenschutzerklärung"). Content supplied by
 * Bergportal GmbH (generated via Datenschutzpartner). Rendered as static
 * template markup.
 *
 * The policy body is kept in German: the document itself declares the German
 * version authoritative ("Bei der Veröffentlichung in einer anderen Sprache
 * bleibt die deutschsprachige Datenschutzerklärung massgeblich"), and machine-
 * translating standardized legal text carries real risk. In English mode we
 * show a short banner explaining this; the chrome (back link) is localized.
 */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink, PageHeader, TPipe],
  templateUrl: './privacy.html',
  styleUrl: './privacy.css',
})
export class Privacy {
  protected readonly i18n = inject(I18nService);
}
