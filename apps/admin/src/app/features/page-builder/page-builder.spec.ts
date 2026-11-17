import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { AuthStore } from '@core/state/auth.store';
import { type AdminBuilderPage, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { PageBuilderHome, STATUS_CLASS } from './page-builder-home';
import { LATER_PAGES, PageBuilderPages } from './page-builder-pages';
import { PbNewLayout } from './pb-new-layout';
import { PbPageSettings, refusedSettings, searchCut } from './pb-page-settings';
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
	reviewRequest: null,
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
	templates: [],
	settings: { title: {}, description: {}, heading: {}, headingShown: false, shareImage: null },
	settingsGaps: { bn: ['title', 'description', 'heading'] },
	shareImageUrl: null,
	builderOn: true,
	safeMode: null,
	putBack: null,
	waiting: [],
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
			{ provide: PageBuilderGateway, useValue: { sales: () => of({ rows: [] }), ...gateway } },
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
			{
				provide: AuthStore,
				useValue: { permissions: () => ['theme_option.index', 'page_builder.go_live', 'dashboard.revenue'] },
			},
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
		const coming = {
			pageType: 'home' as const,
			target: 'page',
			layoutId: 'lay_winter',
			layoutName: 'Winter weddings',
			from: '2099-12-01T00:00:00.000Z',
			until: null,
			state: 'coming' as const,
		};
		const { page: list } = setup(PageBuilderPages, {
			pages: vi.fn(() => of(rows)),
			comingUp: vi.fn(() => of({ rows: [coming] })),
		});
		expect(list.pages()).toEqual(rows);
		// SG-17: every scheduled switch, across every page.
		expect(list.comingUp()).toEqual([coming]);
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
		// P3: what each language still lacks in Page settings, named in its own script.
		expect(home.settingsTodo()).toEqual([{ locale: 'bn', language: 'বাংলা', count: 3 }]);
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
			template: null,
			bringPictures: true,
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
			template: null,
			bringPictures: true,
		});
		popup.choose({ copyOf: 'lay_today' });
		await popup.create();
		expect(createLayout).toHaveBeenLastCalledWith('home', {
			name: 'Winter weddings',
			start: 'copy',
			copyOf: 'lay_today',
			template: null,
			bringPictures: true,
		});
		popup.choose({ template: 'main_side_tile' });
		popup.bringPictures.set(false);
		await popup.create();
		expect(createLayout).toHaveBeenLastCalledWith('home', {
			name: 'Winter weddings',
			start: 'template',
			copyOf: null,
			template: 'main_side_tile',
			bringPictures: false,
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

describe('Page settings (P3, SG-6, SG-7)', () => {
	const render = (gateway: Partial<PageBuilderGateway>) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PageBuilderGateway, useValue: gateway },
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ type: 'home' }) } } },
			],
		});
		TestBed.overrideComponent(PbPageSettings, { set: { imports: [], template: '' } });
		return TestBed.createComponent(PbPageSettings).componentInstance;
	};
	const saved = {
		...page,
		settings: {
			title: { en: 'Handloom and Silk Sarees from Kolkata | Saha Textile', bn: 'কলকাতার তাঁত ও সিল্ক শাড়ি' },
			description: { en: 'Sarees woven by hand in Bengal.', bn: 'বাংলার হাতে বোনা শাড়ি।' },
			heading: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
			headingShown: false,
			shareImage: { assetId: 'med_share', versionId: 'link_preview.blur' },
		},
		settingsGaps: {},
		shareImageUrl: 'https://cdn/share.jpg',
	};

	it('loads each language, shows the search result as it would read, and switches language', async () => {
		const settings = render({ page: vi.fn(() => of(saved)) });
		await vi.waitFor(() => expect(settings.page()).not.toBeNull());
		expect(settings.form.value.title).toBe(saved.settings.title.en);
		expect(settings.preview().title).toEqual({ text: saved.settings.title.en, cut: false });
		expect(settings.shareImageTile()).toMatchObject({ id: 'med_share', versionId: 'link_preview.blur' });
		settings.switchLanguage('bn');
		expect(settings.preview()).toMatchObject({
			address: 'sahatextile.com › bn',
			title: { text: 'কলকাতার তাঁত ও সিল্ক শাড়ি' },
		});
	});

	it('saves every language at once with the share picture; a refusal lists each missing language and field', async () => {
		const refusal = {
			error: { error: { issues: [{ code: 'page_settings_incomplete', path: ['heading', 'bn'], message: 'x' }] } },
		};
		const saveSettings = vi.fn(() => throwError(() => refusal));
		const settings = render({ page: vi.fn(() => of(saved)), saveSettings });
		await vi.waitFor(() => expect(settings.page()).not.toBeNull());
		settings.selectShareImage({ id: 'med_new', versionId: 'link_preview.as_is' } as never);
		await settings.submit();
		expect(saveSettings).toHaveBeenCalledWith(
			'home',
			expect.objectContaining({
				title: saved.settings.title,
				headingShown: false,
				shareImage: { assetId: 'med_new', versionId: 'link_preview.as_is' },
			}),
		);
		expect(settings.refused()).toEqual([{ locale: 'bn', field: 'heading' }]);
		expect(settings.gapLabel({ locale: 'bn', field: 'heading' })).toBe('বাংলা: pb_settings_heading');
		expect(refusedSettings(new Error('down'))).toEqual([]);
	});

	it('cuts a long title at a word with "…", as a search result does', () => {
		expect(searchCut('Short', 60)).toEqual({ text: 'Short', cut: false });
		const long = searchCut('Handloom and silk sarees from Kolkata, woven by hand in Bengal since 1952', 60);
		expect(long.cut).toBe(true);
		expect(long.text.endsWith('…')).toBe(true);
		expect(long.text.length).toBeLessThanOrEqual(60);
	});
});

describe('Page Builder › Home schedule actions (A1, E5, SG-15)', () => {
	it('lists a Go Live waiting for pictures, and offers to cancel only switches still to come', () => {
		const waiting = {
			...page,
			waiting: [
				{ layoutId: 'lay_new', layoutName: 'New hero', from: null, requestedAt: '2026-11-17T10:00:00.000Z' },
			],
		};
		const { page: home } = setup(PageBuilderHome, { page: vi.fn(() => of(waiting)) });
		expect(home.canGoLive()).toBe(true);
		const rows = home.when();
		expect(rows.map((row) => [row.name, row.status])).toContainEqual(['New hero', 'waiting']);
		expect(rows.find((row) => row.status === 'live')?.cancel).toBeNull();
		expect(rows.find((row) => row.name === 'Winter weddings')?.cancel).toEqual({
			revisionId: 'rev_winter',
			from: '2099-12-01T00:00:00.000Z',
		});
		expect(rows.find((row) => row.back)?.cancel).toBeNull();
		expect(rows.find((row) => row.status === 'waiting')?.waitingLayoutId).toBe('lay_new');
	});

	it('cancels, puts back and switches safe mode through the API once confirmed, and says so', async () => {
		const after = { ...page, safeMode: { by: 'adm_1', byName: 'Moulik', at: '2026-11-17T10:00:00.000Z' } };
		const gateway = {
			page: vi.fn(() => of(page)),
			cancelSwitch: vi.fn(() => of(page)),
			putBack: vi.fn(() => of(page)),
			safeMode: vi.fn(() => of(after)),
			cancelWaiting: vi.fn(() => throwError(() => ({ status: 403 }))),
		};
		const { page: home, toastr } = setup(PageBuilderHome, gateway);
		await home.confirmed({ actionToPerform: 'cancel_switch', data: { revisionId: 'rev_winter', from: 'x' } });
		expect(gateway.cancelSwitch).toHaveBeenCalledWith('home', { revisionId: 'rev_winter', from: 'x' });
		await home.confirmed({ actionToPerform: 'safe_on' });
		expect(gateway.safeMode).toHaveBeenCalledWith('home', true);
		expect(home.page()?.safeMode?.byName).toBe('Moulik');
		expect(toastr.success).toHaveBeenCalledWith('pb_done_safe_on');
		await home.confirmed({ actionToPerform: 'cancel_waiting', data: 'lay_new' });
		expect(toastr.error).toHaveBeenCalled();
		await home.confirmed({ actionToPerform: 'something_else' });
		expect(gateway.putBack).not.toHaveBeenCalled();
	});
});

describe('Page Builder › Home export, import and sales (SG-22, SG-23)', () => {
	const salesRow = {
		layoutId: 'lay_today',
		layoutName: 'Today’s home page',
		from: '2026-11-01T00:00:00.000Z',
		until: null,
		orders: 3,
		totalINR: 7500,
	};

	it('loads the sales by schedule for those who may see revenue', () => {
		const { page: home } = setup(PageBuilderHome, {
			page: vi.fn(() => of(page)),
			sales: vi.fn(() => of({ rows: [salesRow] })),
		});
		expect(home.canSeeSales()).toBe(true);
		expect(home.sales()).toEqual([salesRow]);
	});

	it('imports a layout file and reloads; a broken file is refused with a message', async () => {
		const gateway = {
			page: vi.fn(() => of(page)),
			sales: vi.fn(() => of({ rows: [] })),
			importLayout: vi.fn(() => of({})),
		};
		const { page: home, toastr } = setup(PageBuilderHome, gateway as unknown as Partial<PageBuilderGateway>);
		const file = { format: 'saha-textile.page-layout', version: 1, pageType: 'home', name: 'X', sections: [] };
		const input = (text: string) =>
			({ files: [{ text: async () => text }], value: 'x' }) as unknown as HTMLInputElement;
		await home.importLayout(input(JSON.stringify(file)));
		expect(gateway.importLayout).toHaveBeenCalledWith('home', file);
		expect(toastr.success).toHaveBeenCalledWith('pb_imported');
		await home.importLayout(input('not json'));
		expect(toastr.error).toHaveBeenCalledWith('pb_import_refused');
	});
});
