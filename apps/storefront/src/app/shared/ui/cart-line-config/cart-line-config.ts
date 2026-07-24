import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ICartLineConfig } from '@data-access/interfaces/cart.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

/**
 * Reusable cart-line detail block: renders a composed line's add-on / bundle
 * selections, bundle components, and measurements. Shared by the full-page cart
 * and the off-canvas mini-cart so complex products read consistently. Hidden for
 * plain lines (no config).
 */
@Component({
	selector: 'app-cart-line-config',
	templateUrl: './cart-line-config.html',
	styleUrls: ['./cart-line-config.scss'],
	imports: [CurrencySymbolPipe, TranslocoModule],
})
export class CartLineConfig {
	readonly config = input<ICartLineConfig | undefined>();

	readonly componentNames = computed(() => (this.config()?.bundle_components ?? []).map((c) => c.name).join(', '));
}
