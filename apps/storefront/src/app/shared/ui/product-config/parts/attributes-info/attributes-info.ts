import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ISemanticAttribute } from '@data-access/interfaces/product-detail.interface';

/**
 * `filter_only` attributes rendered as a descriptive pill row near the title
 * (icon + "Label: Value"). Display-only — never selectable, never changes
 * SKU/stock/price. These same values feed category/search facets (that filter
 * UI lives on the category page, not here). Plain text, fully crawlable.
 */
@Component({
	selector: 'app-attributes-info',
	templateUrl: './attributes-info.html',
	styleUrls: ['./attributes-info.scss'],
	imports: [TranslocoModule],
})
export class AttributesInfo {
	readonly attributes = input<ISemanticAttribute[]>([]);
}
