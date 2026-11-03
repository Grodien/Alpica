import { Component, input, output } from '@angular/core';
import { activityDisplay } from './activity-icons';
import { sourceDisplay } from './source-display';
import type { Report } from './reports.service';

/**
 * Presentational list of reports, shared by the mobile and desktop layouts.
 * Holds no data-loading logic — it just renders the given reports and emits
 * user intents (select, hover, open) back to the parent.
 */
@Component({
  selector: 'app-results-list',
  imports: [],
  templateUrl: './results-list.html',
  styleUrl: './results-list.css',
})
export class ResultsList {
  /** Reports to display (already ordered by the parent). */
  readonly reports = input<Report[]>([]);
  /** Currently selected report id (highlighted). */
  readonly selectedId = input<number | null>(null);
  /** Label of the currently selected date range (e.g. "3 Tage"), shown on result cards. */
  readonly currentRangeLabel = input<string>('');

  readonly select = output<number>();
  readonly hover = output<number>();
  readonly hoverEnd = output<number>();
  readonly open = output<Report>();

  protected readonly display = activityDisplay;
  protected readonly sourceName = sourceDisplay;

  /**
   * Formats a report date ("YYYY-MM-DD hh:mm:ss" or ISO) into the Swiss/German
   * "DD.MM.YYYY" shown top-right of each card. Returns '' for null/invalid.
   */
  protected formatDate(date: string | null): string {
    if (!date) return '';
    // Accept "YYYY-MM-DD ..." and ISO. Take the date part, parse defensively.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (m) {
      const [, y, mo, d] = m;
      return `${d}.${mo}.${y}`;
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return '';
    const d = String(parsed.getDate()).padStart(2, '0');
    const mo = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${d}.${mo}.${parsed.getFullYear()}`;
  }

  trackById(_i: number, r: Report): number {
    return r.id;
  }
}
