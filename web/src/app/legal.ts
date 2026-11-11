import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from './page-header';

/**
 * Static legal-notice page ("Rechtliche Aspekte") — terms of use, liability,
 * copyright, data protection reference, applicable law and the Skitourenguru
 * addendum. Content supplied by Bergportal GmbH.
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink, PageHeader],
  templateUrl: './legal.html',
  styleUrl: './legal.css',
})
export class Legal {}
