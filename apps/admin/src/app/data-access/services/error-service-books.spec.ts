import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { ErrorService } from './error.service';

/** A step the books refused shows in words in the error notice (Postings and Convert brief AP2). */
describe('the error notice for a books refusal', () => {
	it('puts a books code in words, and leaves other messages as they came', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				TranslocoTestingModule.forRoot({
					langs: { en: { books_no_bank_received_by_bank: 'Set a bank account first.' } },
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
		});
		const service = TestBed.inject(ErrorService);
		const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });
		expect(service.getClientErrorMessage(refused('money_lands_not_set:received_by_bank'))).toBe(
			'Set a bank account first.',
		);
		expect(service.getClientErrorMessage({ error: { code: 'x', message: 'Readable' } })).toBe('Readable');
	});

	it('shows the code as it came where no translations are loaded', () => {
		TestBed.resetTestingModule();
		const service = TestBed.inject(ErrorService);
		expect(service.getClientErrorMessage({ error: { code: 'x', message: 'books_need_a_location' } })).toBe(
			'books_need_a_location',
		);
	});
});
