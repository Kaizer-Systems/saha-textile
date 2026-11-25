import { ApplicationRef, CUSTOM_ELEMENTS_SCHEMA, TemplateRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { shortDateTime } from '@core/purchasing/purchasing-format';
import { AuditGateway } from '@core/worklist/audit.gateway';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { AUDIT_MODULES, AuditTrailPage, changeLine, shown } from './audit-trail-page';

import type { AuditLogEntry } from '@saha-textile/contracts';

/**
 * Settings › Audit trail (brief 26 AU1): every action the admin keeps, reviewed by module, action, person (by name)
 * and time, a page at a time; each row opens the change in full; the Export menu writes every matching record.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry =>
	({
		id: 'au1',
		actorUserId: 'usr_1',
		targetUserId: null,
		audience: 'admin',
		action: 'payroll.rules.add',
		entityType: 'payroll_rules',
		entityId: 'v5',
		severity: 'info',
		retentionTier: 'catalog_admin',
		diffs: [
			{ field: 'pfRatePct', before: 12, after: 10 },
			{ field: 'note', before: '', after: 'CA review' },
		],
		metadata: { reason: 'New notification' },
		requestId: null,
		createdAt: '2026-11-25T06:00:00.000Z',
		...over,
	}) as AuditLogEntry;
const ENTRIES = [
	entry({ actorName: 'Asha Das' }),
	entry({
		id: 'au2',
		actorUserId: null,
		action: 'login',
		entityType: null,
		entityId: null,
		diffs: [],
		metadata: {},
	}),
	entry({
		id: 'au3',
		actorUserId: 'usr_9',
		action: 'stock.adjust',
		entityType: 'variant',
		entityId: 'var_1',
		diffs: [{ field: 'quantity', before: 4, after: 3 }],
		metadata: {},
	}),
];
const PEOPLE = [
	{ id: 'usr_1', name: 'Asha Das' },
	{ id: 'usr_9', name: 'Mitali Sen' },
];
type Query = Record<string, string | number>;

/** The trail as the API pages it: the screen's page of fifty, or the export's pages of 200. */
async function trail(
	read: ((query: Query) => { items: AuditLogEntry[]; total: number }) | null = () => ({ items: ENTRIES, total: 3 }),
) {
	TestBed.resetTestingModule();
	const views: { detectChanges: () => void }[] = [];
	const opened: unknown[] = [];
	const gateway = {
		list: vi.fn((query: Query) =>
			read === null ? NEVER : of({ ...read(query), page: query['page'], pageSize: query['pageSize'] }),
		),
		people: vi.fn(() => of(PEOPLE)),
	};
	TestBed.configureTestingModule({
		imports: [
			AuditTrailPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: AuditGateway, useValue: gateway },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>, options: unknown) => {
						opened.push(options);
						const view = content.createEmbeddedView({ $implicit: { dismiss: vi.fn() } });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'atr-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return { dismiss: vi.fn() };
					}),
				},
			},
		],
	});
	document.body.querySelectorAll('.atr-test-modal').forEach((node) => node.remove());
	TestBed.overrideComponent(AuditTrailPage, {
		remove: { imports: [ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(AuditTrailPage);
	fixture.detectChanges();
	// A trail that never arrives keeps the page from going stable: wait a turn instead.
	if (read === null) await new Promise((resolve) => setTimeout(resolve, 0));
	else await settle(fixture);
	const find = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	const enter = async (box: Element | null, value: string) => {
		(box as HTMLInputElement).value = value;
		box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
		await settle(fixture);
	};
	const redrawModal = () => views.at(-1)?.detectChanges();
	return {
		fixture,
		page: fixture.componentInstance,
		gateway,
		opened,
		find,
		enter,
		redrawModal,
		settle: () => settle(fixture),
	};
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const inModal = (selector: string) =>
	[...document.querySelectorAll('.atr-test-modal')].at(-1)?.querySelector(selector) as HTMLElement | null;

describe('a change as the trail shows it', () => {
	it('shows nothing as a dash, an object as JSON, and anything else as it is', () => {
		expect([shown(undefined), shown(null), shown(''), shown({ a: 1 }), shown(12), shown(false)]).toEqual([
			'—',
			'—',
			'—',
			'{"a":1}',
			'12',
			'false',
		]);
	});

	it('says each field from and to, and the reason when one was given', () => {
		expect(changeLine(entry())).toBe('pfRatePct: 12 → 10 · note: — → CA review · "New notification"');
		expect(changeLine(entry({ metadata: { reason: 7 } }))).toBe('pfRatePct: 12 → 10 · note: — → CA review');
		expect(changeLine(entry({ diffs: [], metadata: {} }))).toBe('');
	});
});

describe('Settings › Audit trail (AU1)', () => {
	it('reads the admin’s first page of fifty, each person by name, else by id, else the system', async () => {
		const { page, gateway, find } = await trail();
		expect(gateway.list).toHaveBeenCalledWith({ page: 1, pageSize: 50, audience: 'admin' });
		expect([...(find<HTMLSelectElement>('#au_module')?.options ?? [])].map((o) => o.value)).toEqual([
			'',
			...AUDIT_MODULES,
		]);
		const rows = [...(find('tbody')?.querySelectorAll('tr') ?? [])] as HTMLElement[];
		const when = shortDateTime('2026-11-25T06:00:00.000Z');
		expect(rows.map((tr) => [...tr.querySelectorAll('td')].map((td) => text(td)))).toEqual([
			[
				when,
				'Asha Das',
				'payroll · payroll.rules.add',
				'payroll_rules v5',
				'pfRatePct: 12 → 10 · note: — → CA review · "New notification"',
			],
			[when, 'wl_system', 'login · login', '', '—'],
			[when, 'usr_9', 'stock · stock.adjust', 'variant var_1', 'quantity: 4 → 3'],
		]);
		expect(ENTRIES.map((e) => page.who(e))).toEqual(['Asha Das', 'wl_system', 'usr_9']);
		// An action without a module part is its own module.
		expect([
			page.moduleOf(entry({ action: 'stock.adjust' })),
			page.moduleOf(entry({ action: 'login' })),
			page.pages(),
		]).toEqual(['stock', 'login', 1]);
	});

	it('narrows by module, action, person (picked by name) and India days, each change back to the first page', async () => {
		const { page, gateway, find, enter } = await trail();
		expect([...(find<HTMLSelectElement>('#au_actor')?.options ?? [])].map((o) => [o.value, text(o)])).toEqual([
			['', 'atr_anyone'],
			['usr_1', 'Asha Das'],
			['usr_9', 'Mitali Sen'],
		]);
		page.page.set(3);
		await enter(find('#au_module'), 'payroll');
		expect(page.page()).toBe(1);
		await enter(find('#au_action'), '  payroll.rules.add  ');
		await enter(find('#au_actor'), 'usr_1');
		await enter(find('#au_from'), '2026-11-01');
		await enter(find('#au_to'), '2026-11-26');
		expect(gateway.list).toHaveBeenLastCalledWith({
			page: 1,
			pageSize: 50,
			audience: 'admin',
			module: 'payroll',
			action: 'payroll.rules.add',
			actorUserId: 'usr_1',
			from: '2026-10-31T18:30:00.000Z',
			to: '2026-11-26T18:29:59.000Z',
		});
		await enter(find('#au_action'), '   ');
		await enter(find('#au_actor'), '');
		expect(page.query()).not.toHaveProperty('action');
		expect(page.query()).not.toHaveProperty('actorUserId');
	});

	it('pages through the trail, held at either end', async () => {
		const { page, gateway, find, settle } = await trail(() => ({ items: ENTRIES, total: 120 }));
		const prev = find<HTMLButtonElement>('#au_prev') as HTMLButtonElement;
		const next = find<HTMLButtonElement>('#au_next') as HTMLButtonElement;
		expect([page.pages(), prev.disabled, next.disabled]).toEqual([3, true, false]);
		next.click();
		await settle();
		expect([page.page(), prev.disabled, gateway.list.mock.lastCall]).toEqual([
			2,
			false,
			[{ page: 2, pageSize: 50, audience: 'admin' }],
		]);
		next.click();
		await settle();
		expect([page.page(), next.disabled]).toEqual([3, true]);
		prev.click();
		await settle();
		expect(page.page()).toBe(2);
	});

	it('says so when nothing is kept, with one page, and counts one page before the trail is read', async () => {
		const { page, find } = await trail(() => ({ items: [], total: 0 }));
		expect([page.pages(), text(find('td[colspan="5"]'))]).toEqual([1, 'atr_none']);
		expect(find<HTMLButtonElement>('#au_next')?.disabled).toBe(true);
		const reading = await trail(null);
		expect(reading.page.pages()).toBe(1);
	});

	it('opens a record in full: who by name, the record, every field before and after, and what else was kept', async () => {
		const { page, opened, find, redrawModal } = await trail();
		find('#atr_row_au1')?.click();
		expect([page.open()?.id, opened]).toEqual(['au1', [{ centered: true, size: 'lg' }]]);
		expect(text(inModal('.modal-title'))).toBe(`payroll.rules.add · ${shortDateTime('2026-11-25T06:00:00.000Z')}`);
		expect(text(inModal('.modal-body p'))).toBe('atr_who: Asha Das · atr_record: payroll_rules v5');
		const rows = [...(inModal('tbody')?.querySelectorAll('tr') ?? [])].map((tr) =>
			[...tr.querySelectorAll('td')].map((td) => text(td)),
		);
		expect(rows).toEqual([
			['pfRatePct', '12', '10'],
			['note', '—', 'CA review'],
		]);
		expect(inModal('#au_metadata')?.textContent?.trim()).toBe('{"reason":"New notification"}');
		find('#atr_row_au2')?.click();
		expect(text(inModal('.modal-body p'))).toBe('atr_who: wl_system · atr_record:');
		expect(text(inModal('td[colspan="3"]'))).toBe('atr_no_fields');
		expect(inModal('#au_metadata')?.textContent?.trim()).toBe('{}');
		// Closed underneath: the pop-up names no one.
		page.open.set(null);
		redrawModal();
		expect(text(inModal('.modal-body p'))).toBe('atr_who: · atr_record:');
	});

	it('exports every record the filters match, read 200 at a time, naming the module and days asked for', async () => {
		const { page, gateway } = await trail();
		const source = await page.exportSource();
		expect(source).toEqual({
			fileName: 'audit-trail',
			title: 'atr_title',
			filters: [],
			header: ['atr_when', 'atr_who', 'atr_module', 'atr_action', 'atr_record', 'atr_what'],
			rows: [
				[
					'2026-11-25T06:00:00.000Z',
					'Asha Das',
					'payroll',
					'payroll.rules.add',
					'payroll_rules v5',
					'pfRatePct: 12 → 10 · note: — → CA review · "New notification"',
				],
				['2026-11-25T06:00:00.000Z', '', 'login', 'login', '', ''],
				['2026-11-25T06:00:00.000Z', 'usr_9', 'stock', 'stock.adjust', 'variant var_1', 'quantity: 4 → 3'],
			],
		});
		expect(gateway.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 200, audience: 'admin' });
		page.set('module', 'payroll');
		page.set('to', '2026-11-26');
		expect((await page.exportSource()).filters).toEqual([
			{ label: 'atr_module', value: 'payroll' },
			{ label: 'atr_when', value: ' – 2026-11-26' },
		]);
		page.set('module', '');
		page.set('to', '');
		page.set('from', '2026-11-01');
		expect((await page.exportSource()).filters).toEqual([{ label: 'atr_when', value: '2026-11-01 – ' }]);
	});

	it('reads page after page for the export until every matching record is in', async () => {
		const pageOf = (n: number) => Array.from({ length: n }, (_, i) => entry({ id: `au_${i}` }));
		const { page, gateway } = await trail((query) => ({
			items: query['pageSize'] === 200 ? pageOf(query['page'] === 3 ? 50 : 200) : ENTRIES,
			total: 450,
		}));
		page.set('module', 'stock');
		const source = await page.exportSource();
		expect(source.rows).toHaveLength(450);
		const reads = gateway.list.mock.calls.map(([q]) => q).filter((q) => q['pageSize'] === 200);
		expect(reads).toEqual([1, 2, 3].map((n) => ({ page: n, pageSize: 200, audience: 'admin', module: 'stock' })));
	});

	it('stops the export at a page that comes back empty, though the total says there are more', async () => {
		const { page, gateway } = await trail((query) => ({
			items:
				query['pageSize'] === 200
					? query['page'] === 1
						? Array.from({ length: 200 }, (_, i) => entry({ id: `au_${i}` }))
						: []
					: ENTRIES,
			total: 1_000,
		}));
		const source = await page.exportSource();
		expect(source.rows).toHaveLength(200);
		expect(gateway.list.mock.calls.map(([q]) => q).filter((q) => q['pageSize'] === 200)).toHaveLength(2);
	});
});
