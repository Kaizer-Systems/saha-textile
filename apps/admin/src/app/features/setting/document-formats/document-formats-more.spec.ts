import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { DocumentFormatService } from '@data-access/services/document-format.service';
import { NotificationService } from '@data-access/services/notification.service';

import { DocumentFormatsSettings } from './document-formats';
import { FormatBuilder } from './format-builder/format-builder';
import { MakeLayoutPopup } from './make-layout-popup';

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

describe('Settings › Document formats list (F01–F04)', () => {
	function list(service: Record<string, unknown> = {}) {
		const made = setUp(service);
		TestBed.overrideComponent(DocumentFormatsSettings, { set: { imports: [], template: '' } });
		return { ...made, page: TestBed.createComponent(DocumentFormatsSettings).componentInstance };
	}
	const switchEvent = () => ({ target: { checked: true } }) as unknown as Event;

	it('reads the groups, and switches formats on and off', async () => {
		const { page, service, notifier } = list();
		expect(page.groups()).toHaveLength(2);
		expect(page.loading()).toBe(false);
		expect(page.canEdit()).toBe(true);
		await h.queryFns.at(-1)?.();
		await page.toggle(format('a'), switchEvent());
		expect(page.note()).toMatchObject({ kind: 'success', key: 'docf_switched_alone' });
		await page.toggle(format('a', { active: true }), switchEvent());
		expect(service.switchOff).toHaveBeenCalled();
		service.switchOff.mockReturnValueOnce(
			throwError(() => ({ error: { code: 'document_format_switch_another' } })),
		);
		await page.toggle(format('a', { active: true }), switchEvent());
		expect(page.note()).toMatchObject({ kind: 'warning', key: 'docf_switch_another' });
		service.switchOff.mockReturnValueOnce(throwError(() => ({})));
		await page.toggle(format('a', { active: true }), switchEvent());
		expect(page.note()).toMatchObject({ key: 'docf_only_format' });
		service.switchOn.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.toggle(format('a'), switchEvent());
		expect(notifier.showError).toHaveBeenCalledWith('docf_switch_failed');
		page.busy.set('x');
		await page.toggle(format('a'), switchEvent());
		expect(service.switchOn).toHaveBeenCalledTimes(2);
		h.list = undefined;
		h.pending = true;
		const empty = list();
		expect(empty.page.groups()).toEqual([]);
		expect(empty.page.loading()).toBe(true);
		h.pending = false;
	});

	it('copies a format, opens or saves its PDF, and makes a new layout', async () => {
		const { page, service, notifier, router, answer } = list();
		await page.duplicate(format('a'));
		expect(notifier.showSuccess).toHaveBeenCalledWith('docf_copied(copy)');
		service.duplicate.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.duplicate(format('a'));
		expect(notifier.showError).toHaveBeenCalledWith('docf_copy_failed');
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await page.pdf(format('a'), false);
		expect(open).toHaveBeenCalledWith('blob:1', '_blank', 'noopener');
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		await page.pdf(format('a'), true);
		expect(click).toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		service.pdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.pdf(format('a'), false);
		expect(notifier.showError).toHaveBeenCalledWith('docf_pdf_failed');
		expect(page.busy()).toBeNull();
		await page.makeNew();
		expect(service.create).not.toHaveBeenCalled();
		answer({ doc: 'taxInvoice', from: 'blank', name: 'Mine' });
		await page.makeNew();
		expect(router.navigate).toHaveBeenCalledWith(['/setting/document-formats', 'made']);
		service.create.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.makeNew();
		expect(notifier.showError).toHaveBeenCalledWith('docf_make_failed');
	});

	it('offers a named new layout in its popup', () => {
		setUp();
		TestBed.overrideComponent(MakeLayoutPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(MakeLayoutPopup).componentInstance;
		expect(popup.name()).toBe('docf_new_layout');
		expect(popup.ready()).toBe(true);
		popup.name.set('  ');
		expect(popup.ready()).toBe(false);
	});
});

describe('Settings › a document format’s builder (F05)', () => {
	async function builder(service: Record<string, unknown> = {}, id = 'mine') {
		const made = setUp(service, id);
		TestBed.overrideComponent(FormatBuilder, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FormatBuilder);
		fixture.detectChanges();
		for (let i = 0; i < 6; i++) await Promise.resolve();
		return { ...made, fixture, page: fixture.componentInstance };
	}

	it('loads the format, draws the page, and reads its document’s rules', async () => {
		const { page, service } = await builder();
		expect(page.name()).toBe('mine');
		expect(page.treeDoc()).toBe(true);
		expect(page.missing().map((row) => row.type)).toEqual(['brand']);
		await vi.advanceTimersByTimeAsync(1);
		expect(service.preview).toHaveBeenCalled();
		expect(page.preview()).toBe('<p>page</p>');
		const signature = page.blocks().find((row) => row.type === 'signature') as DocumentBlock;
		expect(page.label(signature)).toBe('docf_block_signature');
		expect(page.label(block('text', [], { heading: 'Care' }))).toBe('docf_block_text(Care)');
		expect(page.label(block('text'))).toBe('docf_block_text(docf_text_untitled)');
		expect(page.required(page.blocks()[0] as DocumentBlock)).toBe(true);
		expect(page.specOf(null)).toBeNull();
		expect(page.specOf(block('page_number' as never))).toBeNull();
		await h.queryFns.at(-1)?.();
	});

	it('says when the format is gone, and draws nothing without one', async () => {
		const gone = await builder({ one: () => throwError(() => new Error('gone')) });
		expect(gone.notifier.showError).toHaveBeenCalledWith('docf_not_found');
		await gone.page.previewPdf();
		await gone.page.save();
		gone.page.setPaper('a5');
		await vi.advanceTimersByTimeAsync(400);
		expect(gone.service.preview).not.toHaveBeenCalled();
		expect(gone.service.save).not.toHaveBeenCalled();
		const blank = await builder({}, '');
		expect(blank.service.one).not.toHaveBeenCalled();
		h.list = undefined;
		const unlisted = await builder();
		expect(unlisted.page.spec()).toBeNull();
		expect(unlisted.page.treeDoc()).toBe(false);
		expect(unlisted.page.missing()).toEqual([]);
	});

	it('moves, hides and edits blocks, and sets fields, sizes and words', async () => {
		const { page } = await builder();
		page.drop({ previousIndex: 0, currentIndex: 1 } as never);
		expect(page.blocks()[0]?.type).toBe('table');
		const stop = { stopPropagation: vi.fn() } as unknown as Event;
		page.toggleHidden(page.blocks()[0] as DocumentBlock, stop);
		expect(page.blocks()[0]?.hidden).toBe(false);
		const signature = page.blocks().find((row) => row.type === 'signature') as DocumentBlock;
		page.toggleHidden(signature, stop);
		expect(page.blocks().find((row) => row.type === 'signature')?.hidden).toBe(true);
		page.toggleField('date', true);
		page.setSize('heading', '12');
		page.setText('heading', 'x');
		page.selectedId.set('facts');
		expect(page.locked('parcelNo')).toBe(false);
		page.toggleField('date', true);
		expect(page.selected()?.fields).toEqual(['parcelNo', 'orderNo', 'date']);
		page.toggleField('parcelNo', false);
		expect(page.selected()?.fields).toEqual(['orderNo', 'date']);
		page.selectedId.set('table');
		expect(page.locked('item')).toBe(true);
		page.toggleField('item', false);
		expect(page.selected()?.fields).toEqual(['item', 'qty']);
		page.setSize('piece', '9');
		page.setSize('free', 'abc');
		expect(page.selected()?.sizes).toEqual({ piece: 9, free: undefined });
		page.setText('text', 'Fragile');
		page.setText('text', 'Fragile');
		expect(page.selected()?.text).toBe('Fragile');
		page.selectedId.set('gone');
		page.toggleField('x', true);
	});

	it('adds and removes text blocks, adds a missing block in its place, and changes the name, note and paper', async () => {
		const { page } = await builder();
		page.addText();
		expect(page.blocks().map((row) => row.id)).toEqual(['facts', 'table', 'text-2', 'signature']);
		page.addText();
		expect(page.selectedId()).toBe('text-3');
		const stop = { stopPropagation: vi.fn() } as unknown as Event;
		page.removeText(page.blocks()[0] as DocumentBlock, stop);
		expect(page.blocks()).toHaveLength(5);
		page.removeText(page.blocks().find((row) => row.id === 'text-2') as DocumentBlock, stop);
		page.removeText(page.blocks().find((row) => row.id === 'text-3') as DocumentBlock, stop);
		expect(page.selectedId()).toBeNull();
		page.addBlock(spec.blocks[0] as never);
		expect(page.blocks()[0]?.type).toBe('brand');
		page.blocks.set(page.blocks().filter((row) => row.type !== 'signature'));
		page.addText();
		expect(page.blocks().at(-1)?.type).toBe('text');
		page.blocks.set([block('brand')]);
		page.addBlock(spec.blocks[2] as never);
		expect(page.blocks().map((row) => row.type)).toEqual(['brand', 'table']);
		expect(page.blocks()[1]?.fields).toEqual(['item', 'qty']);
		h.list = undefined;
		page.blocks.set([]);
		page.addBlock(spec.blocks[1] as never);
		expect(page.blocks()[0]?.fields).toEqual(['parcelNo', 'orderNo', 'date']);
		page.setName('mine');
		page.setName('Ours');
		page.setAbout('');
		page.setAbout('For parcels');
		page.setPaper('a4');
		page.setPaper('roll80');
		expect(page.dirty()).toBe(true);
	});

	it('shows why the page could not be drawn, prints the unsaved layout, and saves', async () => {
		const problems = {
			error: {
				code: 'document_format_changed',
				problems: [
					{ code: 'missing', field: 'qty' },
					{ code: 'empty', field: null },
				],
			},
		};
		const { page, service, notifier, queryClient } = await builder();
		service.preview.mockReturnValueOnce(throwError(() => problems));
		page.setPaper('a5');
		await vi.advanceTimersByTimeAsync(400);
		expect(page.previewError()).toBe(true);
		expect(page.problems()).toEqual(['docf_problem_missing(docf_field_qty)', 'docf_problem_empty()']);
		service.preview.mockReturnValueOnce(throwError(() => new Error('down')));
		page.setPaper('a4');
		await vi.advanceTimersByTimeAsync(400);
		expect(page.problems()).toEqual([]);
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await page.previewPdf();
		expect(open).toHaveBeenCalled();
		service.draftPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.previewPdf();
		expect(notifier.showError).toHaveBeenCalledWith('docf_pdf_failed');
		page.setName('  Mine  ');
		await page.save();
		expect(service.save).toHaveBeenCalledWith('mine', expect.objectContaining({ name: 'Mine', version: 1 }));
		expect(page.version()).toBe(2);
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('docf_saved_note(Mine)');
		service.save.mockReturnValueOnce(throwError(() => problems));
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('docf_changed');
		service.save.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('docf_save_failed');
		page.saving.set(true);
		await page.save();
		expect(service.save).toHaveBeenCalledTimes(3);
	});
});
