import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, REQUEST, inject } from '@angular/core';
import { Observable } from 'rxjs';

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
  count: number;
  results: Report[];
}

export interface DateRange {
  from?: string;
  to?: string;
  limit?: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Talks to the SAME-ORIGIN proxy endpoints (`/api/search`, `/api/bbox`) served
 * by the Angular SSR server (see src/server.ts). Those endpoints inject the
 * `x-api-key` header server-side, so the real API URL and key never reach the
 * browser.
 *
 * During SSR, HttpClient needs an absolute URL, so we derive the current origin
 * from the incoming request. In the browser a relative URL is used.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);
  private readonly request = inject(REQUEST, { optional: true });

  /** Bounding-box search for the current map viewport. */
  searchByBoundingBox(bbox: BoundingBox, range: DateRange = {}): Observable<SearchResponse> {
    let params = new HttpParams()
      .set('minLat', String(bbox.minLat))
      .set('maxLat', String(bbox.maxLat))
      .set('minLng', String(bbox.minLng))
      .set('maxLng', String(bbox.maxLng));
    params = this.applyRange(params, range);
    return this.http.get<SearchResponse>(`${this.baseUrl()}/api/bbox`, { params });
  }

  private applyRange(params: HttpParams, range: DateRange): HttpParams {
    if (range.from) params = params.set('from', range.from);
    if (range.to) params = params.set('to', range.to);
    if (range.limit != null) params = params.set('limit', String(range.limit));
    return params;
  }

  /** Absolute origin on the server, empty (relative) in the browser. */
  private baseUrl(): string {
    if (this.request) {
      const host = this.request.headers.get('host');
      const proto = this.request.headers.get('x-forwarded-proto') ?? 'http';
      if (host) return `${proto}://${host}`;
    }
    return '';
  }
}
