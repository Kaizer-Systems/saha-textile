import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { REQUEST } from '@analogjs/router/tokens';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, runtimeConfig } from '@core/config/runtime-config';

import { PagePreview } from './page-preview';
import { linkToBuilder } from './preview-messages';

interface Options {
	queryKey: unknown[];
	enabled: boolean;
	queryFn: () => Promise<unknown>;
}
const held = vi.hoisted(() => ({ options: null as null | (() => Options) }));
const data = signal<unknown>(undefined);
const unlink = vi.fn();

vi.mock('@tanstack/angular-query-experimental', () => ({
	injectQuery: (options: () => Options) => {
		held.options = options;
		return { data };
	},
}));
vi.mock('./preview-messages', () => ({ linkToBuilder: vi.fn(() => unlink) }));

const render = ({
	platform = 'server',
	cookie = 'st_preview=tok%201' as string | undefined,
	request = true,
	type = 'home' as string | null,
	get = vi.fn(() => of({ sections: [{ id: 's1' }] })),
} = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: HttpClient, useValue: { get } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'bn' } },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(type ? { type } : {}) } },
			},
			...(request ? [{ provide: REQUEST, useValue: { headers: { cookie } } }] : []),
		],
	});
	TestBed.overrideComponent(PagePreview, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PagePreview);
	return { fixture, page: fixture.componentInstance, get, options: () => held.options?.() as Options };
};

beforeAll(() => loadRuntimeConfig());

// A full coverage run loads the API's .env, which may name an admin; these tests use the local one.
beforeEach(() => {
	vi.stubEnv('ADMIN_ORIGIN', '');
	vi.stubEnv('DEPLOY_ENV', '');
});

afterEach(() => {
	data.set(undefined);
	unlink.mockClear();
	vi.mocked(linkToBuilder).mockClear();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('PagePreview', () => {
	it('fetches the draft once, on the server, with the session from the request cookie', async () => {
		const { page, get, options } = render({ type: 'collection' });
		expect(page.pageType).toBe('collection');
		expect(options()).toMatchObject({ queryKey: ['page-preview', 'collection', 'bn'], enabled: true });
		await expect(options().queryFn()).resolves.toEqual({
			layout: { sections: [{ id: 's1' }] },
			adminOrigin: 'https://localhost:4300',
		});
		expect(get).toHaveBeenCalledWith(`${runtimeConfig.apiUrl}/storefront/preview/layout`, {
			params: { token: 'tok 1', locale: 'bn' },
		});
	});

	it('shows the home page by default and fetches nothing in the browser', () => {
		const { page, options } = render({ platform: 'browser', type: null });
		expect(page.pageType).toBe('home');
		expect(options().enabled).toBe(false);
	});

	it('draws nothing without a session or a request, and nothing when the draft cannot be read', async () => {
		const get = vi.fn(() => throwError(() => new Error('expired')));
		await expect(render({ cookie: 'st_locale=bn', get }).options().queryFn()).resolves.toMatchObject({
			layout: null,
		});
		await expect(render({ request: false, get }).options().queryFn()).resolves.toMatchObject({ layout: null });
		expect(get).not.toHaveBeenCalled();
		await expect(render({ get }).options().queryFn()).resolves.toMatchObject({ layout: null });
		expect(get).toHaveBeenCalledOnce();
	});

	it('hands the sections and the admin origin to the template once the data copy holds them', () => {
		const { page } = render();
		expect(page.sections()).toBeNull();
		expect(page.adminOrigin()).toBeNull();
		data.set({ layout: null, adminOrigin: null });
		expect(page.sections()).toBeNull();
		data.set({ layout: { sections: [{ id: 's1' }] }, adminOrigin: 'https://admin.test' });
		expect(page.sections()).toEqual([{ id: 's1' }]);
		expect(page.adminOrigin()).toBe('https://admin.test');
	});

	it('talks to the builder only inside its frame, and stops when the page goes', () => {
		data.set({ layout: null, adminOrigin: 'https://admin.test' });
		const top = render({ platform: 'browser' });
		top.fixture.detectChanges();
		TestBed.tick();
		expect(linkToBuilder).not.toHaveBeenCalled();
		top.fixture.destroy();

		vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window);
		const framed = render({ platform: 'browser' });
		framed.fixture.detectChanges();
		TestBed.tick();
		expect(linkToBuilder).toHaveBeenCalledWith(framed.fixture.nativeElement, window, 'https://admin.test');
		framed.fixture.destroy();
		expect(unlink).toHaveBeenCalledOnce();
	});

	it('does not talk to anyone when no admin may frame it', () => {
		vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window);
		const { fixture } = render({ platform: 'browser' });
		fixture.detectChanges();
		TestBed.tick();
		fixture.destroy();
		expect(linkToBuilder).not.toHaveBeenCalled();
	});
});
