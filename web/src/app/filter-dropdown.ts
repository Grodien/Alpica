import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** A selectable option for the dropdown. */
export interface DropdownOption {
  key: string;
  label: string;
  /** Optional icon (category chips); omitted for sources. */
  icon?: string;
  /** Optional active color (category chips). */
  color?: string;
}

/**
 * Desktop multi-select dropdown used for the "Alle Kategorien" / "Alle Quellen"
 * filters. Click toggles the menu; options are checkboxes (multi-select). The
 * parent owns the selected state; this only renders + emits toggles. Closes on
 * outside click / Escape.
 */
@Component({
  selector: 'app-filter-dropdown',
  imports: [],
  templateUrl: './filter-dropdown.html',
  styleUrl: './filter-dropdown.css',
})
export class FilterDropdown {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Placeholder shown when nothing is selected (e.g. "Alle Kategorien"). */
  readonly placeholder = input<string>('');
  /** All selectable options. */
  readonly options = input<DropdownOption[]>([]);
  /** Selected option keys. */
  readonly selected = input<string[]>([]);

  /** Emitted when an option is toggled. */
  readonly toggle = output<string>();

  protected readonly open = signal(false);

  /** Button label: placeholder, the single selected label, or "N ausgewählt". */
  protected readonly label = computed(() => {
    const sel = this.selected();
    if (sel.length === 0) return this.placeholder();
    if (sel.length === 1) {
      const opt = this.options().find((o) => o.key === sel[0]);
      return opt?.label ?? this.placeholder();
    }
    return `${sel.length} ausgewählt`;
  });

  isSelected(key: string): boolean {
    return this.selected().includes(key);
  }

  toggleOpen(): void {
    this.open.update((v) => !v);
  }

  onToggle(key: string): void {
    this.toggle.emit(key);
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
}
