import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { DocumentFormatService } from '@data-access/services/document-format.service';
import { NotificationService } from '@data-access/services/notification.service';

import { DocumentFormatsSettings } from './document-formats';
import { FormatBuilder } from './format-builder/format-builder';

import type { DocumentBlock, DocumentFormat, DocumentSpec } from '@saha-textile/contracts';

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
	blocks: [block('facts', ['parcelNo', 'orderNo']), block('table', ['item', 'qty'])],
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
	tree: false,
	blocks: [
		{ type: 'brand', fields: ['logo', 'seller'], lockedFields: [], required: false },
		{ type: 'facts', fields: ['parcelNo', 'orderNo', 'date'], lockedFields: [], required: true },
		{
			type: 'table',
			fields: ['check', 'index', 'item', 'qty', 'cameWith'],
			lockedFields: ['item', 'qty'],
			required: true,
		},
		{ type: 'text', fields: [], lockedFields: [], required: false },
	],
};
const view = {
	groups: [{ group: 'parcels', documents: [{ doc: 'packingSlip', numberExample: null, spec, formats: [] }] }],
};
const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`;

function setUp(
	service: Record<string, unknown>,
	client: unknown = { invalidateQueries: vi.fn(async () => undefined) },
) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: DocumentFormatService, useValue: { list: () => of(view), ...service } },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: Router, useValue: { navigate: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: AuthStore, useValue: { permissions: signal(['setting.index', 'setting.edit']) } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'mine' })) },
			},
		],
	});
}

describe('Settings › Document formats (bundle builder brief F01–F03)', () => {
	it('switching one on says which went off; switching the active one off shows why it stays', async () => {
		setUp({
			switchOn: () => of({ active: format('compact', { active: true }), switchedOff: format('standard') }),
			switchOff: () =>
				throwError(
					() => new HttpErrorResponse({ status: 409, error: { code: 'document_format_only_format' } }),
				),
		});
		TestBed.overrideComponent(DocumentFormatsSettings, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(DocumentFormatsSettings).componentInstance;
		const input = { checked: true } as HTMLInputElement;
		await page.toggle(format('compact'), { target: input } as unknown as Event);
		expect(input.checked).toBe(false);
		expect(page.note()).toMatchObject({
			kind: 'success',
			key: 'docf_switched',
			params: { on: 'compact', off: 'standard' },
		});
		await page.toggle(format('standard', { active: true }), { target: input } as unknown as Event);
		expect(page.note()).toMatchObject({ kind: 'warning', key: 'docf_only_format', doc: 'packingSlip' });
	});
});

describe('the format builder (bundle builder brief F05)', () => {
	async function builder(service: Record<string, unknown> = {}) {
		setUp(
			{
				one: () => of(format('mine')),
				preview: () => of('<p>page</p>'),
				save: (id: string, body: { version: number }) => of(format(id, { version: body.version + 1 })),
				...service,
			},
			new QueryClient(),
		);
		TestBed.overrideComponent(FormatBuilder, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FormatBuilder);
		fixture.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		return fixture.componentInstance;
	}

	it('offers the document’s missing blocks, keeps the law’s fields, and puts fields back in the document’s order', async () => {
		const b = await builder();
		expect(b.format()?.id).toBe('mine');
		expect(b.missing().map((row) => row.type)).toEqual(['brand']);
		b.selectedId.set('table');
		expect(b.locked('item')).toBe(true);
		b.toggleField('item', false);
		expect(b.selected()?.fields).toEqual(['item', 'qty']);
		b.toggleField('check', true);
		b.toggleField('cameWith', true);
		expect(b.selected()?.fields).toEqual(['check', 'item', 'qty', 'cameWith']);
		expect(b.dirty()).toBe(true);
		expect(b.required(b.selected()!)).toBe(true);
	});

	it('adds and removes text blocks, adds a missing block in its place, and saves with the version it opened', async () => {
		const saved: Array<{ version: number; blocks: DocumentBlock[] }> = [];
		const b = await builder({
			save: (id: string, body: { version: number; blocks: DocumentBlock[] }) => (
				saved.push(body),
				of(format(id, { version: body.version + 1 }))
			),
		});
		b.addText();
		b.addText();
		expect(b.blocks().map((row) => row.id)).toEqual(['facts', 'table', 'text-2', 'text-3']);
		b.removeText(b.blocks()[2]!, new Event('click'));
		b.addBlock(spec.blocks[0]!);
		expect(b.blocks().map((row) => row.id)).toEqual(['brand', 'facts', 'table', 'text-3']);
		await b.save();
		expect(saved[0]?.version).toBe(1);
		expect(b.version()).toBe(2);
		expect(b.dirty()).toBe(false);
	});
});
