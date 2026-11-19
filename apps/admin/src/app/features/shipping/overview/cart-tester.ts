import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { SrbTry } from '../builder/srb-try';

/**
 * Overview › Try any cart (brief ov01): a cart of real products priced with the live settings, the
 * way checkout will price it. It is the builder's Try it panel in its live mode, so it reads the same.
 */
@Component({
	selector: 'app-shipping-cart-tester',
	templateUrl: './cart-tester.html',
	// The Try it panel's `srb-` classes; a popup sits outside the page, so it brings them along.
	styleUrls: ['../builder/rule-builder.scss'],
	imports: [SrbTry, TranslocoModule],
})
export class ShippingCartTester {
	readonly modal = inject(NgbActiveModal);
}
