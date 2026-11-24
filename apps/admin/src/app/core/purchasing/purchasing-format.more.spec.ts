import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	StockQuantityPipe,
	apiIssues,
	apiStatus,
	downloadCsv,
	escapeHtml,
	fromUnits,
	itemCell,
	openPdf,
	quantity,
	shortDate,
	shortDateTime,
	toUnits,
} from './purchasing-format';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('purchasing words and numbers', () => {
	it('escapes nothing as empty, and writes no quantity as a dash', () => {
		expect([escapeHtml(null), escapeHtml(undefined), quantity(null), quantity(undefined)]).toEqual([
			'',
			'',
			'—',
			'—',
		]);
	});

	it('turns typed metres into tenths and back, and leaves pieces whole', () => {
		expect([toUnits(2.55, 'metre'), toUnits(3.4, 'piece'), fromUnits(25, 'metre'), fromUnits(3, 'piece')]).toEqual([
			26, 3, 2.5, 3,
		]);
	});

	it('writes a dash for a date that is missing or cannot be read', () => {
		expect([shortDate(null), shortDate('not a date'), shortDateTime(''), shortDateTime('not a date')]).toEqual([
			'—',
			'—',
			'—',
			'—',
		]);
		expect(shortDateTime('2026-11-12T10:42:00.000Z')).toMatch(/12 Nov 2026, 4:12 pm/i);
	});

	it('draws an item with its picture and note, or its first letter, or a dot for no name', () => {
		const pictured = itemCell({ imageUrl: 'https://cdn.test/a.jpg', title: 'Silk', sku: 'ST-1', note: 'Damaged' });
		expect(pictured).toContain('<img src="https://cdn.test/a.jpg"');
		expect(pictured).toContain('Damaged');
		expect(itemCell({ imageUrl: null, title: 'silk', sku: 'ST-1' })).toContain('<h4>S</h4>');
		expect(itemCell({ imageUrl: null, title: '', sku: 'ST-1' })).toContain('<h4>•</h4>');
	});
});

describe('files the browser saves or opens', () => {
	it('quotes cells holding commas, quotes or new lines, and lets the link go after a while', async () => {
		vi.useFakeTimers();
		const made: Blob[] = [];
		vi.stubGlobal('URL', {
			createObjectURL: (blob: Blob) => (made.push(blob), 'blob:csv'),
			revokeObjectURL: vi.fn(),
		});
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		downloadCsv(
			'bills.csv',
			['Supplier', 'Note'],
			[
				['Basak, Kolkata', 'said "soon"'],
				[null, 'a\nb'],
			],
		);
		const text = await (made[0] as Blob).text();
		expect(text).toContain('"Basak, Kolkata","said ""soon"""');
		expect(text).toContain(',"a\nb"');
		vi.advanceTimersByTime(30_000);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
	});

	it('opens a printed document in a new tab and lets it go after a minute', () => {
		vi.useFakeTimers();
		const revoke = vi.fn();
		vi.stubGlobal('URL', { createObjectURL: () => 'blob:pdf', revokeObjectURL: revoke });
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		openPdf(new Blob(['%PDF']));
		expect(open).toHaveBeenCalledWith('blob:pdf', '_blank', 'noopener');
		vi.advanceTimersByTime(60_000);
		expect(revoke).toHaveBeenCalledWith('blob:pdf');
	});
});

describe('reading the API’s refusals', () => {
	it('takes the code from the path when an issue names none, and the code as its sentence', () => {
		const error = { error: { error: { issues: [{ path: ['quantity', 'line_2'] }, { path: [] }, null] } } };
		expect(apiIssues(error)).toEqual([
			{ code: 'quantity', message: 'quantity', target: 'line_2' },
			{ code: 'refused', message: 'refused', target: null },
		]);
	});

	it('reads the HTTP status, or nothing for a plain failure', () => {
		expect([apiStatus({ status: 409 }), apiStatus(new Error('offline')), apiStatus(null)]).toEqual([
			409,
			null,
			null,
		]);
	});
});

describe('the stock quantity pipe', () => {
	it('writes metres in the admin language and pieces as they are', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				StockQuantityPipe,
				{
					provide: TranslocoService,
					useValue: { translate: (key: string, params: { value: string }) => `${params.value} ${key}` },
				},
			],
		});
		const pipe = TestBed.inject(StockQuantityPipe);
		expect([pipe.transform(425, 'metre'), pipe.transform(7), pipe.transform(null)]).toEqual([
			'42.5 unit_metres',
			'7',
			'—',
		]);
	});
});
