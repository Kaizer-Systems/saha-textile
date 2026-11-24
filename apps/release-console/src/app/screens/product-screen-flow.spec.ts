import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProductScreen, injectPlanFeatures } from './product-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { ProductAction, ProductRow } from '@saha-textile/release-console-contracts';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	q: { data: () => unknown; isPlaceholderData: () => boolean };
	data: () => unknown;
	refreshing: () => boolean;
	modal: () => ProductAction | null;
	modalForm: () => unknown;
	screens: { data: () => unknown };
	open(r: ProductRow): void;
	act(a: ProductAction): void;
	followUp(): void;
}

const view = (name: string) => ({ state: 'ok', data: { type: 'view', view: { head: { name } } } });
const action = (form: string): ProductAction => ({ label: form, form, tone: 'ghost' });
const row: ProductRow = { id: 'd1', name: 'web-1', cells: {}, tone: null };

function make(options: {
	screen?: string;
	tab: string;
	tabAnswer?: () => Promise<unknown>;
	states?: Record<string, string>;
}) {
	const params = new BehaviorSubject(convertToParamMap({}));
	const api = {
		productScreens: vi.fn(async () => ({
			droplets: {
				tabs: ['list', 'detail', 'create', 'creating', 'snapshot'],
				forms: ['create'],
				vendor: 'digitalocean',
			},
			plain: { tabs: ['list'], forms: [], vendor: 'cloudflare' },
		})),
		productTab: vi.fn(options.tabAnswer ?? (async () => view('first'))),
		productForm: vi.fn(async (_p: string, _r: string, _s: string, form: string) =>
			form === 'resize'
				? { state: 'ok', data: { type: 'form', form: { key: 'resize' } } }
				: { state: 'ok', data: { type: 'view', view: {} } },
		),
	};
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { queryParamMap: params } },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repoMenu: () => ({ screens: { plain: { states: options.states ?? {} } } }),
				},
			},
		],
	});
	TestBed.overrideComponent(ProductScreen, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductScreen);
	fixture.componentRef.setInput('screen', options.screen ?? 'droplets');
	fixture.componentRef.setInput('tab', options.tab);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Screen, api, router, params, fixture };
}

describe('a product screen', () => {
	it('keeps the last answer on screen while another product of the same tab is read', async () => {
		let answer = view('first');
		let release: () => void = () => undefined;
		const { c, params, fixture } = make({
			tab: 'detail',
			tabAnswer: () =>
				answer.data.view.head.name === 'first'
					? Promise.resolve(answer)
					: new Promise((resolve) => {
							release = () => resolve(answer);
						}),
		});
		await vi.waitFor(() => expect(c.data()).toEqual(view('first').data));
		answer = view('second');
		params.next(convertToParamMap({ id: 'd2' }));
		fixture.detectChanges();
		await vi.waitFor(() => expect(c.q.isPlaceholderData()).toBe(true));
		expect(c.refreshing()).toBe(true);
		expect(c.data()).toEqual(view('first').data);
		release();
		await vi.waitFor(() => expect(c.data()).toEqual(view('second').data));
	});

	it('shows nothing for an answer that is not ok', async () => {
		const { c } = make({ tab: 'list', tabAnswer: async () => ({ state: 'error', message: 'No key' }) });
		await vi.waitFor(() => expect(c.q.data()).toBeTruthy());
		expect(c.data()).toBeNull();
	});

	it('opens a row on its Use tab, a button on its own tab or as a form, and follows a create', async () => {
		const { c, router } = make({ tab: 'create' });
		await vi.waitFor(() => expect(c.screens.data()).toBeTruthy());
		c.open(row);
		expect(router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'detail', id: 'd1' },
			queryParamsHandling: 'merge',
		});
		c.act(action('snapshot'));
		expect(router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'snapshot' },
			queryParamsHandling: 'merge',
		});
		c.act(action('create'));
		expect(c.modal()?.form).toBe('create');
		await vi.waitFor(() => expect(c.modalForm()).toBeNull());
		c.act(action('resize'));
		await vi.waitFor(() => expect(c.modalForm()).toEqual({ key: 'resize' }));
		c.followUp();
		expect(router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'creating' },
			queryParamsHandling: 'merge',
		});
	});

	it('leaves a screen without a Use tab or a Creating tab where it is', async () => {
		const plain = make({ screen: 'plain', tab: 'list' });
		await vi.waitFor(() => expect(plain.c.screens.data()).toBeTruthy());
		plain.c.open(row);
		plain.c.followUp();
		expect(plain.router.navigate).not.toHaveBeenCalled();
		const menuOnly = make({ screen: 'plain', tab: 'take', states: { restoring: 'Restoring' } });
		await vi.waitFor(() => expect(menuOnly.c.screens.data()).toBeTruthy());
		menuOnly.c.followUp();
		expect(menuOnly.router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'restoring' },
			queryParamsHandling: 'merge',
		});
	});
});

describe('the Cloudflare plan read', () => {
	function features(answer: unknown) {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
				{ provide: ConsoleApi, useValue: { productTab: vi.fn(async () => answer) } },
			],
		});
		return TestBed.runInInjectionContext(() =>
			injectPlanFeatures(
				() => 'proj_1',
				() => 'shop',
			),
		);
	}

	it('reads which features are on, and nothing from a refusal or a tab that is not a view', async () => {
		const on = features({
			state: 'ok',
			data: {
				type: 'view',
				view: {
					facts: [
						['waf', 'on', 'ok'],
						['argo', 'off', null],
					],
				},
			},
		});
		await vi.waitFor(() => expect(on()).toEqual({ waf: true, argo: false }));
		const refused = features({ state: 'error', message: 'No key' });
		const form = features({ state: 'ok', data: { type: 'form', form: {} } });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(refused()).toBeNull();
		expect(form()).toBeNull();
	});
});
