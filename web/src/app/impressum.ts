import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';

/**
 * Static legal notice (Impressum) page. Company data is adapted from the
 * Bergportal GmbH imprint; Mountain-Radar specific overrides: the intro
 * sentence, the contact e-mail, and the programming credit.
 */
@Component({
  selector: 'app-impressum',
  imports: [RouterLink, PageHeader],
  templateUrl: './impressum.html',
  styleUrl: './impressum.css',
})
export class Impressum {}
