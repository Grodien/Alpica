import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from './i18n.service';
import { LANGUAGES, type Lang } from './types';

/**
 * Language selector as a compact dropdown. The trigger shows a globe icon plus
 * the active language code and takes a constant, single-button width regardless
 * of how many languages exist — so it scales cleanly to 4+ languages.
 *
 * The open menu is positioned with `position: fixed`, anchored to the trigger's
 * on-screen rect. This lets it escape any `overflow: hidden` / clipping ancestor
 * (e.g. the sticky mobile search block) and stay fully visible.
 *
 * Switching rewrites the first URL segment (/de/… <-> /en/…) and navigates
 * there, so the language stays encoded in the URL and the choice survives
 * reloads and sharing. Closes on outside click, Escape, scroll or resize.
 */
@Component({
  selector: 'app-lang-switcher',
  imports: [],
  template: `
    <div class="langsw" [class.langsw--open]="open()" [class.langsw--solid]="variant() === 'solid'">
      <button
        #trigger
        type="button"
        class="langsw__trigger"
        [attr.aria-label]="i18n.t('lang.switch')"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        (click)="toggle()"
      >
        <svg class="langsw__globe" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path
            d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18M4.5 7.5c4.5 2.2 10.5 2.2 15 0M4.5 16.5c4.5-2.2 10.5-2.2 15 0"
            fill="none" stroke="currentColor" stroke-width="1.2"
          />
        </svg>
        <span class="langsw__code">{{ i18n.lang().toUpperCase() }}</span>
        <svg class="langsw__chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
        </svg>
      </button>

      @if (open()) {
        <ul
          class="langsw__menu"
          role="listbox"
          [attr.aria-label]="i18n.t('lang.switch')"
          [style.top]="menuTop() !== null ? menuTop() + 'px' : null"
          [style.bottom]="menuBottom() !== null ? menuBottom() + 'px' : null"
          [style.right.px]="menuRight()"
        >
          @for (lng of languages; track lng) {
            <li
              class="langsw__option"
              role="option"
              [class.langsw__option--active]="i18n.lang() === lng"
              [attr.aria-selected]="i18n.lang() === lng"
              (click)="switch(lng)"
            >
              <span class="langsw__check" aria-hidden="true">
                @if (i18n.lang() === lng) {
                  <svg viewBox="0 0 16 16" width="13" height="13"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                }
              </span>
              <span class="langsw__name">{{ i18n.t('lang.' + lng) }}</span>
              <span class="langsw__abbr">{{ lng.toUpperCase() }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styleUrl: './lang-switcher.css',
})
export class LangSwitcher {
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  @ViewChild('trigger') private triggerRef?: ElementRef<HTMLButtonElement>;

  /**
   * Visual variant:
   *   - 'bar'   (default) translucent white-on-blue, for the brand-blue header.
   *   - 'solid' opaque white surface with dark content + shadow, for the mobile
   *             floating button over the map / light backgrounds.
   */
  readonly variant = input<'bar' | 'solid'>('bar');

  protected readonly languages = LANGUAGES;
  protected readonly open = signal(false);

  /** Fixed-position coordinates for the open menu (anchored to the trigger). */
  protected readonly menuTop = signal<number | null>(0);
  protected readonly menuBottom = signal<number | null>(null);
  protected readonly menuRight = signal(0);

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
    } else {
      this.positionMenu();
      this.open.set(true);
    }
  }

  /**
   * Anchors the (fixed-position) menu to the trigger, right-aligned. Opens
   * downward normally, but flips upward when the trigger is in the lower part
   * of the viewport (e.g. the mobile bottom-right floating button) so the menu
   * never runs off the bottom edge.
   */
  private positionMenu(): void {
    const el = this.triggerRef?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // `right` is measured from the viewport's right edge.
    this.menuRight.set(Math.round(window.innerWidth - rect.right));

    const gap = 6;
    const openUpward = rect.bottom > window.innerHeight * 0.6;
    if (openUpward) {
      this.menuTop.set(null);
      this.menuBottom.set(Math.round(window.innerHeight - rect.top + gap));
    } else {
      this.menuBottom.set(null);
      this.menuTop.set(Math.round(rect.bottom + gap));
    }
  }

  switch(lang: Lang): void {
    this.open.set(false);
    if (lang === this.i18n.lang()) return;
    const [pathPart, queryPart] = this.router.url.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    // Replace (or set) the leading language segment.
    if (segments.length && (LANGUAGES as readonly string[]).includes(segments[0])) {
      segments[0] = lang;
    } else {
      segments.unshift(lang);
    }
    const url = '/' + segments.join('/') + (queryPart ? `?${queryPart}` : '');
    this.router.navigateByUrl(url);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }

  // The menu is fixed-positioned from the trigger rect; close it on scroll or
  // resize rather than trying to keep it pinned while the page moves.
  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChange(): void {
    if (this.open()) this.open.set(false);
  }
}
