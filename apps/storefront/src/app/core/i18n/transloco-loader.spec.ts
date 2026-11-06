import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { TranslocoHttpLoader } from './transloco-loader';

describe('TranslocoHttpLoader', () => {
	it('reads the dictionary for a language', () => {
		const get = vi.fn(() => of({}));
		TestBed.configureTestingModule({
			providers: [TranslocoHttpLoader, { provide: HttpClient, useValue: { get } }],
		});
		TestBed.inject(TranslocoHttpLoader).getTranslation('fr');
		expect(String((get.mock.lastCall as unknown as string[])[0])).toMatch(/assets\/i18n\/fr\.json$/);
	});
});
