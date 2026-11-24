import { TestBed } from '@angular/core/testing';

import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { Approvals } from './approvals';
import { CountPage } from './count-page';
import { countQuantity } from './count-quantity';

/** A count's short, over and net: pieces and metres kept apart (owner, 24 Nov). */

describe('a count’s quantity in words', () => {
	it('reads pieces as before, fabric in metres, and both side by side, never added together', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				TranslocoTestingModule.forRoot({
					langs: {
						en: {
							unit_metres: '{{value}} m',
							qty_pieces_one: '{{count}} piece',
							qty_pieces_other: '{{count}} pieces',
						},
					},
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
		});
		const transloco = TestBed.inject(TranslocoService);
		expect([
			countQuantity(transloco, 4, 0),
			countQuantity(transloco, 0, 15),
			countQuantity(transloco, 4, 15),
			countQuantity(transloco, 1, 25),
			countQuantity(transloco, 0, 0),
		]).toEqual(['4', '1.5 m', '4 pieces and 1.5 m', '1 piece and 2.5 m', '0']);
		// The count page's boxes and the approval card word their figures the same way.
		expect([
			CountPage.prototype.qty.call({ transloco } as never, 4, 15),
			Approvals.prototype.qty.call({ transloco } as never, 0, 5),
		]).toEqual(['4 pieces and 1.5 m', '0.5 m']);
	});
});
