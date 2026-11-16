import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { LoaderStore } from '@core/state/loader.store';
import { MenuStore } from '@core/state/menu.store';
import { SettingStore } from '@core/state/setting.store';
import { NavService } from '@data-access/services/nav.service';

import { Content } from './content/content';
import { Footer } from './footer/footer';
import { Full } from './full/full';
import { Header } from './header/header';
import { Languages } from './header/widgets/languages/languages';
import { Mode } from './header/widgets/mode/mode';
import { Notification } from './header/widgets/notification/notification';
import { Profile } from './header/widgets/profile/profile';
import { Loader } from './loader/loader';
import { PageWrapper } from './page-wrapper/page-wrapper';
import { Sidebar } from './sidebar/sidebar';

const brandData = () => undefined;
vi.mock('@core/brand/brand.gateway', () => ({
	injectBrandQuery: () => ({ data: brandData }),
}));

const inbox = vi.hoisted(() => ({ enabled: (() => false) as () => boolean }));
const inboxData = signal<{ unread: number }[] | undefined>(undefined);
vi.mock('@core/mailboxes/mailbox.gateway', () => ({
	injectInboxSummaryQuery: (enabled: () => boolean) => {
		inbox.enabled = enabled;
		return { data: inboxData };
	},
}));

const notifications = signal<unknown>(undefined);
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: notifications }),
}));
const reminders = signal<unknown>(undefined);
const remindersAsked = vi.hoisted(() => ({ enabled: [] as boolean[] }));
vi.mock('@data-access/queries/admin-languages.queries', () => ({
	injectLanguageRemindersQuery: (enabled: () => boolean) => {
		remindersAsked.enabled.push(enabled());
		return { data: reminders };
	},
}));

const storage = signal<unknown>(undefined);
const storageAsked = vi.hoisted(() => ({ enabled: [] as boolean[] }));
vi.mock('@data-access/queries/media-library.queries', async (original) => ({
	...(await original<object>()),
	injectMediaStorageQuery: (enabled: () => boolean = () => true) => {
		storageAsked.enabled.push(enabled());
		return { data: storage };
	},
	injectNightlyCheckQuery: () => ({ data: nightly }),
}));
const nightly = signal<unknown>(undefined);

const stockAlerts = signal<unknown>(undefined);
const stockAsked = vi.hoisted(() => ({ enabled: [] as Array<() => boolean>, seen: [] as string[][] }));
vi.mock('@core/purchasing/stock.gateway', async (original) => ({
	...(await original<object>()),
	injectStockAlertsQuery: (enabled: () => boolean) => {
		stockAsked.enabled.push(enabled);
		return { data: stockAlerts };
	},
}));

const bare = <T>(type: new () => T, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: object) => (params ? `${key}:${JSON.stringify(params)}` : key),
					getActiveLang: () => 'en',
					getTranslation: () => ({}),
				},
			},
			{ provide: QueryClient, useValue: { invalidateQueries: () => Promise.resolve() } },
			{
				provide: StockGateway,
				useValue: {
					markSeen: (ids: string[]) => {
						stockAsked.seen.push(ids);
						return of(undefined);
					},
				},
			},
			...(providers as never[]),
		] as never[],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type).componentInstance;
};
const settings = (setting: unknown = null) => ({ provide: SettingStore, useValue: { setting: signal(setting) } });

afterEach(() => {
	notifications.set(undefined);
	localStorage.clear();
	vi.unstubAllGlobals();
	document.body.className = '';
});

describe('shell pieces', () => {
	it('creates the footer, loader and wrapper', () => {
		expect(bare(Footer, [settings()])).toBeInstanceOf(Footer);
		expect(bare(Loader)).toBeInstanceOf(Loader);
		expect(bare(PageWrapper, [{ provide: LoaderStore, useValue: {} }])).toBeInstanceOf(PageWrapper);
	});

	it('knows the platform', () => {
		expect(bare(Full, [{ provide: PLATFORM_ID, useValue: 'server' }]).isBrowser).toBe(false);
		expect(bare(Full).isBrowser).toBe(true);
	});

	it('loads the badges and stops the sidebar skeleton', () => {
		const menu = { loadBadges: vi.fn(), setBadge: vi.fn(), setGroupBadge: vi.fn() };
		const nav = { sidebarLoading: true };
		const permissions = signal<string[]>([]);
		const content = bare(Content, [
			{ provide: MenuStore, useValue: menu },
			{ provide: NavService, useValue: nav },
			{ provide: AuthStore, useValue: { permissions } },
		]);
		expect(content.isBrowser).toBe(true);
		expect(menu.loadBadges).toHaveBeenCalledOnce();
		expect(nav.sidebarLoading).toBe(false);
		TestBed.tick();
		expect(menu.setBadge).toHaveBeenCalledWith('/inbox', 0);
		expect(menu.setGroupBadge).toHaveBeenCalledWith(24, 0);
		expect(inbox.enabled()).toBe(false);
		permissions.set(['mailbox.use']);
		expect(inbox.enabled()).toBe(true);
		inboxData.set([{ unread: 2 }, { unread: 3 }]);
		TestBed.tick();
		expect(menu.setBadge).toHaveBeenLastCalledWith('/inbox', 5);
		inboxData.set(undefined);
		// i05: approvals waiting show on the Stock group and its Approvals item.
		expect(stockAsked.enabled.at(-1)?.()).toBe(false);
		permissions.set(['stock.approve']);
		expect(stockAsked.enabled.at(-1)?.()).toBe(true);
		stockAlerts.set({
			pendingApprovals: 4,
			decisions: [],
			lateOrders: [],
			billsNearCreditLimit: [],
			heldOverdue: 0,
		});
		TestBed.tick();
		expect(menu.setGroupBadge).toHaveBeenLastCalledWith(24, 4);
		expect(menu.setBadge).toHaveBeenLastCalledWith('/stock/approvals', 4);
		stockAlerts.set(undefined);
	});

	it('switches dark mode through the shared store, and remembers it', () => {
		const mode = bare(Mode);
		expect(mode.themeMode.dark()).toBe(false);
		mode.themeMode.toggle();
		expect(mode.themeMode.dark()).toBe(true);
		expect(localStorage.getItem('st_admin_theme')).toBe('dark');
		mode.themeMode.toggle();
		document.getElementById('theme-dark')?.remove();
	});
});

describe('Header', () => {
	it('leaves the mode to the theme-mode store, and toggles the sidebar and mobile search', () => {
		const nav = { collapseSidebar: false, search: false };
		// The demo settings' `mode` once became a body class; dark mode now belongs to ThemeModeStore.
		const header = bare(Header, [
			settings({ general: { mode: 'dark-only' } }),
			{ provide: NavService, useValue: nav },
		]);
		TestBed.tick();
		expect(document.body.className).toBe('');
		header.sidebarToggle();
		expect(nav.collapseSidebar).toBe(true);
		header.clickHeaderOnMobile();
		expect(nav.search).toBe(true);
	});
});

describe('Languages', () => {
	const render = (platform = 'browser') => {
		const translate = { setActiveLang: vi.fn() };
		const widget = bare(Languages, [
			{ provide: TranslocoService, useValue: translate },
			{ provide: PLATFORM_ID, useValue: platform },
		]);
		return { widget, translate };
	};

	it('starts in English, or the saved language', () => {
		expect(render().translate.setActiveLang).toHaveBeenCalledWith('en');
		localStorage.setItem('language', JSON.stringify({ language: 'বাংলা', code: 'bn', icon: 'bn' }));
		const saved = render();
		expect(saved.widget.selectedLanguage.code).toBe('bn');
		expect(saved.translate.setActiveLang).toHaveBeenCalledWith('bn');
	});

	it('touches nothing on the server', () => {
		expect(render('server').translate.setActiveLang).not.toHaveBeenCalled();
	});

	it('saves the choice and opens and closes', () => {
		const { widget } = render();
		widget.clickHeaderOnMobile();
		expect(widget.active).toBe(true);
		widget.hideDropdown();
		expect(widget.active).toBe(false);
		widget.selectLanguage(widget.languages[1]!);
		expect(localStorage.getItem('language')).toContain('bn');
	});
});

describe('Profile', () => {
	const render = (user: unknown) => {
		const auth = { user: signal(user), logout: vi.fn() };
		return { profile: bare(Profile, [{ provide: AuthStore, useValue: auth }]), auth };
	};

	it('prefers the username, then the address, then nothing', () => {
		expect(render({ username: 'asha', role: 'admin' }).profile.displayInitial()).toBe('A');
		expect(render({ username: 'asha', role: 'admin' }).profile.roleLabel()).toBe('admin');
		expect(render({ email: 'b@c.co' }).profile.displayName()).toBe('b@c.co');
		expect(render(null).profile.displayName()).toBe('');
		expect(render(null).profile.roleLabel()).toBe('');
	});

	it('toggles and logs out', () => {
		const { profile, auth } = render(null);
		profile.clickHeaderOnMobile();
		expect(profile.active).toBe(true);
		profile.logout();
		expect(auth.logout).toHaveBeenCalledOnce();
	});
});

describe('Header notification', () => {
	const auth = (permissions: string[]) => ({ provide: AuthStore, useValue: { permissions: signal(permissions) } });

	it('counts the unread ones and toggles', () => {
		const widget = bare(Notification, [{ provide: NavService, useValue: {} }, auth([])]);
		expect(widget.notifications()).toEqual([]);
		notifications.set({ data: [{ read_at: null }, { read_at: 'now' }] });
		expect(widget.unreadNotificationCount()).toBe(1);
		widget.clickHeaderOnMobile();
		expect(widget.active).toBe(true);
	});

	it('reminds whoever manages languages about a deleted language’s stored text', () => {
		remindersAsked.enabled = [];
		bare(Notification, [{ provide: NavService, useValue: {} }, auth([])]);
		const widget = bare(Notification, [{ provide: NavService, useValue: {} }, auth(['language.manage'])]);
		expect(remindersAsked.enabled).toEqual([false, true]);
		reminders.set({ reminders: [{ code: 'bn', deletedAt: '2026-10-01T00:00:00.000Z', itemsWithText: 12 }] });
		expect(widget.languageReminders().map((row) => row.code)).toEqual(['bn']);
		expect(widget.unreadNotificationCount()).toBe(1);
		expect(widget.languageName('bn')).toBe('বাংলা');
		reminders.set(undefined);
	});

	it('says Media storage is at 85% or past the plan, to people who use Media (R4-7, step 5)', () => {
		storageAsked.enabled = [];
		bare(Notification, [{ provide: NavService, useValue: {} }, auth([])]);
		const widget = bare(Notification, [{ provide: NavService, useValue: {} }, auth(['attachment.index'])]);
		expect(storageAsked.enabled).toEqual([false, true]);
		storage.set({ percent: 84, onDemandBytes: 0 });
		expect(widget.storageAlert()).toBeNull();
		storage.set({ percent: 88, onDemandBytes: 0 });
		expect(widget.storageAlert()).toMatchObject({ percent: 88 });
		expect(widget.unreadNotificationCount()).toBe(1);
		storage.set(undefined);
	});

	it('lists stock alerts for people with a stock or purchases permission, and marks a decision seen when opened', async () => {
		stockAsked.enabled = [];
		stockAsked.seen = [];
		bare(Notification, [{ provide: NavService, useValue: {} }, auth([])]);
		const widget = bare(Notification, [
			{ provide: NavService, useValue: {} },
			auth(['stock.adjust']),
			{ provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)) } },
		]);
		expect(stockAsked.enabled.map((enabled) => enabled())).toEqual([false, true]);
		stockAlerts.set({
			pendingApprovals: 0,
			decisions: [
				{
					id: 'req_1',
					kind: 'adjustment',
					action: 'remove',
					variantId: 'var_1',
					countId: null,
					countNumber: null,
					status: 'applied',
					sku: 'ST-BAN-0412',
					quantity: 2,
					soldBy: 'piece',
					decidedByName: 'Moulik',
					rejectReason: null,
				},
			],
			lateOrders: [],
			billsNearCreditLimit: [],
			heldOverdue: 2,
		});
		expect(widget.stock().map((line) => line.id)).toEqual(['decision-req_1', 'held-overdue']);
		expect(widget.unreadNotificationCount()).toBe(2);
		expect(widget.stockText(widget.stock()[0]!)).toContain('bell_request_approved');
		await widget.openStock(widget.stock()[0]!);
		expect(stockAsked.seen).toEqual([['req_1']]);
		stockAlerts.set(undefined);
	});

	it('says how many pictures the website uses are missing from storage (R5-5, step 5)', () => {
		const widget = bare(Notification, [{ provide: NavService, useValue: {} }, auth(['attachment.index'])]);
		nightly.set({ missingCount: 2 });
		expect(widget.missingPictures()).toBe(2);
		expect(widget.unreadNotificationCount()).toBe(1);
		nightly.set(undefined);
	});
});

// The header search is tested in header/widgets/search/search.spec.ts.

describe('Sidebar', () => {
	const menu = () =>
		[
			{ id: 1, path: '/dashboard', active: false },
			{
				id: 2,
				active: false,
				children: [
					{ id: 3, path: '/product', active: false },
					{ id: 4, active: false, children: [{ id: 5, path: '/deep', active: false }] },
				],
			},
		] as never;

	const render = (platform = 'browser', held: string[] = ['a']) => {
		const events = new Subject<unknown>();
		const nav = { collapseSidebar: false };
		const sidebar = bare(Sidebar, [
			{ provide: NavService, useValue: nav },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: Router, useValue: { events } },
			{ provide: MenuStore, useValue: { menu: signal(menu()) } },
			{ provide: AuthStore, useValue: { permissions: signal(held) } },
			settings(),
		]);
		return { sidebar, events, nav };
	};
	const item = (sidebar: Sidebar, id: number) => {
		const find = (items: { id: number; children?: unknown[] }[]): unknown => {
			for (const entry of items) {
				if (entry.id === id) return entry;
				const inner = entry.children ? find(entry.children as never) : null;
				if (inner) return inner;
			}
			return null;
		};
		return find(sidebar.menuItems as never) as { active: boolean };
	};

	it('highlights the page after navigation, however deep', () => {
		const { sidebar, events } = render();
		events.next(new NavigationStart(1, '/x'));
		events.next(new NavigationEnd(2, '/product?page=1', '/product?page=1'));
		expect(item(sidebar, 3).active).toBe(true);
		expect(item(sidebar, 2).active).toBe(true);
		events.next(new NavigationEnd(3, '/dashboard', '/dashboard'));
		expect(item(sidebar, 1).active).toBe(true);
		expect(item(sidebar, 2).active).toBe(false);
		expect(item(sidebar, 3).active).toBe(false);
	});

	it('walks a path already holding its slash', () => {
		const { sidebar } = render();
		sidebar.activeMenuRecursive(sidebar.menuItems[0] as never, '/dashboard');
		expect(item(sidebar, 1).active).toBe(true);
		sidebar.activeMenuRecursive(undefined as never, 'x');
	});

	it('checks menu permissions', () => {
		const { sidebar } = render();
		expect(sidebar.hasMainLevelMenuPermission()).toBe(true);
		expect(sidebar.hasMainLevelMenuPermission([])).toBe(true);
		expect(sidebar.hasMainLevelMenuPermission(['a', 'b'])).toBe(true);
		expect(sidebar.hasMainLevelMenuPermission(['b'])).toBe(false);
	});

	it('opens one item and closes the rest', () => {
		const { sidebar } = render();
		const one = item(sidebar, 1);
		one.active = true;
		sidebar.onItemSelected(item(sidebar, 2) as never);
		expect(one.active).toBe(false);
		expect(item(sidebar, 2).active).toBe(true);
		sidebar.onItemSelected(item(sidebar, 2) as never, true);
		expect(item(sidebar, 2).active).toBe(true);
		sidebar.deActiveAllMenu(undefined as never, {} as never);
	});

	it('toggles, and closes on a small browser screen only', () => {
		const { sidebar, nav } = render();
		sidebar.sidebarToggle();
		expect(nav.collapseSidebar).toBe(true);
		nav.collapseSidebar = false;
		vi.stubGlobal('innerWidth', 1400);
		sidebar.closeSidebar();
		expect(nav.collapseSidebar).toBe(false);
		vi.stubGlobal('innerWidth', 600);
		sidebar.closeSidebar();
		expect(nav.collapseSidebar).toBe(true);
		const server = render('server');
		server.sidebar.closeSidebar();
		expect(server.nav.collapseSidebar).toBe(false);
	});
});
