import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/**
 * A bundle's product form steps aside (bundle builder brief A03, approved 2026-11-22: "Choosing Bundle opens the
 * builder"). This card says why and opens the builder, where every part of a bundle is edited: Build, Price rules,
 * Details, Photos, SEO, FAQ's and Status. Today's Bundle Type and Price Policy fields retired with it (owner: "That
 * screen no longer applies").
 */
@Component({
	selector: 'app-product-bundle',
	templateUrl: './product-bundle.html',
	imports: [TranslocoModule],
})
export class ProductBundleForm {
	/** Null while the product is new: the button saves its name first, then opens the builder. */
	readonly productId = input<string | null>(null);
	readonly name = input('');
	readonly busy = input(false);
	readonly open = output<void>();
}
