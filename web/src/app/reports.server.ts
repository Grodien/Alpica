import type { SearchBackend, SearchOptions, SearchResponse } from './reports.service';

/**
 * SERVER-ONLY search backend. Calls the internal API with the API key. This
 * module is imported exclusively from app.config.server.ts, so its code (the
 * internal API URL and the API-key env var) never ends up in the browser bundle.
 */
export class HttpSearchBackend implements SearchBackend {
  async fetch(options: SearchOptions): Promise<SearchResponse> {
    const base = process.env['API_BASE_URL'] || 'http://127.0.0.1:3001';
    const apiKey = process.env['API_KEY'] || '';

    const target = new URL('/reports/search', base);
    if (options.q) target.searchParams.set('q', options.q);
    if (options.from) target.searchParams.set('from', options.from);
    if (options.to) target.searchParams.set('to', options.to);
    if (options.limit != null) target.searchParams.set('limit', String(options.limit));

    const res = await fetch(target, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
    });
    if (!res.ok) {
      throw new Error(`Internal API returned ${res.status}`);
    }
    return (await res.json()) as SearchResponse;
  }
}
