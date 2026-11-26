import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { DocumentFormatService } from '@data-access/services/document-format.service';
import { NotificationService } from '@data-access/services/notification.service';

import { DocumentFormatsSettings } from './document-formats';
import { FormatBuilder } from './format-builder/format-builder';

import type { DocumentBlock, DocumentFormat, DocumentSpec } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	list: undefined as unknown,
	pending: false,
	queryFns: [] as Array<() => unknown>,
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	return {
		...actual,
		injectQuery: (options: () => { queryFn: () => unknown }) => {
			h.queryFns.push(() => options().queryFn());
			return { data: () => h.list, isPending: () => h.pending };
		},
	};
});

const block = (
	type: DocumentBlock['type'],
	fields: string[] = [],
	extra: Partial<DocumentBlock> = {},
): DocumentBlock => ({
	id: type,
	type,
	hidden: false,
	fields,
	heading: '',
	text: '',
	sizes: {},
	...extra,
});
const format = (id: string, extra: Partial<DocumentFormat> = {}): DocumentFormat => ({
	id,
	doc: 'packingSlip',
	name: id,
	about: '',
	paper: 'a4',
	blocks: [block('facts', ['parcelNo', 'orderNo']), block('table', ['item', 'qty']), block('signature')],
	active: false,
	seeded: false,
	version: 1,
	updatedAt: null,
	updatedBy: null,
	...extra,
});
const spec: DocumentSpec = {
	doc: 'packingSlip',
	group: 'parcels',
	gst: false,
	tree: true,
	blocks: [
		{ type: 'brand', fields: ['logo', 'seller'], lockedFields: [], required: false },
		{ type: 'facts', fields: ['parcelNo', 'orderNo', 'date'], lockedFields: [], required: true },
		{ type: 'table', fields: ['check', 'item', 'qty'], lockedFields: ['item', 'qty'], required: true },
		{ type: 'signature', fields: [], lockedFields: [], required: false },
		{ type: 'text', fields: [], lockedFields: [], required: false },
	],
} as DocumentSpec;
const VIEW = {
	groups: [
		{ group: 'orders', documents: [{ doc: 'taxInvoice', spec: { ...spec, doc: 'taxInvoice', blocks: [] } }] },
		{ group: 'parcels', documents: [{ doc: 'packingSlip', spec }] },
	],
};
const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function setUp(service: Record<string, unknown> = {}, id = 'mine') {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const router = { navigate: vi.fn(async () => true) };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	let answer: unknown = null;
	const modal = {
		open: vi.fn(() => {
			const result = Promise.resolve(answer);
			return { result };
		}),
	};
	const fullService = {
		list: vi.fn(() => of(VIEW)),
		one: vi.fn(() => of(format('mine'))),
		switchOn: vi.fn(() => of({ active: format('a'), switchedOff: null })),
		switchOff: vi.fn(() => of({})),
		duplicate: vi.fn(() => of(format('copy'))),
		pdf: vi.fn(() => of(new Blob(['%PDF']))),
		create: vi.fn(() => of(format('made'))),
		preview: vi.fn(() => of('<p>page</p>')),
		draftPdf: vi.fn(() => of(new Blob(['%PDF']))),
		save: vi.fn(() => of(format('mine', { version: 2, name: 'Mine' }))),
		...service,
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: DocumentFormatService, useValue: fullService },
			{ provide: QueryClient, useValue: queryClient },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modal },
			{ provide: NgbActiveModal, useValue: { close: vi.fn() } },
			{ provide: Router, useValue: router },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: AuthStore, useValue: { permissions: () => ['setting.edit'] } },
			{ provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (html: string) => html } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: new BehaviorSubject(convertToParamMap(id ? { id } : {})) },
			},
		],
	});
	return { service: fullService, notifier, router, queryClient, modal, answer: (value: unknown) => (answer = value) };
}

const urls = URL as unknown as Record<string, unknown>;
beforeEach(() => {
	vi.useFakeTimers();
	urls['createObjectURL'] = vi.fn(() => 'blob:1');
	urls['revokeObjectURL'] = vi.fn();
	h.list = VIEW;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete urls['createObjectURL'];
	delete urls['revokeObjectURL'];
});

describe('Settings › Document formats: the last cases', () => {
	it('a closed new-layout popup makes nothing', async () => {
		const made = setUp();
		made.modal.open.mockImplementation(() => {
			const result = Promise.reject(new Error('closed'));
			return { result };
		});
		TestBed.overrideComponent(DocumentFormatsSettings, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(DocumentFormatsSettings).componentInstance;
		await page.makeNew();
		expect(made.service.create).not.toHaveBeenCalled();
	});

	it('the builder: a block added before the document’s rules are known goes last, and a printed PDF is let go after a minute', async () => {
		h.list = undefined;
		const made = setUp();
		TestBed.overrideComponent(FormatBuilder, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FormatBuilder);
		fixture.detectChanges();
		for (let i = 0; i < 6; i++) await Promise.resolve();
		const page = fixture.componentInstance;
		expect(page.spec()).toBeNull();
		page.addBlock(spec.blocks[0] as never);
		expect(page.blocks().at(-1)?.type).toBe('brand');
		vi.spyOn(window, 'open').mockReturnValue(null);
		await page.previewPdf();
		expect(urls['revokeObjectURL']).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(urls['revokeObjectURL']).toHaveBeenCalledWith('blob:1');
		expect(made.notifier.showError).not.toHaveBeenCalled();
	});
});
