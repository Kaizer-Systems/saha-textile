import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { type AdminBuilderPage, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PageBuilderHome } from './page-builder-home';
import { PageBuilderPages } from './page-builder-pages';
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

const refusedWith = (message: string) => ({ error: { issues: [{ code: 'x', message }] } });

const setup = <T>(
	component: new (...args: never[]) => T,
	gateway: Partial<PageBuilderGateway>,
	options: { permissions?: string[]; params?: Record<string, string> } = {},
) => {
	TestBed.resetTestingModule();
	const toastr = { success: vi.fn(), error: vi.fn() };
	const modals = { open: vi.fn() };
	const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.configureTestingModule({
		providers: [
			{ provide: PageBuilderGateway, useValue: { sales: () => of({ rows: [] }), ...gateway } },
			{ provide: ToastrService, useValue: toastr },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifications },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: { name?: string }) =>
						params?.name ? `${key}:${params.name}` : key,
				},
			},
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.params ?? { type: 'home' }) } },
			},
			{
				provide: AuthStore,
				useValue: {
					permissions: () =>
						options.permissions ?? ['theme_option.index', 'page_builder.go_live', 'dashboard.revenue'],
				},
			},
		],
	});
	TestBed.overrideComponent(component as never, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { page: fixture.componentInstance, toastr, modals, notifications };
};

const urls = URL as unknown as Record<string, unknown>;
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	delete urls['createObjectURL'];
	delete urls['revokeObjectURL'];
});

describe('Page Builder › Home: the last cases', () => {
	it('reads the home page when the address names none, and shows nothing while it loads', () => {
		const { page: home } = setup(PageBuilderHome, { page: vi.fn(() => NEVER) }, { params: {} });
		expect(home.pageType).toBe('home');
		expect(home.settingsTodo()).toEqual([]);
		expect(home.when()).toEqual([]);
	});

	it('lists switches with no live entry, and blank names for layouts it no longer has', () => {
		const odd = {
			...page,
			liveRevisionId: 'rev_gone',
			layouts: [],
			settingsGaps: undefined,
		} as unknown as AdminBuilderPage;
		const noLive = setup(PageBuilderHome, { page: vi.fn(() => of(odd)) });
		expect(noLive.page.settingsTodo()).toEqual([]);
		expect(noLive.page.when()).toEqual([expect.objectContaining({ name: '', status: 'scheduled', back: false })]);
		const unnamed = { ...page, layouts: [] } as unknown as AdminBuilderPage;
		const blank = setup(PageBuilderHome, { page: vi.fn(() => of(unnamed)) });
		expect(blank.page.when().map((row) => row.name)).toEqual(['', '', '']);
	});

	it('says why the page or its sales could not load', () => {
		const told = setup(PageBuilderHome, {
			page: vi.fn(() => throwError(() => refusedWith('No such page'))),
			sales: vi.fn(() => throwError(() => new Error('down'))),
		});
		expect(told.toastr.error).toHaveBeenCalledWith('No such page');
		expect(told.page.sales()).toEqual([]);
		const plain = setup(PageBuilderHome, { page: vi.fn(() => throwError(() => new Error('down'))) });
		expect(plain.toastr.error).toHaveBeenCalledWith('pb_action_failed');
	});

	it('saves a layout as a file named for it, lets the link go after a second, and says when it cannot', async () => {
		vi.useFakeTimers();
		urls['createObjectURL'] = vi.fn(() => 'blob:layout');
		urls['revokeObjectURL'] = vi.fn();
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		const names: string[] = [];
		click.mockImplementation(function (this: HTMLAnchorElement) {
			names.push(this.download);
		});
		const exportLayout = vi.fn(() => of({ format: 'saha-textile.page-layout', sections: [] }));
		const { page: home, toastr } = setup(PageBuilderHome, { page: vi.fn(() => of(page)), exportLayout } as never);
		await home.exportLayout(page.layouts[1] as never);
		await home.exportLayout({ layout: { ...page.layouts[1]!.layout, name: '!!!' } } as never);
		expect(names).toEqual(['winter-weddings.layout.json', 'layout.layout.json']);
		vi.advanceTimersByTime(1_000);
		expect(urls['revokeObjectURL']).toHaveBeenCalledWith('blob:layout');
		exportLayout.mockReturnValueOnce(throwError(() => refusedWith('Too big')) as never);
		await home.exportLayout(page.layouts[1] as never);
		expect(toastr.error).toHaveBeenCalledWith('Too big');
		exportLayout.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await home.exportLayout(page.layouts[1] as never);
		expect(toastr.error).toHaveBeenLastCalledWith('pb_action_failed');
	});

	it('imports nothing when no file was chosen', async () => {
		const importLayout = vi.fn();
		const { page: home } = setup(PageBuilderHome, { page: vi.fn(() => of(page)), importLayout } as never);
		const input = { files: [], value: 'x' } as unknown as HTMLInputElement;
		await home.importLayout(input);
		expect(input.value).toBe('');
		expect(importLayout).not.toHaveBeenCalled();
	});

	it('asks through the confirmation popup, and puts back or ends safe mode once confirmed', async () => {
		const gateway = {
			page: vi.fn(() => of(page)),
			putBack: vi.fn(() => of(page)),
			safeMode: vi.fn(() => of(page)),
		};
		const { page: home, toastr } = setup(PageBuilderHome, gateway);
		home.ask('put_back');
		const openModal = vi.fn(async () => undefined);
		Object.defineProperty(home, 'confirm', { value: () => ({ openModal }) });
		home.ask('safe_off', { why: 'test' });
		expect(openModal).toHaveBeenCalledWith('safe_off', { why: 'test' });
		await home.confirmed({ actionToPerform: 'put_back' });
		await home.confirmed({ actionToPerform: 'safe_off' });
		expect(gateway.putBack).toHaveBeenCalledWith('home');
		expect(gateway.safeMode).toHaveBeenCalledWith('home', false);
		expect(toastr.success).toHaveBeenCalledWith('pb_done_safe_off');
	});

	it('opens New layout with the page’s layouts, or none before the page loads, and reloads only after one is made', async () => {
		const start = vi.fn();
		const load = vi.fn(() => NEVER);
		const waiting = setup(PageBuilderHome, { page: load });
		waiting.modals.open.mockReturnValue({
			componentInstance: { start },
			result: Promise.reject(new Error('closed')),
		});
		await waiting.page.newLayout();
		expect(start).toHaveBeenLastCalledWith('home', [], [], null);
		expect(load).toHaveBeenCalledTimes(1);
		const reload = vi.fn(() => of(page));
		const loaded = setup(PageBuilderHome, { page: reload });
		loaded.modals.open.mockReturnValue({
			componentInstance: { start },
			result: Promise.resolve({ id: 'lay_new' }),
		});
		await loaded.page.newLayout('main_side_tile');
		expect(start).toHaveBeenLastCalledWith('home', page.layouts, page.templates, 'main_side_tile');
		expect(reload).toHaveBeenCalledTimes(2);
	});

	it('says why a copy could not be made', async () => {
		const createLayout = vi.fn(() => throwError(() => refusedWith('Name taken')));
		const { page: home, toastr } = setup(PageBuilderHome, { page: vi.fn(() => of(page)), createLayout } as never);
		await home.duplicate(page.layouts[1] as never);
		expect(toastr.error).toHaveBeenCalledWith('Name taken');
		createLayout.mockReturnValueOnce(throwError(() => new Error('down')));
		await home.duplicate(page.layouts[1] as never);
		expect(toastr.error).toHaveBeenLastCalledWith('pb_action_failed');
	});
});

describe('Page Builder list and New layout: the last cases', () => {
	it('lists no pages and no switches when either list fails', () => {
		const { page: list } = setup(PageBuilderPages, {
			pages: vi.fn(() => throwError(() => new Error('down'))),
			comingUp: vi.fn(() => throwError(() => new Error('down'))),
		});
		expect(list.pages()).toEqual([]);
		expect(list.comingUp()).toEqual([]);
	});

	it('shows why a layout could not be made', async () => {
		const createLayout = vi.fn(() => throwError(() => refusedWith('Name taken')));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PageBuilderGateway, useValue: { createLayout } },
				{ provide: ToastrService, useValue: { success: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{
					provide: (await import('@ng-bootstrap/ng-bootstrap')).NgbActiveModal,
					useValue: { close: vi.fn(), dismiss: vi.fn() },
				},
			],
		});
		TestBed.overrideComponent(PbNewLayout, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(PbNewLayout).componentInstance;
		popup.start('home', page.layouts);
		popup.name.set('Winter');
		await popup.create();
		expect(popup.error()).toBe('Name taken');
		createLayout.mockReturnValueOnce(throwError(() => new Error('down')));
		await popup.create();
		expect(popup.error()).toBe('pb_action_failed');
		expect(popup.creating()).toBe(false);
	});

	it('draws each banner arrangement, promo banners and the newsletter', () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(PbThumb);
		fixture.componentRef.setInput('outline', [
			{ type: 'banner_arrangement', arrangement: 'hero_main_side' },
			{ type: 'banner_arrangement', arrangement: 'hero_main_stack' },
			{ type: 'banner_arrangement', arrangement: 'hero_full' },
			{ type: 'promo_banners', arrangement: null },
			{ type: 'newsletter', arrangement: null },
		]);
		fixture.detectChanges();
		const kinds = fixture.componentInstance.boxes().map((box) => box.kind);
		expect(kinds.filter((kind) => kind === 'hi')).toHaveLength(3);
		expect(kinds.filter((kind) => kind === 'lo')).toHaveLength(1 + 2 + 2);
		expect(kinds.filter((kind) => kind === 'bar')).toHaveLength(1);
		expect(fixture.componentInstance.height()).toBe(8 + 44 * 3 + 28 + 20 + 2);
	});
});

describe('Page settings: the last cases', () => {
	const saved = {
		...page,
		settings: {
			title: { en: 'Sarees', bn: 'শাড়ি' },
			description: { en: 'Woven by hand.', bn: 'হাতে বোনা।' },
			heading: { en: 'Sarees', bn: 'শাড়ি' },
			headingShown: true,
			shareImage: null,
		},
		settingsGaps: {},
		shareImageUrl: null,
	};

	it('cuts a long word-less title at the length itself', () => {
		const cut = searchCut('a'.repeat(80), 60);
		expect(cut).toEqual({ text: `${'a'.repeat(59)}…`, cut: true });
		expect(refusedSettings({ error: { error: { issues: [{ code: 'page_settings_incomplete' }] } } })).toEqual([
			{ field: '', locale: '' },
		]);
	});

	it('reads the home page when the address names none, and says why the page could not load', async () => {
		const told = setup(
			PbPageSettings,
			{ page: vi.fn(() => throwError(() => refusedWith('Gone'))) },
			{ params: {} },
		);
		expect(told.page.pageType).toBe('home');
		await vi.waitFor(() => expect(told.notifications.showError).toHaveBeenCalledWith('Gone'));
		const plain = setup(PbPageSettings, { page: vi.fn(() => throwError(() => new Error('down'))) });
		await vi.waitFor(() => expect(plain.notifications.showError).toHaveBeenCalledWith('pb_action_failed'));
	});

	it('follows an emptied field, has no share tile without a picture, and opens a missing field in its language', async () => {
		const { page: settings } = setup(PbPageSettings, { page: vi.fn(() => of(saved)) } as never);
		await vi.waitFor(() => expect(settings.page()).not.toBeNull());
		expect(settings.shareImageTile()).toBeNull();
		settings.form.controls.title.setValue(null);
		settings.form.controls.description.setValue(null);
		expect(settings.typed()).toEqual({ title: '', description: '' });
		settings.openLanguageGap({ key: 'title', locale: 'bn' });
		expect(settings.preview().address).toBe('sahatextile.com › bn');
		expect(settings.typed().title).toBe('শাড়ি');
		// The emptied English title was kept as empty when the language changed.
		settings.openGap({ locale: 'en', field: 'heading' });
		expect(settings.typed().title).toBe('');
		settings.selectShareImage(null as never);
		settings.selectShareImage({ id: 'med_1' } as never);
		expect(settings.shareImageTile()).toBeNull();
	});

	it('saves nothing before the page loads, saves once it has, and names a plain refusal', async () => {
		const saveSettings = vi.fn(() => of(saved));
		const waiting = setup(PbPageSettings, { page: vi.fn(() => NEVER), saveSettings } as never);
		await waiting.page.submit();
		expect(saveSettings).not.toHaveBeenCalled();
		const { page: settings, notifications } = setup(PbPageSettings, {
			page: vi.fn(() => of(saved)),
			saveSettings,
		} as never);
		await vi.waitFor(() => expect(settings.page()).not.toBeNull());
		await settings.submit();
		expect(notifications.showSuccess).toHaveBeenCalledWith('pb_settings_saved');
		saveSettings.mockReturnValueOnce(throwError(() => refusedWith('Too long')) as never);
		await settings.submit();
		expect(notifications.showError).toHaveBeenCalledWith('Too long');
		saveSettings.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await settings.submit();
		expect(notifications.showError).toHaveBeenLastCalledWith('pb_action_failed');
		expect(settings.saving()).toBe(false);
	});
});
