import { Component, inject, input, output } from '@angular/core';
import { activityDisplay } from './activity-icons';
import { sourceDisplay } from './source-display';
import type { Report } from './reports.service';
import { I18nService } from './i18n/i18n.service';
import { TPipe } from './i18n/t.pipe';

/**
 * Presentational list of reports, shared by the mobile and desktop layouts.
 * Holds no data-loading logic — it just renders the given reports and emits
 * user intents (select, hover, open) back to the parent.
 */
@Component({
  selector: 'app-results-list',
  imports: [TPipe],
  templateUrl: './results-list.html',
  styleUrl: './results-list.css',
})
export class ResultsList {
  protected readonly i18n = inject(I18nService);
  /** Reports to display (already ordered by the parent). */
  readonly reports = input<Report[]>([]);
  /** Currently selected report id (highlighted). */
  readonly selectedId = input<number | null>(null);

  readonly select = output<number>();
  readonly hover = output<number>();
  readonly hoverEnd = output<number>();
  readonly open = output<Report>();

  protected readonly display = activityDisplay;
  protected readonly sourceName = sourceDisplay;

  /** Translated activity label for a report (from its matched display rule). */
  protected activityLabel(activity: string | null): string {
    return this.i18n.t(activityDisplay(activity).labelKey);
  }

  /**
   * Whole days between the report date and today (local time), floored.
   * Returns null for a missing/invalid date. 0 = today, 1 = yesterday, …
   */
  private ageDays(date: string | null): number | null {
    if (!date) return null;
    let parsed: Date;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (m) {
      const [, y, mo, d] = m;
      parsed = new Date(Number(y), Number(mo) - 1, Number(d));
    } else {
      parsed = new Date(date);
    }
    if (Number.isNaN(parsed.getTime())) return null;
    // Compare at day granularity (ignore the time-of-day component).
    const startOfReport = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = startOfToday.getTime() - startOfReport.getTime();
    return Math.floor(diffMs / 86_400_000);
  }

  /**
   * The age badge is only meaningful (and shown) for recent reports — within
   * the last 9 days (age < 10). Future-dated or older reports hide the badge.
   */
  protected showAgeBadge(date: string | null): boolean {
    const days = this.ageDays(date);
    return days != null && days >= 0 && days < 10;
  }

  /** Localized label for the report's age, e.g. "Today" / "Yesterday" / "3 days". */
  protected ageLabel(date: string | null): string {
    const days = this.ageDays(date);
    if (days == null) return '';
    if (days <= 0) return this.i18n.t('result.ageToday');
    if (days === 1) return this.i18n.t('result.ageYesterday');
    return this.i18n.t('result.ageDays', { days });
  }

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
