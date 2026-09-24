import { InjectionToken, Injectable, TransferState, inject, makeStateKey } from '@angular/core';
import { Observable, of } from 'rxjs';

/** A normalized report as returned by the API. */
export interface Report {
  id: number;
  source: string;
  sourceId: string;
  title: string | null;
  date: string | null;
  latitude: number | null;
  longitude: number | null;
  place: string | null;
  author: string | null;
  thumbnail: string | null;
  activity: string | null;
  url: string | null;
}

export interface SearchResponse {
  query: { q: string | null; from: string; to: string; limit: number };
  count: number;
  results: Report[];
}

export interface SearchOptions {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * A pluggable search backend. Only the SERVER provides a real implementation
 * (see reports.server.ts, wired in app.config.server.ts). The browser build
 * has no implementation and therefore contains none of the fetch/URL/API-key
 * code — it only reads what the server rendered via TransferState.
 */
export interface SearchBackend {
  fetch(options: SearchOptions): Promise<SearchResponse>;
}

export const SEARCH_BACKEND = new InjectionToken<SearchBackend>('SEARCH_BACKEND');

export function searchStateKey(options: SearchOptions): string {
  return `search:${options.q ?? ''}:${options.from ?? ''}:${options.to ?? ''}:${options.limit ?? ''}`;
}

function emptyResponse(options: SearchOptions): SearchResponse {
  return {
    query: {
      q: options.q ?? null,
      from: options.from ?? '',
      to: options.to ?? '',
      limit: options.limit ?? 0,
    },
    count: 0,
    results: [],
  };
}

/**
 * Runs the search without exposing any browser-facing endpoint.
 *
 * - Server: delegates to the injected SEARCH_BACKEND (which calls the internal
 *   API with the key) and stores the result in TransferState.
 * - Browser: reads the result the server serialized into the page. It never
 *   performs an HTTP request and contains no API details.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly transferState = inject(TransferState);
  private readonly backend = inject(SEARCH_BACKEND, { optional: true });

  search(options: SearchOptions): Observable<SearchResponse> {
    const key = makeStateKey<SearchResponse>(searchStateKey(options));

    if (this.backend) {
      // Server path.
      return new Observable<SearchResponse>((subscriber) => {
        this.backend!.fetch(options)
          .then((result) => {
            this.transferState.set(key, result);
            subscriber.next(result);
            subscriber.complete();
          })
          .catch((err) => {
            console.error('[web] search backend failed:', err);
            const fallback = emptyResponse(options);
            this.transferState.set(key, fallback);
            subscriber.next(fallback);
            subscriber.complete();
          });
      });
    }

    // Browser path: reuse the server-rendered result; never call out.
    const cached = this.transferState.get<SearchResponse | null>(key, null);
    return of(cached ?? emptyResponse(options));
  }
}
