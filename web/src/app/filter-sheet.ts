import { Component, ElementRef, input, output, signal, ViewChild } from '@angular/core';
import { FILTER_CATEGORIES, FILTER_SOURCES } from './filter-options';

/**
 * Mobile filter bottom-sheet. Opened from the search bar's Filter button.
 *
 * - Slides up from the bottom; dimmed backdrop behind.
 * - Closes via the X button, tapping the backdrop, or a swipe-down gesture on
 *   the sheet handle/header.
 * - Selection is applied live (no save button): every toggle emits `change`,
 *   and closing emits `close`. The parent owns the selected state and re-queries.
 */
@Component({
  selector: 'app-filter-sheet',
  imports: [],
  templateUrl: './filter-sheet.html',
  styleUrl: './filter-sheet.css',
})
export class FilterSheet {
  protected readonly categories = FILTER_CATEGORIES;
  protected readonly sources = FILTER_SOURCES;

  /** Whether the sheet is open (controlled by the parent). */
  readonly open = input<boolean>(false);
  /** Selected activity category keys. */
  readonly selectedActivities = input<string[]>([]);
  /** Selected source keys. */
  readonly selectedSources = input<string[]>([]);

  /** Emitted when the user toggles an activity (category key). */
  readonly toggleActivity = output<string>();
  /** Emitted when the user toggles a source (source key). */
  readonly toggleSource = output<string>();
  /** Emitted when the user resets all filters. */
  readonly reset = output<void>();
  /** Emitted when the sheet should close (X, backdrop, or swipe-down). */
  readonly close = output<void>();

  @ViewChild('sheet') private sheet?: ElementRef<HTMLElement>;

  /** Live drag offset (px) while swiping the sheet down. */
  protected readonly dragY = signal(0);
  private dragStartY: number | null = null;

  isActivityActive(key: string): boolean {
    return this.selectedActivities().includes(key);
  }
  isSourceActive(key: string): boolean {
    return this.selectedSources().includes(key);
  }

  onBackdropClick(): void {
    this.close.emit();
  }

  // --- Swipe/drag-down-to-close gesture --------------------------------------
  // Uses Pointer Events so it works for BOTH touch (mobile) and mouse (desktop
  // web). Pointer capture keeps the move/up events coming even if the pointer
  // leaves the grab handle while dragging.
  onPointerDown(ev: PointerEvent): void {
    this.dragStartY = ev.clientY;
    (ev.target as HTMLElement)?.setPointerCapture?.(ev.pointerId);
  }
  onPointerMove(ev: PointerEvent): void {
    if (this.dragStartY == null) return;
    const dy = ev.clientY - this.dragStartY;
    // Only allow dragging downward.
    this.dragY.set(Math.max(0, dy));
  }
  onPointerUp(ev: PointerEvent): void {
    if (this.dragStartY == null) return;
    const dy = this.dragY();
    this.dragStartY = null;
    (ev.target as HTMLElement)?.releasePointerCapture?.(ev.pointerId);
    // Past a threshold -> close; otherwise snap back.
    this.dragY.set(0);
    if (dy > 120) this.close.emit();
  }
}
