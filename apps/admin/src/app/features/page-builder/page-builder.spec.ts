import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { type AdminBuilderPage, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PageBuilderHome, STATUS_CLASS } from './page-builder-home';
import { LATER_PAGES, PageBuilderPages } from './page-builder-pages';
import { PbNewLayout } from './pb-new-layout';
import { PbThumb } from './pb-thumb';

const layout = (id: string, name: string) => ({
	id,
	pageType: 'home' as const,
	target: 'page',
	name,
	template: null,
	draftRevisionId: null,
	lastLiveRevisionId: null,
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z',
	updatedBy: null,
});

const page: AdminBuilderPage = {
	pageType: 'home',
	target: 'page',
	liveRevisionId: 'rev_today',
	nextSwitchAt: '2099-12-01T00:00:00.000Z',
	schedule: [
		{ revisionId: 'rev_today', layoutId: 'lay_today', from: '2026-11-01T00:00:00.000Z', until: null, by: null },
		{
			revisionId: 'rev_winter',
			layoutId: 'lay_winter',
			from: '2099-12-01T00:00:00.000Z',
			until: '2100-02-15T00:00:00.000Z',
			by: null,
		},
	],
	layouts: [
		{
			layout: layout('lay_today', 'Today’s home page'),
			status: 'live',
			from: null,
			until: null,
			updatedByName: null,
			outline: [],
		},
		{
			layout: layout('lay_winter', 'Winter weddings'),
			status: 'scheduled',
			from: null,
			until: null,
			updatedByName: null,
			outline: [],
		},
	],
};

const setup = <T>(component: new (...args: never[]) => T, gateway: Partial<PageBuilderGateway>) => {
	TestBed.resetTestingModule();
	const toastr = { success: vi.fn(), error: vi.fn() };
	const modals = { open: vi.fn() };
	TestBed.configureTestingModule({
		providers: [
			{ provide: PageBuilderGateway, useValue: gateway },
			{ provide: ToastrService, useValue: toastr },
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: { name?: string }) =>
						params?.name ? `${key}:${params.name}` : key,
				},
			},
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ type: 'home' }) } } },
		],
	});
	TestBed.overrideComponent(component as never, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { page: fixture.componentInstance, toastr, modals };
};

describe('Page Builder list (P1)', () => {
	it('lists the registered pages from the API, and the ten pages that join later', () => {
		const rows = [
			{
				pageType: 'home' as const,
				kind: 'whole_page' as const,
				target: 'page',
				liveLayoutName: 'Today',
				nextSwitchAt: null,
				layoutCount: 2,
			},
		];
		const { page: list } = setup(PageBuilderPages, { pages: vi.fn(() => of(rows)) });
		expect(list.pages()).toEqual(rows);
		expect(LATER_PAGES).toHaveLength(10);
	});
});

describe('Page Builder › Home (A1)', () => {
	it('lists what shoppers see now, the switch to come and the hand-back', () => {
		const { page: home } = setup(PageBuilderHome, { page: vi.fn(() => of(page)) });
		expect(home.when().map((row) => [row.name, row.status, row.back])).toEqual([
			['Today’s home page', 'live', false],
			['Winter weddings', 'scheduled', false],
			['Today’s home page', 'scheduled', true],
		]);
		expect(STATUS_CLASS.ended).toBe('fm-chip muted');
	});

	it('duplicates a layout as a copy named for it, and reloads', async () => {
		const createLayout = vi.fn(() => of({}));
		const load = vi.fn(() => of(page));
		const { page: home, toastr } = setup(PageBuilderHome, { page: load, createLayout } as never);
		await home.duplicate(page.layouts[1] as never);
		expect(createLayout).toHaveBeenCalledWith('home', {
			name: 'pb_copy_name:Winter weddings',
			start: 'copy',
			copyOf: 'lay_winter',
		});
		expect(toastr.success).toHaveBeenCalledWith('pb_layout_created');
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe('New layout (A2)', () => {
	it('creates a blank layout, or a copy of the one chosen', async () => {
		TestBed.resetTestingModule();
		const createLayout = vi.fn(() => of({ layout: layout('lay_new', 'New') }));
		const close = vi.fn();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PageBuilderGateway, useValue: { createLayout } },
				{ provide: ToastrService, useValue: { success: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{
					provide: (await import('@ng-bootstrap/ng-bootstrap')).NgbActiveModal,
					useValue: { close, dismiss: vi.fn() },
				},
			],
		});
		TestBed.overrideComponent(PbNewLayout, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(PbNewLayout).componentInstance;
		popup.start('home', page.layouts);
		await popup.create();
		expect(createLayout).not.toHaveBeenCalled();
		popup.name.set(' Winter weddings ');
		await popup.create();
		expect(createLayout).toHaveBeenLastCalledWith('home', {
			name: 'Winter weddings',
			start: 'blank',
			copyOf: null,
		});
		popup.copyOf.set('lay_today');
		await popup.create();
		expect(createLayout).toHaveBeenLastCalledWith('home', {
			name: 'Winter weddings',
			start: 'copy',
			copyOf: 'lay_today',
		});
		expect(close).toHaveBeenCalled();
	});
});

describe('layout outline picture (A1)', () => {
	it('draws a box per section, the banner in its arrangement, and grows with the outline', () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(PbThumb);
		fixture.componentRef.setInput('outline', [
			{ type: 'banner_arrangement', arrangement: 'hero_center_sides' },
			{ type: 'product_row', arrangement: null },
		]);
		fixture.detectChanges();
		const thumb = fixture.componentInstance;
		expect(thumb.boxes().filter((box) => box.kind === 'hi')).toHaveLength(1);
		expect(thumb.boxes().filter((box) => box.kind === 'lo')).toHaveLength(2);
		expect(thumb.boxes().filter((box) => box.kind === 'crd')).toHaveLength(5);
		expect(thumb.height()).toBe(8 + 44 + 27 + 2);
		expect(fixture.nativeElement.querySelectorAll('rect').length).toBe(1 + thumb.boxes().length);
	});
});
