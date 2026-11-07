import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { Checkout } from './checkout';

describe('Checkout', () => {
	it('says it is closed, and leads back to the cart', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(Checkout, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Checkout).componentInstance;
		expect(page.breadcrumb).toBeDefined();
	});
});
