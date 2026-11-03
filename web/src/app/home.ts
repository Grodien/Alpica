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
  imports: [ResultsList, FilterSheet],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements AfterViewInit, OnDestroy {
  private readonly reports = inject(ReportsService);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('mapEl') private mapEl!: ElementRef<HTMLDivElement>;

  protected readonly steps = RANGE_STEPS;
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
        zoomControl: true,
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
   * Filter button hook. Stub for now so the yellow Filter button is clickable
   * without changing the data flow. Filtering will be wired up in a later task.
   */
  onFilter(): void {
    this.filterOpen.set(true);
  }

  /** Toggle an activity category in the selection (live). */
  toggleActivity(key: string): void {
    this.selectedActivities.update((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
    this.refresh();
  }

  /** Toggle a source in the selection (live). */
  toggleSource(key: string): void {
    this.selectedSources.update((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
    this.refresh();
  }

  /** Clear all filters. */
  resetFilters(): void {
    this.selectedActivities.set([]);
    this.selectedSources.set([]);
    this.refresh();
  }

  /** Close the filter sheet; the current filter is already applied live. */
  closeFilter(): void {
    this.filterOpen.set(false);
  }


  /** Slider change handler (native range input, desktop). */
  onRangeInput(event: Event): void {
    const idx = Number((event.target as HTMLInputElement).value);
    this.rangeIndex.set(idx);
    this.refresh();
  }

  /** Custom date-range slider: select a step by index (mobile). */
  selectRange(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.rangeIndex.set(i);
    this.refresh();
  }

  /** Debounced bbox search triggered on map move/zoom. */
  private onViewportChanged(): void {
    if (this.moveDebounce) clearTimeout(this.moveDebounce);
    this.moveDebounce = setTimeout(() => this.refresh(), 300);
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

  /** Current date range (from = now - step days, to = now). */
  private range(): { from: string; to: string; limit: number } {
    const to = new Date();
    const from = new Date();
    const days = this.currentStep.days ?? RANGE_ALL_DAYS; // Alle -> very wide window
    from.setUTCDate(from.getUTCDate() - days);
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

  /** Pin click -> select the report and move it to the top of the list. */
  /**
   * Select a report (from a map pin click OR a list item). The selected report
   * moves to the top of the list and its map marker gets a persistent highlight.
   * Only ONE marker can be highlighted at a time.
   */
  selectReport(id: number): void {
    this.selectedId.set(id);
    this.applySelectionHighlight(id);
  }

  /**
   * Selection coming from a LIST item: select as usual, then scroll the map
   * into view so the highlighted pin is visible (the whole page scrolls on
   * mobile, and the tapped list row may be far below the map).
   */
  selectFromList(id: number): void {
    this.selectReport(id);
    if (!isPlatformBrowser(this.platformId)) return;
    // Defer to the next frame so the list reorder/highlight has applied.
    setTimeout(() => {
      this.mapEl?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
