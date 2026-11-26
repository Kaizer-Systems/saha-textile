import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EDocsGateway } from '@core/edocs/edocs.gateway';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { EDocListPage, periodRange } from './edoc-list';

import type { EDocument } from '@saha-textile/contracts';

/** Accounts › E-invoices and Accounts › E-way bills drawn (addendum 2, EI12–EI13): tabs, search, period, pages. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const HOUR = 3_600_000;
const at = (fromNow: number) => new Date(Date.now() + fromNow).toISOString();
const doc = (id: string, over: Partial<EDocument> = {}): EDocument =>
	({
		id,
		kind: 'eInvoice',
		gstin: '19DBYPS6736R1ZZ',
		documentType: 'taxInvoice',
		documentId: `inv_${id}`,
		documentNumber: `INV/26-27/00${id}`,
		documentDate: '2026-11-20',
		orderId: null,
		partyName: 'Nadia Weavers',
		partyGstin: '19AAPFU0939F1ZV',
		valueINR: 12_500.5,
		path: 'irpDirect',
		status: 'active',
		irn: 'a1b2c3d4e5f6a7b8c9d0',
		ackNo: '112410000123456',
		ackDate: null,
		signedQr: 'qr',
		signedInvoice: null,
		ewbNumber: null,
		generatedAt: null,
		validUntil: null,
		partB: null,
		portalPdfId: null,
		...over,
	}) as EDocument;

function mount(data: Record<string, unknown>, rows: EDocument[], total = rows.length) {
	TestBed.resetTestingModule();
	const documents = vi.fn(() => of({ rows, total }));
	TestBed.configureTestingModule({
		imports: [
			EDocListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: EDocsGateway, useValue: { documents } },
			{ provide: ActivatedRoute, useValue: { data: of(data) } },
		],
	});
	// The period picker is its own component; its choice reaches the page through setPeriod.
	TestBed.overrideComponent(EDocListPage, {
		remove: { imports: [PeriodPicker] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(EDocListPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, documents };
}
async function opened(...args: Parameters<typeof mount>) {
	const harness = mount(...args);
	await settle(harness.fixture);
	return harness;
}

const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: HTMLElement | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const tabs = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('.nav-link')] as HTMLElement[];
const lastAsked = (documents: ReturnType<typeof vi.fn>) =>
	(documents.mock.lastCall as unknown as [Record<string, unknown>])[0];

describe('the e-invoice list (EI12)', () => {
	it('opens on generated e-invoices of the last twelve months, each with its IRN, acknowledgement, value and QR', async () => {
		const { fixture, page, documents } = await opened({}, [
			doc('1'),
			doc('2', {
				partyName: null,
				partyGstin: null,
				irn: null,
				ackNo: null,
				valueINR: null,
				path: 'manual',
				signedQr: null,
				documentType: 'creditNote',
			}),
		]);
		expect(page.kind()).toBe('eInvoice');
		expect(tabs(fixture).map((t) => [t.id, t.textContent?.trim(), t.classList.contains('active')])).toEqual([
			['edoc_tab_active', 'edoc_tab_generated', true],
			['edoc_tab_cancelled', 'edoc_tab_cancelled', false],
		]);
		expect(lastAsked(documents)).toEqual({
			kind: 'eInvoice',
			status: 'active',
			...periodRange({ period: 'last_12_months' }),
			page: 1,
		});
		const [first, second] = rows(fixture);
		expect(cells(first)).toEqual([
			'INV/26-27/001 edoc_doc_taxInvoice',
			'20 Nov 2026',
			'Nadia Weavers 19AAPFU0939F1ZV',
			'a1b2…c9d0',
			'112410000123456',
			'₹12,500.50',
			'edoc_how_connection',
			'edoc_qr_signed',
		]);
		expect(cells(second)).toEqual([
			'INV/26-27/002 edoc_doc_creditNote',
			'20 Nov 2026',
			'— edoc_no_gstin',
			'—',
			'—',
			'—',
			'edoc_how_manual',
			'edoc_qr_pending',
		]);
		expect(first?.querySelector('.status-success')).not.toBeNull();
		expect(second?.querySelector('.status-pending')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.pagination')).toBeNull();
	});

	it('searches by what is typed, trimmed, back on the first page, and asks for no search when it is blank', async () => {
		const { fixture, page, documents } = await opened({ kind: 'eInvoice' }, [doc('1')], 80);
		(fixture.nativeElement.querySelectorAll('.page-link')[2] as HTMLElement).click();
		await settle(fixture);
		expect(lastAsked(documents)['page']).toBe(3);
		const box = fixture.nativeElement.querySelector('#edoc_search') as HTMLInputElement;
		box.value = '  Nadia ';
		box.dispatchEvent(new Event('input'));
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ q: 'Nadia', page: 1 });
		box.value = '   ';
		box.dispatchEvent(new Event('input'));
		await settle(fixture);
		expect('q' in lastAsked(documents)).toBe(false);
		expect(page.pages()).toBe(4);
	});

	it('reads the cancelled ones on their tab, and a new period from the first page', async () => {
		const { fixture, page, documents } = await opened({}, [doc('1', { status: 'cancelled' })], 30);
		page.page.set(2);
		tabs(fixture)[1]?.click();
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ status: 'cancelled', page: 1 });
		page.page.set(2);
		page.setPeriod({ period: 'custom', from: '2026-04-01', to: '2026-06-30' });
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ from: '2026-04-01', to: '2026-06-30', page: 1 });
	});

	it('says when there are none', async () => {
		const { fixture, page } = await opened({}, []);
		expect(cells(rows(fixture)[0])).toEqual(['edoc_list_empty']);
		expect([page.pages(), page.shortIrn(null)]).toEqual([1, '—']);
	});
});

describe('the e-way bill list (EI13)', () => {
	const bills = [
		doc('1', { kind: 'eWayBill', path: 'ewbDirect', ewbNumber: '331009876543', validUntil: at(48 * HOUR) }),
		doc('2', { kind: 'eWayBill', path: 'ewbDirect', ewbNumber: '331009876544', validUntil: at(5 * HOUR) }),
		doc('3', { kind: 'eWayBill', path: 'manual', ewbNumber: null, validUntil: at(-2 * HOUR) }),
		doc('4', { kind: 'eWayBill', path: 'ewbProvider', ewbNumber: '331009876546', validUntil: null }),
	];

	it('asks the server for each validity tab, so every tab pages on its own bills', async () => {
		const { fixture, page, documents } = await opened({ kind: 'eWayBill' }, bills);
		expect(tabs(fixture).map((t) => t.textContent?.trim())).toEqual([
			'edoc_tab_active',
			'edoc_tab_endsSoon',
			'edoc_tab_ended',
			'edoc_tab_cancelled',
		]);
		expect(lastAsked(documents)).toMatchObject({ status: 'active', validity: 'current' });
		// The server's rows are shown as they come.
		expect(page.rows().map((r) => r.id)).toEqual(['1', '2', '3', '4']);
		expect(cells(rows(fixture)[0])[3]).toBe('331009876543');
		expect(rows(fixture)[0]?.querySelectorAll('td')).toHaveLength(7);
		tabs(fixture)[1]?.click();
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ status: 'active', validity: 'endsSoon' });
		tabs(fixture)[2]?.click();
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ status: 'active', validity: 'ended' });
		tabs(fixture)[3]?.click();
		await settle(fixture);
		expect(lastAsked(documents)).toMatchObject({ status: 'cancelled' });
		expect(lastAsked(documents)).not.toHaveProperty('validity');
	});
});
