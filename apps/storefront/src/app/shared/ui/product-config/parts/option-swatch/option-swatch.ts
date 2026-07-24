import { Component, computed, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';

import { IAddonTerm, DisplayStyle } from '@data-access/interfaces/product-detail.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

/**
 * Reusable option-group selector for add-on / bundle option terms. Renders the
 * terms in the admin-chosen `displayStyle` (image_swatch / rectangle / circle /
 * color_swatch / radio / dropdown) with the per-term price delta, and emits the
 * selected term code. Shared by the add-on group and the bundle configurator.
 * Every option is server-rendered (crawlable); only the visual state differs.
 */
@Component({
	selector: 'app-option-swatch',
	templateUrl: './option-swatch.html',
	styleUrls: ['./option-swatch.scss'],
	providers: [CurrencySymbolPipe],
	imports: [NgbTooltip, TranslocoModule, CurrencySymbolPipe],
})
export class OptionSwatch {
	readonly label = input<string>('');
	readonly terms = input<IAddonTerm[]>([]);
	readonly displayStyle = input<DisplayStyle>('rectangle');
	readonly required = input<boolean>(false);
	readonly selected = input<string>();

	readonly selectedChange = output<string>();

	readonly selectedLabel = computed(() => this.terms().find((t) => t.code === this.selected())?.label ?? '');

	select(code: string) {
		this.selectedChange.emit(code);
	}
}
