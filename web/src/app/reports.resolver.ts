import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { ReportsService, type SearchResponse } from './reports.service';

/**
 * Resolves search results BEFORE the route renders. The router awaits resolvers
 * during SSR, so the server produces fully-rendered HTML with the results in it.
 * This is what lets us avoid any browser-facing endpoint or client-side fetch.
 */
export const searchResolver: ResolveFn<SearchResponse> = (route) => {
  const reports = inject(ReportsService);
  const q = route.queryParamMap.get('q') ?? '';
  return reports.search({ q });
};
