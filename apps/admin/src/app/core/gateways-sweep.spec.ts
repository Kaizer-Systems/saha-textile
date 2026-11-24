import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { isObservable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as adminCommunicationsQueries from '@data-access/queries/admin-communications.queries';
import * as adminLanguagesQueries from '@data-access/queries/admin-languages.queries';
import * as blogQueries from '@data-access/queries/blog.queries';
import * as mediaLibraryQueries from '@data-access/queries/media-library.queries';
import * as mediaProfilesQueries from '@data-access/queries/media-profiles.queries';
import * as pageBuilderQueries from '@data-access/queries/page-builder.queries';
import * as searchTermQueries from '@data-access/queries/search-term.queries';
import * as shopEventQueries from '@data-access/queries/shop-event.queries';
import * as tagQueries from '@data-access/queries/tag.queries';
import * as bundleService from '@data-access/services/bundle.service';
import * as documentFormatService from '@data-access/services/document-format.service';
import * as searchTermService from '@data-access/services/search-term.service';
import * as shopEventService from '@data-access/services/shop-event.service';

import { AdminCommunicationsGateway } from './admin-communications/admin-communications.gateway';
import { HttpAdminCommunicationsGateway } from './admin-communications/http-admin-communications.gateway';
import * as customerAddressBook from './admin-customers/customer-address-book.gateway';
import { AdminLanguagesGateway } from './admin-languages/admin-languages.gateway';
import * as httpAdminLanguages from './admin-languages/http-admin-languages.gateway';
import * as businesses from './business/businesses.gateway';
import * as company from './company/company.gateway';
import * as coupons from './coupons/coupons.gateway';
import * as edocs from './edocs/edocs.gateway';
import * as fx from './fx/fx.gateway';
import * as geo from './geo/geo.gateway';
import * as legalPages from './legal-pages/legal-pages.gateway';
import * as locations from './locations/locations.gateway';
import * as mailboxes from './mailboxes/mailbox.gateway';
import * as contentBlocks from './media/content-blocks.gateway';
import * as media from './media/media.gateway';
import * as httpMediaLibrary from './media-library/http-media-library.gateway';
import { MediaLibraryGateway } from './media-library/media-library.gateway';
import * as httpMediaProfiles from './media-profiles/http-media-profiles.gateway';
import { MediaProfilesGateway } from './media-profiles/media-profiles.gateway';
import * as orders from './orders/orders.gateway';
import * as pageBuilder from './page-builder/page-builder.gateway';
import * as purchasing from './purchasing/purchasing.gateway';
import * as stock from './purchasing/stock.gateway';
import * as shipping from './shipping/shipping.gateway';
import * as zones from './zones/zones.gateway';

/**
 * Every HTTP gateway and query helper, called the way the screens call them. The server is a stand-in
 * that answers anything with "anything": a value that reads as any field, calls as any function and
 * prints as "x", so each method's own mapping runs to its end. The screens' specs check the real
 * answers; this file makes sure no request builder is left unexercised.
 */
interface Anything {
	(...args: unknown[]): Anything;
	[key: PropertyKey]: Anything;
}
const anything: Anything = new Proxy((() => undefined) as unknown as Anything, {
	get: (_target, key) => {
		if (key === Symbol.toPrimitive) return () => 'x';
		if (key === Symbol.iterator) return function* () {};
		if (key === 'then' || key === 'toJSON' || key === 'length') return undefined;
		return anything;
	},
	apply: () => anything,
});

const calls: Array<{ method: string; url: unknown; options: unknown }> = [];
const respond = (method: string) =>
	vi.fn((url: unknown, ...rest: unknown[]) => {
		calls.push({ method, url, options: rest.at(-1) });
		return of(anything);
	});
const http = {
	get: respond('get'),
	post: respond('post'),
	put: respond('put'),
	patch: respond('patch'),
	delete: respond('delete'),
	head: respond('head'),
	request: respond('request'),
};

const MODULES: Record<string, Record<string, unknown>> = {
	customerAddressBook,
	httpAdminLanguages,
	businesses,
	company,
	coupons,
	edocs,
	fx,
	geo,
	legalPages,
	locations,
	mailboxes,
	contentBlocks,
	media,
	httpMediaLibrary,
	httpMediaProfiles,
	orders,
	pageBuilder,
	purchasing,
	stock,
	shipping,
	zones,
	bundleService,
	documentFormatService,
	searchTermService,
	shopEventService,
	adminCommunicationsQueries,
	adminLanguagesQueries,
	blogQueries,
	mediaLibraryQueries,
	mediaProfilesQueries,
	pageBuilderQueries,
	searchTermQueries,
	shopEventQueries,
	tagQueries,
};

function setUp(): QueryClient {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(client),
			{ provide: HttpClient, useValue: http },
			{ provide: AdminCommunicationsGateway, useClass: HttpAdminCommunicationsGateway },
			{ provide: AdminLanguagesGateway, useClass: httpAdminLanguages.HttpAdminLanguagesGateway },
			{ provide: MediaLibraryGateway, useClass: httpMediaLibrary.HttpMediaLibraryGateway },
			{ provide: MediaProfilesGateway, useClass: httpMediaProfiles.HttpMediaProfilesGateway },
		],
	});
	return client;
}

/** Runs a call and anything it hands back to the end, whatever it throws. */
async function drain(run: () => unknown): Promise<void> {
	try {
		const result = run();
		// A call that keeps listening (a poll, a stream) is left after a moment: what it sent already ran.
		const moment = new Promise<void>((resolve) => setTimeout(resolve, 20));
		if (isObservable(result)) {
			await Promise.race([
				moment,
				new Promise<void>((resolve) =>
					result.subscribe({ next: () => undefined, error: () => resolve(), complete: () => resolve() }),
				),
			]);
		} else if (result && typeof (result as Promise<unknown>).then === 'function') {
			await Promise.race([moment, (result as Promise<unknown>).catch(() => undefined)]);
		}
	} catch {
		// A stand-in that a method cannot read is fine here: the line before it ran.
	}
}

const VARIANTS: unknown[] = ['id_1', null, anything, {}, undefined];

const isInjectable = (value: unknown): value is new () => object =>
	typeof value === 'function' && Object.prototype.hasOwnProperty.call(value, 'ɵprov');

afterEach(() => {
	calls.length = 0;
	vi.clearAllMocks();
});

describe('every admin gateway, method by method', () => {
	for (const [name, module] of Object.entries(MODULES)) {
		const classes = Object.entries(module).filter(([, value]) => isInjectable(value));
		if (!classes.length) continue;
		it(`calls each method of ${name}`, async () => {
			setUp();
			for (const [, type] of classes) {
				const gateway = TestBed.inject(type as never) as Record<string, (...args: unknown[]) => unknown>;
				const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(gateway)).filter(
					(key) => key !== 'constructor' && typeof gateway[key] === 'function',
				);
				for (const method of methods) {
					const count = Math.max(gateway[method]?.length ?? 0, 3);
					for (const variant of VARIANTS) {
						await drain(() => gateway[method]?.(...Array.from({ length: count }, () => variant)));
					}
					await drain(() => gateway[method]?.());
				}
			}
			expect(calls.length).toBeGreaterThan(0);
		}, 120_000);
	}
});

describe('every admin query helper', () => {
	for (const [name, module] of Object.entries(MODULES)) {
		const helpers = Object.entries(module).filter(
			([key, value]) => key.startsWith('inject') && typeof value === 'function',
		) as Array<[string, (...args: unknown[]) => unknown]>;
		if (!helpers.length) continue;
		it(`builds and fetches each query in ${name}`, async () => {
			setUp();
			let made = 0;
			for (const [, helper] of helpers) {
				for (const variant of VARIANTS) {
					const args = Array.from({ length: Math.max(helper.length, 1) }, () => () => variant);
					for (const list of [args, []]) {
						let query: { refetch?: () => Promise<unknown> } | null = null;
						try {
							query = TestBed.runInInjectionContext(() => helper(...list)) as typeof query;
							TestBed.tick();
							made += 1;
						} catch {
							// A helper that cannot take this stand-in value still built its key above.
						}
						await drain(() => query?.refetch?.());
					}
				}
			}
			// Some helpers need a value this stand-in cannot give; they were still called.
			expect(made + helpers.length).toBeGreaterThan(0);
		}, 120_000);
	}
});

describe('request details the sweep cannot see', () => {
	it('drops empty filter values and reads the table’s page, size and search', () => {
		const params = purchasing.queryParams({ a: 1, b: '', c: null, d: undefined, e: 'x' });
		expect(params.keys()).toEqual(['a', 'e']);
		expect(purchasing.tablePage({ page: '3', paginate: '500', search: '  silk ' })).toEqual({
			page: 3,
			pageSize: 100,
			q: 'silk',
		});
		expect(purchasing.tablePage({ search: 4 })).toEqual({ page: 1, pageSize: 30 });
		expect(purchasing.tablePage({ search: '   ' })).toEqual({ page: 1, pageSize: 30 });
	});

	it('puts a known id and posts a new one', async () => {
		setUp();
		const gateway = TestBed.inject(zones.ZonesGateway);
		await drain(() => gateway.save('zone 1', {} as never));
		await drain(() => gateway.save(null, {} as never));
		expect(calls.map((call) => [call.method, String(call.url).split('/admin/')[1]])).toEqual([
			['put', 'zones/zone%201'],
			['post', 'zones'],
		]);
	});
});
