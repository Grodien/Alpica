import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Template translation pipe: `{{ 'home.loading' | t }}` or, with params,
 * `{{ 'home.resultsCount' | t: { count: n } }}`.
 *
 * Marked `pure: false` so it re-evaluates whenever change detection runs. The
 * language lives in a signal, and reading it inside transform() ties this
 * pipe's output to language changes (switching language re-renders all strings).
 */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, params?: Record<string, string | number>): string {
    // Touch the signal so the pipe participates in signal-driven updates.
    this.i18n.lang();
    return this.i18n.t(key, params);
  }
}
