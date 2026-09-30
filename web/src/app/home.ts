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
import { activityDisplay } from './activity-icons';

/** Date-range slider steps. */
interface RangeStep {
  label: string;
  days: number;
}
const RANGE_STEPS: RangeStep[] = [
  { label: 'Heute', days: 1 },
  { label: '7 Tage', days: 7 },
  { label: '30 Tage', days: 30 },
  { label: '3 Monate', days: 90 },
];

/** Default map view (European Alps) used before the first search. */
const DEFAULT_CENTER: [number, number] = [46.5, 9.5];
const DEFAULT_ZOOM = 7;

/**
 * Skitourenguru tile server (standard XYZ scheme via query params). It serves
 * the region-appropriate topo map across the whole Alps. NOTE: the server uses
 * a Referer allowlist — it works from localhost, but for a public domain you
 * likely need Skitourenguru to whitelist it. See the map notes in the README.
 */
const SKITOURENGURU_TILES = 'https://map.skitourenguru.com/AP_SG_TOPO_MINI.tms?x={x}&y={y}&z={z}';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements AfterViewInit, OnDestroy {
  private readonly reports = inject(ReportsService);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('mapEl') private mapEl!: ElementRef<HTMLDivElement>;

  protected readonly steps = RANGE_STEPS;
  protected readonly rangeIndex = signal(2); // default 30 days
  protected readonly results = signal<Report[]>([]);
  protected readonly loading = signal(false);
  protected readonly selectedId = signal<number | null>(null);

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

  protected readonly display = activityDisplay;

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
      });

      // --- Base map --------------------------------------------------------
      // OpenStreetMap sits underneath as a worldwide fallback (shows through
      // where the Skitourenguru tiles have no coverage or fail to load).
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors',
        })
        .addTo(this.map);

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
    this.map?.remove();
  }

  /** Slider change handler. */
  onRangeInput(event: Event): void {
    const idx = Number((event.target as HTMLInputElement).value);
    this.rangeIndex.set(idx);
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
    this.reports.searchByBoundingBox(bbox, this.range()).subscribe({
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
    from.setUTCDate(from.getUTCDate() - this.currentStep.days);
    return { from: from.toISOString(), to: to.toISOString(), limit: 200 };
  }

  /** Updates results + redraws map markers. */
  private setResults(results: Report[]): void {
    this.results.set(results);
    this.selectedId.set(null);
    this.drawMarkers(results);
  }

  private drawMarkers(results: Report[]): void {
    if (!this.L || !this.layer) return;
    this.layer.clearLayers();
    this.markers.clear();

    for (const r of results) {
      if (r.latitude == null || r.longitude == null) continue;
      const { icon, label } = activityDisplay(r.activity);
      const marker = this.L.marker([r.latitude, r.longitude], {
        icon: this.L.divIcon({
          className: 'pin',
          html: `<span class="pin__icon" title="${label}"><span>${icon}</span></span>`,
          iconSize: [34, 42],
          iconAnchor: [17, 42],
        }),
      });
      marker.on('click', () => this.selectReport(r.id));
      marker.addTo(this.layer);
      this.markers.set(r.id, marker);
    }
  }

  /** Pin click -> select the report and move it to the top of the list. */
  selectReport(id: number): void {
    this.selectedId.set(id);
  }

  /** List item hover -> visually highlight the matching map pin. */
  highlightPin(id: number): void {
    const marker = this.markers.get(id);
    const el = marker?.getElement();
    el?.classList.add('pin--hover');
  }

  /** List item hover end -> remove the pin highlight. */
  unhighlightPin(id: number): void {
    const marker = this.markers.get(id);
    const el = marker?.getElement();
    el?.classList.remove('pin--hover');
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
