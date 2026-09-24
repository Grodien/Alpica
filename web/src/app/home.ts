import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import type { Report, SearchResponse } from './reports.service';

/**
 * Search page. The search term lives in the URL (`/?q=...`). The form is a
 * native GET form, so submitting it is a full page load that the server renders.
 *
 * The results are produced by a route RESOLVER (see reports.resolver.ts). The
 * router awaits the resolver during SSR, so the server renders finished HTML
 * with the results already in it — no browser-facing endpoint, no client XHR.
 */
@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly route = inject(ActivatedRoute);

  /** Current query term from the URL (drives the input's initial value). */
  protected readonly query = signal(this.route.snapshot.queryParamMap.get('q') ?? '');

  /** Whether a search term is present in the URL. */
  protected readonly searched = signal(this.route.snapshot.queryParamMap.has('q'));

  /** Results resolved before render, exposed as a signal for the template. */
  protected readonly results = toSignal(
    this.route.data.pipe(
      map((data) => (data['search'] as SearchResponse | undefined)?.results ?? [])
    ),
    { initialValue: [] as Report[] }
  );
}
