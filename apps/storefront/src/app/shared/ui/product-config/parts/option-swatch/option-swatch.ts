import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';

import { IAddonTerm, DisplayStyle } from '@data-access/interfaces/product-detail.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

/**
 * Reusable option-group selector for add-on / bundle option terms. Renders the
 * terms in the admin-chosen `displayStyle` (image_swatch / rectangle / circle /
 * color_swatch / radio / dropdown, and the four looks from the early renders:
 * picture_row / picture_chip / size_v2 / colour_chip) with the per-term price delta, and emits the
 * selected term code. Shared by the add-on group and the bundle configurator.
 * Every option is server-rendered (crawlable); only the visual state differs.
 */
@Component({
	selector: 'app-option-swatch',
	templateUrl: './option-swatch.html',
	styleUrls: ['./option-swatch.scss'],
	providers: [CurrencySymbolPipe],
	imports: [NgTemplateOutlet, NgbTooltip, TranslocoModule, CurrencySymbolPipe],
})
export class OptionSwatch {
	readonly label = input<string>('');
	readonly terms = input<IAddonTerm[]>([]);
	readonly displayStyle = input<DisplayStyle>('rectangle');
	readonly required = input<boolean>(false);
	readonly selected = input<string>();
	/** A long picture-row list folds to three rows below laptop size until the shopper opens it (HX-3). */
	readonly expanded = signal(false);
	readonly folds = computed(() => this.displayStyle() === 'picture_row' && this.terms().length > 3);

	readonly selectedChange = output<string>();

	readonly selectedLabel = computed(() => this.terms().find((t) => t.code === this.selected())?.label ?? '');

	select(code: string) {
		this.selectedChange.emit(code);
	}
}
