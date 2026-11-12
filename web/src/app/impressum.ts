import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';
import { I18nService } from './i18n/i18n.service';
import { TPipe } from './i18n/t.pipe';

/**
 * Static legal notice (Impressum) page. Company data is adapted from the
 * Bergportal GmbH imprint; Mountain-Radar specific overrides: the intro
 * sentence, the contact e-mail, and the programming credit.
 */
@Component({
  selector: 'app-impressum',
  imports: [RouterLink, PageHeader, TPipe],
  templateUrl: './impressum.html',
  styleUrl: './impressum.css',
})
export class Impressum {
  protected readonly i18n = inject(I18nService);
}
