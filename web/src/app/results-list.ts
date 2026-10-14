import { Component, input, output } from '@angular/core';
import { activityDisplay } from './activity-icons';
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

  readonly select = output<number>();
  readonly hover = output<number>();
  readonly hoverEnd = output<number>();
  readonly open = output<Report>();

  protected readonly display = activityDisplay;

  trackById(_i: number, r: Report): number {
    return r.id;
  }
}
