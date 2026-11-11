import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';

/**
 * Static privacy-policy page ("Datenschutzerklärung"). Content supplied by
 * Bergportal GmbH (generated via Datenschutzpartner). Rendered as static
 * template markup.
 */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink, PageHeader],
  templateUrl: './privacy.html',
  styleUrl: './privacy.css',
})
export class Privacy {}
