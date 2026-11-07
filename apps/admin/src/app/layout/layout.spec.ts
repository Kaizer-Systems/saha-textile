import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { Search } from './header/widgets/search/search';
import { Loader } from './loader/loader';
import { PageWrapper } from './page-wrapper/page-wrapper';
import { Sidebar } from './sidebar/sidebar';

const notifications = signal<unknown>(undefined);
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: notifications }),
}));

const bare = <T>(type: new () => T, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
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
		const menu = { loadBadges: vi.fn() };
		const nav = { sidebarLoading: true };
		const content = bare(Content, [
			{ provide: MenuStore, useValue: menu },
			{ provide: NavService, useValue: nav },
		]);
		expect(content.isBrowser).toBe(true);
		expect(menu.loadBadges).toHaveBeenCalledOnce();
		expect(nav.sidebarLoading).toBe(false);
	});

	it('toggles dark mode', () => {
		bare(Mode).customizeLayoutDark();
		expect(document.body.classList.contains('dark-only')).toBe(true);
	});
});

describe('Header', () => {
	it('applies the mode, and toggles the sidebar and mobile search', () => {
		const nav = { collapseSidebar: false, search: false };
		const header = bare(Header, [settings({ general: { mode: 'dark' } }), { provide: NavService, useValue: nav }]);
		TestBed.tick();
		expect(document.body.classList.contains('dark')).toBe(true);
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
		localStorage.setItem('language', JSON.stringify({ language: 'Français', code: 'fr', icon: 'fr' }));
		const saved = render();
		expect(saved.widget.selectedLanguage.code).toBe('fr');
		expect(saved.translate.setActiveLang).toHaveBeenCalledWith('fr');
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
		expect(localStorage.getItem('language')).toContain('fr');
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
	it('counts the unread ones and toggles', () => {
		const widget = bare(Notification, [{ provide: NavService, useValue: {} }]);
		expect(widget.notifications()).toEqual([]);
		notifications.set({ data: [{ read_at: null }, { read_at: 'now' }] });
		expect(widget.unreadNotificationCount()).toBe(1);
		widget.clickHeaderOnMobile();
		expect(widget.active).toBe(true);
	});
});

describe('Header search', () => {
	const render = () => {
		const nav = { search: true };
		const search = bare(Search, [{ provide: NavService, useValue: nav }]);
		search.items = [
			{ title: 'Orders', type: 'link', icon: 'a' },
			{
				title: 'Catalog',
				type: 'sub',
				icon: 'b',
				children: [
					{ title: 'Products', type: 'link' },
					{ title: 'Group', type: 'sub', children: [{ title: 'Order Status' }, { title: 'Other' }] },
					{ type: 'sub' },
				],
			},
			{ title: 'Plain', type: 'sub' },
			{ icon: 'no title' },
		] as never;
		return { search, nav };
	};

	it('finds links at each level, carrying the parent icon', () => {
		const { search } = render();
		const found = search.searchTerm('order') as { title: string; icon?: string }[];
		expect(found.map((item) => item.title)).toEqual(['Orders', 'Order Status']);
		expect(found[1]?.icon).toBe('b');
		expect(search.searchResultEmpty).toBe(false);
		expect(document.body.classList.contains('overlay-search')).toBe(true);
	});

	it('says when nothing matches', () => {
		const { search } = render();
		search.searchTerm('zzz');
		expect(search.searchResultEmpty).toBe(true);
		expect(search.searchTerm('products')).toHaveLength(1);
	});

	it('clears on an empty term', () => {
		const { search } = render();
		search.searchTerm('order');
		expect(search.searchTerm()).toEqual([]);
		expect(search.searchResult).toBe(false);
		expect(document.body.classList.contains('overlay-search')).toBe(false);
	});

	it('opens and closes', () => {
		const { search, nav } = render();
		search.openDropDown('x');
		expect(search.searchResult).toBe(true);
		search.openDropDown('');
		expect(search.searchResult).toBe(true);
		search.clickOutside();
		expect(search.searchResult).toBe(false);
		search.closeSearch();
		expect(nav.search).toBe(false);
	});
});

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
