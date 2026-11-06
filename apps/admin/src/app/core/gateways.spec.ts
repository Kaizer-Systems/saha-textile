import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpAdminCustomersGateway } from './admin-customers/http-admin-customers.gateway';
import { HttpAdminNotificationsGateway } from './admin-notifications/http-admin-notifications.gateway';
import { HttpAdminRolesGateway } from './admin-roles/http-admin-roles.gateway';
import { HttpAdminUsersGateway } from './admin-users/http-admin-users.gateway';
import { ContentBlocksGateway, YouTubeGateway } from './media/content-blocks.gateway';
import { MediaGateway } from './media/media.gateway';
import { ReviewsGateway } from './media/reviews.gateway';

const http = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
const url = (call: typeof http.get) => String(call.mock.lastCall?.[0]);

beforeEach(() => {
	for (const call of Object.values(http)) call.mockReset().mockReturnValue(of({}));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
});

describe('HttpAdminNotificationsGateway', () => {
	it('uses its five routes', () => {
		const gateway = TestBed.inject(HttpAdminNotificationsGateway);
		gateway.providerStatus();
		expect(url(http.get)).toMatch(/\/admin\/notifications\/provider$/);
		gateway.listChannels();
		expect(url(http.get)).toMatch(/\/channels$/);
		gateway.toggleChannel({ channel: 'sms', category: 'marketing' });
		expect(http.patch).toHaveBeenCalledOnce();
		gateway.listTemplates();
		expect(url(http.get)).toMatch(/\/templates$/);
		gateway.upsertTemplate({ key: 'k', channel: 'sms', category: 'marketing', name: 'n' });
		expect(http.put).toHaveBeenCalledOnce();
	});
});

describe('ContentBlocksGateway', () => {
	const gateway = () => TestBed.inject(ContentBlocksGateway);

	it('reads and sets the hero layout', async () => {
		http.get.mockReturnValue(of({ heroLayout: 'hero_full' }));
		await expect(firstValueFrom(gateway().heroLayout())).resolves.toBe('hero_full');
		http.put.mockReturnValue(of({ heroLayout: 'hero_main_side' }));
		await expect(firstValueFrom(gateway().setHeroLayout('hero_main_side'))).resolves.toBe('hero_main_side');
	});

	it('lists, saves and removes blocks', () => {
		gateway().list('home');
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { ownerType: 'home' } });
		gateway().save({ slot: 'main' } as never);
		expect(url(http.put)).toMatch(/\/admin\/content-blocks$/);
		gateway().remove('a b');
		expect(url(http.delete)).toMatch(/\/content-blocks\/a%20b$/);
	});

	it('validates a video', () => {
		TestBed.inject(YouTubeGateway).validate('abc');
		expect(http.post.mock.lastCall?.[1]).toEqual({ input: 'abc' });
	});
});

describe('MediaGateway', () => {
	const gateway = () => TestBed.inject(MediaGateway);
	const item = (preview: unknown) => ({
		asset: {
			id: 'a1',
			slug: 'photo',
			purpose: 'product',
			originalFormat: 'jpeg',
			originalByteSize: 10,
			processing: { state: 'ready' },
		},
		preview,
		usageCount: 0,
	});

	it('asks with defaults, and adds search and purpose when given', () => {
		http.get.mockReturnValue(of({ items: [], total: 0, page: 1, pageSize: 48 }));
		void firstValueFrom(gateway().library({}));
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { page: '1', pageSize: '48' } });
		void firstValueFrom(gateway().library({ search: 'x', purpose: 'banner', page: 2, pageSize: 5 }));
		expect(http.get.mock.lastCall?.[1]).toEqual({
			params: { page: '2', pageSize: '5', search: 'x', purpose: 'banner' },
		});
	});

	it.each([
		[
			{
				roles: {
					card: [
						{ url: 'small', width: 100 },
						{ url: 'large', width: 400 },
					],
				},
			},
			'large',
		],
		[{ roles: { card: [{ url: 'small', width: 100 }] } }, 'small'],
		[{ roles: { thumb: [{ url: 'thumb', width: 50 }] } }, 'thumb'],
		[{ roles: {} }, 'assets/images/product.png'],
		[null, 'assets/images/product.png'],
	])('picks the preview from %j', async (preview, expected) => {
		http.get.mockReturnValue(of({ items: [item(preview)], total: 1, page: 1, pageSize: 48 }));
		const page = await firstValueFrom(gateway().library({}));
		expect(page.data[0]).toMatchObject({ id: 'a1', original_url: expected, size: '10' });
	});

	it('reads one asset', async () => {
		http.get.mockReturnValue(of(item(null)));
		await expect(firstValueFrom(gateway().get('a 1'))).resolves.toMatchObject({ id: 'a1' });
		expect(url(http.get)).toMatch(/\/admin\/media\/a%201$/);
	});

	it('runs the upload steps', () => {
		gateway().presign({
			purpose: 'product',
			contentType: 'image/jpeg',
			byteSize: 1,
			fileName: 'a',
			width: 1,
			height: 1,
		});
		expect(http.post.mock.lastCall?.[1]).toMatchObject({ kind: 'image', purpose: 'product' });
		gateway().finalize('a1');
		expect(url(http.post)).toMatch(/\/a1\/finalize$/);
		gateway().status('a1');
		expect(url(http.get)).toMatch(/\/a1\/status$/);
		gateway().remove('a1');
		expect(url(http.delete)).toMatch(/\/a1$/);
	});
});

describe('ReviewsGateway', () => {
	it('lists with defaults, and a status when given', () => {
		const gateway = TestBed.inject(ReviewsGateway);
		gateway.list({});
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { page: '1', pageSize: '20' } });
		gateway.list({ page: 2, pageSize: 5, status: 'pending' });
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { page: '2', pageSize: '5', status: 'pending' } });
	});

	it('moderates', () => {
		TestBed.inject(ReviewsGateway).moderate('r 1', 'approve');
		expect(url(http.post)).toMatch(/\/reviews\/r%201\/moderation$/);
		expect(http.post.mock.lastCall?.[1]).toEqual({ decision: 'approve', note: null });
	});
});

describe('HttpAdminUsersGateway', () => {
	const gateway = () => TestBed.inject(HttpAdminUsersGateway);

	it('lists with and without paging', () => {
		gateway().list({});
		expect(url(http.get)).toMatch(/\/admin\/users$/);
		gateway().list({ page: 2, pageSize: 5 });
		expect(url(http.get)).toMatch(/\/admin\/users\?page=2&pageSize=5$/);
	});

	it.each([
		[{ effectivePermissions: ['a'], permissions: ['b'] }, ['a']],
		[{ permissions: ['b'] }, ['b']],
		[{}, []],
	])('reads the authority from %j', async (body, permissions) => {
		http.get.mockReturnValue(of(body));
		await expect(firstValueFrom(gateway().authority('u1'))).resolves.toMatchObject({ permissions });
		http.post.mockReturnValue(of(body));
		await expect(firstValueFrom(gateway().assignRole('u1', 'r1'))).resolves.toMatchObject({ permissions });
		http.delete.mockReturnValue(of(body));
		await expect(firstValueFrom(gateway().revokeRole('u1', 'r1'))).resolves.toMatchObject({ permissions });
	});

	it('sets a status', () => {
		gateway().setStatus('u1', { status: 'disabled' } as never);
		expect(url(http.patch)).toMatch(/\/admin\/users\/u1\/status$/);
	});

	it('lists the roles for the invite picker', async () => {
		http.get.mockReturnValue(
			of({
				items: [
					{ id: 'r1', key: 'k', label: 'L', baseRole: 'staff' },
					{ id: 'r2', description: 'D' },
				],
			}),
		);
		const roles = await firstValueFrom(gateway().listRoles());
		expect(roles.items[0]).toMatchObject({ description: null });
		expect(roles.items[1]).toMatchObject({ description: 'D' });
		http.get.mockReturnValue(of({}));
		await expect(firstValueFrom(gateway().listRoles())).resolves.toEqual({ items: [] });
	});
});

describe('HttpAdminRolesGateway', () => {
	const gateway = () => TestBed.inject(HttpAdminRolesGateway);
	const raw = { id: 'r1', key: 'k', label: 'L', baseRole: 'staff', isSystem: 1 };

	it('normalises what it reads and writes', async () => {
		http.get.mockReturnValue(of({ items: [raw] }));
		await expect(firstValueFrom(gateway().list())).resolves.toMatchObject({
			items: [{ description: null, permissions: [], isSystem: true }],
		});
		http.get.mockReturnValue(of({ ...raw, description: 'D', permissions: ['a'] }));
		await expect(firstValueFrom(gateway().get('r1'))).resolves.toMatchObject({
			description: 'D',
			permissions: ['a'],
		});
		http.post.mockReturnValue(of(raw));
		await expect(firstValueFrom(gateway().create({} as never))).resolves.toMatchObject({ id: 'r1' });
		http.patch.mockReturnValue(of(raw));
		await expect(firstValueFrom(gateway().update('r1', {} as never))).resolves.toMatchObject({ id: 'r1' });
	});

	it('treats a bare list as empty', async () => {
		http.get.mockReturnValue(of({}));
		await expect(firstValueFrom(gateway().list())).resolves.toEqual({ items: [] });
		await expect(firstValueFrom(gateway().listPermissions())).resolves.toEqual({ items: [] });
		http.get.mockReturnValue(of({ items: [{ code: 'a' }] }));
		await expect(firstValueFrom(gateway().listPermissions())).resolves.toEqual({ items: [{ code: 'a' }] });
	});

	it('removes', () => {
		gateway().remove('r1');
		expect(url(http.delete)).toMatch(/\/admin\/roles\/r1$/);
	});
});

describe('HttpAdminCustomersGateway', () => {
	const gateway = () => TestBed.inject(HttpAdminCustomersGateway);

	it('builds the list query from what is given', () => {
		gateway().list({} as never);
		expect(url(http.get)).toMatch(/\/admin\/customers$/);
		gateway().list({ page: 1, pageSize: 5, q: 'a', status: 'active' } as never);
		expect(url(http.get)).toMatch(/\?page=1&pageSize=5&q=a&status=active$/);
		gateway().listDeleted({ page: 1 } as never);
		expect(url(http.get)).toMatch(/\/customers\/deleted\?page=1$/);
	});

	it('uses each customer route', () => {
		gateway().restore('c1');
		expect(url(http.post)).toMatch(/\/c1\/restore$/);
		gateway().get('c1');
		expect(url(http.get)).toMatch(/\/customers\/c1$/);
		gateway().create({} as never);
		expect(url(http.post)).toMatch(/\/admin\/customers$/);
		gateway().update('c1', {} as never);
		expect(url(http.patch)).toMatch(/\/customers\/c1$/);
		gateway().softDelete('c1');
		expect(url(http.delete)).toMatch(/\/customers\/c1$/);
		gateway().resendActivation('c1', {} as never);
		expect(url(http.post)).toMatch(/\/activation\/resend$/);
		gateway().addAddress('c1', {} as never);
		expect(url(http.post)).toMatch(/\/c1\/addresses$/);
		gateway().updateAddress('c1', 'a1', {} as never);
		expect(url(http.patch)).toMatch(/\/addresses\/a1$/);
		gateway().deleteAddress('c1', 'a1');
		expect(url(http.delete)).toMatch(/\/addresses\/a1$/);
	});

	it('builds the orders query from what is given', () => {
		gateway().listOrders('c1', {});
		expect(url(http.get)).toMatch(/\/c1\/orders$/);
		gateway().listOrders('c1', {
			page: 1,
			pageSize: 5,
			q: 'a',
			startDate: new Date('2026-01-01T00:00:00Z'),
			endDate: new Date('2026-01-02T00:00:00Z'),
		});
		expect(url(http.get)).toContain('?page=1&pageSize=5&q=a&startDate=2026-01-01');
	});
});
