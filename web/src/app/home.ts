import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ReportsService, type BoundingBox, type Report } from './reports.service';
import { ResultsList } from './results-list';
import { FilterSheet } from './filter-sheet';
import { FilterDropdown } from './filter-dropdown';
import { FILTER_CATEGORIES, FILTER_SOURCES } from './filter-options';
import { activityDisplay } from './activity-icons';

/** Viewport width (px) at/above which the desktop layout is used. */
const DESKTOP_BREAKPOINT = 860;

/** Date-range slider steps (labels from the Figma mobile design). */
interface RangeStep {
  label: string;
  /** Days back from "now" for from/to. null means "no lower bound" (Alle). */
  days: number | null;
}
const RANGE_STEPS: RangeStep[] = [
  { label: '3 Tage', days: 3 },
  { label: '1 Woche', days: 7 },
  { label: '1 Monat', days: 30 },
  { label: '6 Monate', days: 180 },
  { label: 'Alle', days: null },
];

/** For "Alle": a lower bound far enough back to include everything. */
const RANGE_ALL_DAYS = 3650; // ~10 years

/** Default map view (European Alps) used before the first search. */
const DEFAULT_CENTER: [number, number] = [46.8, 9.2];
const DEFAULT_ZOOM = 9;

/**
 * Skitourenguru tile server (standard XYZ scheme via query params). It serves
 * the region-appropriate topo map across the whole Alps. NOTE: the server uses
 * a Referer allowlist — it works from localhost, but for a public domain you
 * likely need Skitourenguru to whitelist it. See the map notes in the README.
 */
const SKITOURENGURU_TILES = 'https://map.skitourenguru.com/AP_SG_TOPO_MINI.tms?x={x}&y={y}&z={z}';

@Component({
  selector: 'app-home',
  imports: [ResultsList, FilterSheet, FilterDropdown],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements AfterViewInit, OnDestroy {
  private readonly reports = inject(ReportsService);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('mapEl') private mapEl!: ElementRef<HTMLDivElement>;
  @ViewChild('resultsPanel') private resultsPanel?: ElementRef<HTMLElement>;
  // Mobile-only sticky chrome, used to offset the scroll-to-map so the map is
  // not hidden behind the pinned header + search block.
  @ViewChild('mobileHeader') private mobileHeader?: ElementRef<HTMLElement>;
  @ViewChild('mobileSearch') private mobileSearch?: ElementRef<HTMLElement>;

  protected readonly steps = RANGE_STEPS;

  /** Desktop dropdown options (reuse the mobile filter definitions). */
  protected readonly categoryOptions = FILTER_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    icon: c.icon,
    color: c.color,
  }));
  protected readonly sourceOptions = FILTER_SOURCES.map((sr) => ({
    key: sr.key,
    label: sr.label,
  }));
  protected readonly rangeIndex = signal(2); // default "1 Monat" (30 days)
  protected readonly results = signal<Report[]>([]);
  protected readonly loading = signal(false);
  protected readonly selectedId = signal<number | null>(null);

  /**
   * Free-text search query bound to the mobile search bar. Presentational for
   * now: it keeps the input controlled but is intentionally NOT wired into the
   * bbox search, which stays viewport-driven (see refresh()).
   */
  protected readonly query = signal('');

  /** The currently APPLIED search term (empty = viewport/bbox mode). While a
      term is active, pan/zoom does NOT trigger a new search. */
  protected readonly searchTerm = signal('');

  /** Filter bottom-sheet state (mobile). */
  protected readonly filterOpen = signal(false);
  /** Selected activity category keys (see filter-options.ts). */
  protected readonly selectedActivities = signal<string[]>([]);
  /** Selected source keys. */
  protected readonly selectedSources = signal<string[]>([]);

  /** Total number of active filters (activities + sources) for the button badge. */
  protected readonly activeFilterCount = computed(
    () => this.selectedActivities().length + this.selectedSources().length,
  );

  /** True on desktop-width viewports. SSR renders the mobile layout by default. */
  protected readonly isDesktop = signal(false);

  /**
   * List order for display: the selected report (if any) is moved to the top,
   * the rest keep their original order. The map markers still use the raw
   * `results`, so this only affects the list.
   */
  protected readonly orderedResults = computed<Report[]>(() => {
    const all = this.results();
    // Desktop: never reorder — the selected item is shown in place (and the
    // list scrolls to it on a pin click). Mobile: move the selected item to the
    // top so it's immediately visible above the fold.
    if (this.isDesktop()) return all;
    const id = this.selectedId();
    if (id == null) return all;
    const selected = all.find((r) => r.id === id);
    if (!selected) return all;
    return [selected, ...all.filter((r) => r.id !== id)];
  });

  private onResize = (): void => {
    this.isDesktop.set(window.innerWidth >= DESKTOP_BREAKPOINT);
    // The map container size changes between layouts; keep Leaflet in sync.
    setTimeout(() => this.map?.invalidateSize(), 0);
  };

  // Leaflet is browser-only; these are set after dynamic import.
  private L: typeof import('leaflet') | null = null;
  private map: import('leaflet').Map | null = null;
  private markers = new Map<number, import('leaflet').Marker>();
  private layer: import('leaflet').LayerGroup | null = null;
  private userMarker: import('leaflet').Marker | null = null;
  /** True while a geolocation request is in flight (for button state). */
  protected readonly locating = signal(false);
  private moveDebounce: ReturnType<typeof setTimeout> | null = null;

  get currentStep(): RangeStep {
    return this.steps[this.rangeIndex()];
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    // Pick the layout for the current viewport and track resizes.
    this.onResize();
    window.addEventListener('resize', this.onResize);

    try {
      // Load Leaflet only in the browser (it touches window/document). Leaflet
      // is a CommonJS module, so depending on interop the API may live on
      // `.default`. Resolve whichever object actually exposes `map()`.
      const mod: any = await import('leaflet');
      const leaflet: typeof import('leaflet') =
        typeof mod.map === 'function' ? mod : mod.default;
      this.L = leaflet;

      this.map = leaflet.map(this.mapEl.nativeElement, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        // Zoom buttons are hidden on mobile (pinch-to-zoom is used there).
        zoomControl: this.isDesktop(),
        // Hide the "Leaflet" attribution badge in the corner.
        attributionControl: false,
      });

      // --- Base map --------------------------------------------------------
      // Skitourenguru's own tile server. It internally picks the best regional
      // map (swisstopo for Switzerland, IGN for France, etc.), so no manual
      // layer switch is needed — one layer covers the whole Alps.
      // Uses an XYZ scheme with query params: ?x=&y=&z=.
      leaflet
        .tileLayer(SKITOURENGURU_TILES, {
          maxZoom: 17,
          attribution:
            '&copy; <a href="https://skitourenguru.com">Skitourenguru</a> / swisstopo, IGN',
        })
        .addTo(this.map);

      this.layer = leaflet.layerGroup().addTo(this.map);

      // Scale bar (bottom-left), metric only — matches the Figma map design.
      leaflet.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

      // Re-query whenever the viewport settles.
      this.map.on('moveend', () => this.onViewportChanged());

      // The container may have had zero size during init (e.g. before layout
      // settled). Recalculate once the current frame is done, then load data.
      setTimeout(() => {
        this.map?.invalidateSize();
        this.onViewportChanged();
      }, 0);
    } catch (err) {
      console.error('[map] failed to initialise Leaflet:', err);
    }
  }

  ngOnDestroy(): void {
    if (this.moveDebounce) clearTimeout(this.moveDebounce);
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.onResize);
    }
    this.map?.remove();
  }

  /** Search bar input handler — keeps the `query` signal controlled. */
  onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Submit the free-text search (Enter in the search field). Runs an API text
   * search across ALL reports, then fits the map to the results. While a term
   * is active, map pan/zoom no longer triggers a bbox search (see refresh()).
   */
  onSearchSubmit(): void {
    const term = this.query().trim();
    this.searchTerm.set(term);
    if (term.length === 0) {
      // Empty submit behaves like clearing: go back to viewport search.
      this.refresh();
      return;
    }
    this.loading.set(true);
    this.reports
      .searchByText(term, this.range(), {
        categories: this.selectedActivities(),
        sources: this.selectedSources(),
      })
      .subscribe({
        next: (res) => {
          this.setResults(res.results);
          this.loading.set(false);
          this.fitMapToResults(res.results);
        },
        error: () => this.loading.set(false),
      });
  }

  /** Clear the search term and return to viewport (bbox) search. */
  clearSearch(): void {
    this.query.set('');
    this.searchTerm.set('');
    this.refresh();
  }

  /** Fits the map view to show all geolocated results (if any). */
  private fitMapToResults(results: Report[]): void {
    if (!this.L || !this.map) return;
    const pts = results
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => [r.latitude as number, r.longitude as number] as [number, number]);
    if (pts.length === 0) return;
    const bounds = this.L.latLngBounds(pts);
    // suppressNextSearch: fitBounds triggers moveend, but we must NOT run a bbox
    // search for it (we're in search mode). refresh() already guards on
    // searchTerm, so no extra flag is needed.
    this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }

  /**
   * Filter button hook — opens the filter bottom-sheet.
   */
  onFilter(): void {
    this.filterOpen.set(true);
  }

  /** Toggle an activity category in the selection (live). */
  toggleActivity(key: string): void {
    this.selectedActivities.update((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
    this.applyCurrent();
  }

  /** Toggle a source in the selection (live). */
  toggleSource(key: string): void {
    this.selectedSources.update((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
    this.applyCurrent();
  }

  /** Clear all filters. */
  resetFilters(): void {
    this.selectedActivities.set([]);
    this.selectedSources.set([]);
    this.applyCurrent();
  }

  /** Clear just the category selection (desktop dropdown "x"). */
  clearActivities(): void {
    this.selectedActivities.set([]);
    this.applyCurrent();
  }

  /** Clear just the source selection (desktop dropdown "x"). */
  clearSources(): void {
    this.selectedSources.set([]);
    this.applyCurrent();
  }

  /** Close the filter sheet; the current filter is already applied live. */
  closeFilter(): void {
    this.filterOpen.set(false);
  }


  /** Slider change handler (native range input, desktop). */
  onRangeInput(event: Event): void {
    const idx = Number((event.target as HTMLInputElement).value);
    this.rangeIndex.set(idx);
    this.applyCurrent();
  }

  /** Custom date-range slider: select a step by index (mobile). */
  selectRange(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.rangeIndex.set(i);
    this.applyCurrent();
  }

  /** Debounced bbox search triggered on map move/zoom. Suppressed while a
      free-text search term is active (pan/zoom must not override the search). */
  private onViewportChanged(): void {
    if (this.searchTerm().length > 0) return;
    if (this.moveDebounce) clearTimeout(this.moveDebounce);
    this.moveDebounce = setTimeout(() => this.refresh(), 300);
  }

  /**
   * Re-run whichever search mode is currently active: free-text search when a
   * term is set, otherwise a viewport (bbox) search. Used by filter/range
   * changes so they apply in both modes.
   */
  private applyCurrent(): void {
    if (this.searchTerm().length > 0) {
      this.onSearchSubmit();
    } else {
      this.refresh();
    }
  }

  /** Runs a bbox search for the current viewport + date range. */
  private refresh(): void {
    if (!this.map) return;
    const b = this.map.getBounds();
    const bbox: BoundingBox = {
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLng: b.getWest(),
      maxLng: b.getEast(),
    };
    this.loading.set(true);
    this.reports
      .searchByBoundingBox(bbox, this.range(), {
        categories: this.selectedActivities(),
        sources: this.selectedSources(),
      })
      .subscribe({
      next: (res) => {
        this.setResults(res.results);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Current date range: from = start (00:00) of the day `step.days` ago,
   * to = now. Reports are day-granular (stored at 00:00:00), so the lower
   * bound must be normalized to the START of the boundary day — otherwise a
   * report dated N days ago at midnight would be excluded by the current
   * time-of-day (e.g. "3 Tage" at 14:00 would drop that day's reports).
   */
  private range(): { from: string; to: string; limit: number } {
    const to = new Date();
    const days = this.currentStep.days ?? RANGE_ALL_DAYS; // Alle -> very wide window
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - days);
    from.setUTCHours(0, 0, 0, 0); // start of that day (reports are day-granular)
    return { from: from.toISOString(), to: to.toISOString(), limit: 200 };
  }

  /** Updates results + redraws map markers. */
  private setResults(results: Report[]): void {
    this.results.set(results);
    // Keep the current selection if that report is still in the new results
    // (e.g. after a pan/zoom refresh); otherwise clear it.
    const current = this.selectedId();
    if (current != null && !results.some((r) => r.id === current)) {
      this.selectedId.set(null);
    }
    this.drawMarkers(results);
  }

  private drawMarkers(results: Report[]): void {
    if (!this.L || !this.layer) return;
    this.layer.clearLayers();
    this.markers.clear();

    for (const r of results) {
      if (r.latitude == null || r.longitude == null) continue;
      const { iconUrl, label, color } = activityDisplay(r.activity);
      const marker = this.L.marker([r.latitude, r.longitude], {
        icon: this.L.divIcon({
          className: 'pin',
          // Teardrop pin in the category color with the white category icon.
          // The icon SVG is single-color, recolored to white via a CSS filter.
          html:
            `<span class="pin__drop" style="background:${color}" title="${label}">` +
            `<img class="pin__img" src="${iconUrl}" alt="" />` +
            `</span>`,
          iconSize: [34, 42],
          iconAnchor: [17, 42],
        }),
      });
      marker.on('click', () => this.selectReport(r.id));
      marker.addTo(this.layer);
      this.markers.set(r.id, marker);
    }

    // Markers were recreated — re-apply the highlight if the selected report is
    // still on the map.
    this.applySelectionHighlight(this.selectedId());
  }

  /**
   * Centers the map on the user's current position and drops a location marker.
   * Uses the browser Geolocation API; no-op outside the browser.
   */
  locate(): void {
    if (!isPlatformBrowser(this.platformId) || !navigator.geolocation) return;
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        const { latitude, longitude } = pos.coords;
        if (!this.L || !this.map) return;
        const latlng: [number, number] = [latitude, longitude];
        // Drop/replace a simple location dot marker.
        if (this.userMarker) {
          this.userMarker.setLatLng(latlng);
        } else {
          this.userMarker = this.L.marker(latlng, {
            icon: this.L.divIcon({
              className: 'user-loc',
              html: '<span class="user-loc__dot"></span>',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
            interactive: false,
            keyboard: false,
          }).addTo(this.map);
        }
        this.map.setView(latlng, Math.max(this.map.getZoom(), 12));
      },
      (err) => {
        this.locating.set(false);
        console.warn('[geolocation] failed:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  /**
   * Selection from a MAP PIN click. Both layouts select the report and give its
   * marker the persistent highlight (only one at a time). Additionally:
   *   - Desktop: scroll the right-hand results panel to the selected card.
   *   - Mobile:  the selected card moves to the top of the list (orderedResults).
   */
  selectReport(id: number): void {
    this.selectedId.set(id);
    this.applySelectionHighlight(id);
    if (this.isDesktop()) {
      this.scrollListToReport(id);
    }
  }

  /**
   * Selection from a LIST item. Selects + highlights the pin. Layout-specific:
   *   - Mobile:  scroll the page up to the map so the highlighted pin is visible.
   *   - Desktop: nothing extra — the item is simply shown as selected in place.
   */
  selectFromList(id: number): void {
    this.selectedId.set(id);
    this.applySelectionHighlight(id);
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.isDesktop()) {
      // Mobile: bring the map (with the highlighted pin) into view. The header
      // and search block are sticky, so a plain scrollIntoView({block:'start'})
      // would leave the map top hidden behind them. Scroll the window so the
      // map top lands just below the combined sticky-chrome height instead.
      setTimeout(() => {
        const mapEl = this.mapEl?.nativeElement;
        if (!mapEl) return;
        const stickyOffset =
          (this.mobileHeader?.nativeElement?.offsetHeight ?? 0) +
          (this.mobileSearch?.nativeElement?.offsetHeight ?? 0);
        const top = mapEl.getBoundingClientRect().top + window.scrollY - stickyOffset;
        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
      }, 0);
    }
  }

  /**
   * Desktop only: scroll the results panel so the selected card is visible.
   */
  private scrollListToReport(id: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      const panel = this.resultsPanel?.nativeElement;
      const card = panel?.querySelector<HTMLElement>(`[data-report-id="${id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  /** Moves the persistent `pin--selected` highlight to the given marker. */
  private applySelectionHighlight(id: number | null): void {
    // Clear the previous selection highlight.
    for (const marker of this.markers.values()) {
      marker.getElement()?.classList.remove('pin--selected');
    }
    if (id == null) return;
    const el = this.markers.get(id)?.getElement();
    if (el) {
      el.classList.add('pin--selected');
      // Bring the selected pin to the front.
      this.markers.get(id)?.setZIndexOffset(1000);
    }
  }

  /** List item hover -> dim transient highlight on the matching map pin. */
  highlightPin(id: number): void {
    this.markers.get(id)?.getElement()?.classList.add('pin--hover');
  }

  /** List item hover end -> remove the transient hover highlight. */
  unhighlightPin(id: number): void {
    this.markers.get(id)?.getElement()?.classList.remove('pin--hover');
  }

  /** List item click -> open the source page. */
  openReport(r: Report): void {
    if (r.url && isPlatformBrowser(this.platformId)) {
      window.open(r.url, '_blank', 'noopener,noreferrer');
    }
  }

  trackById(_i: number, r: Report): number {
    return r.id;
  }
}
