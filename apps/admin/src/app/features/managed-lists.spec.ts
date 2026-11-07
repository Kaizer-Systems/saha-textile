import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { ReviewsGateway } from '@core/media/reviews.gateway';
import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { FaqService } from '@data-access/services/faq.service';
import { ProductService } from '@data-access/services/product.service';
import { NotificationService } from '@data-access/services/notification.service';
import { RedirectService } from '@data-access/services/redirect.service';

import { AddonTemplate } from './addon-template/addon-template';
import { Customer } from './customer/customer';
import { Faq } from './faq/faq';
import { Product } from './product/product';
import { Redirect } from './redirect/redirect';
import { Review } from './review/review';
import { Role } from './role/role';
import { Stores } from './store/stores';
import { Tag } from './tag/tag';
import { AdminUsers } from './user/user';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const data = signal<unknown>(undefined);
const refetch = vi.fn();
let lastParams: (() => unknown) | undefined;
const query = (params?: () => unknown, extra?: () => unknown) => {
	lastParams = params;
	params?.();
	extra?.();
	return { data, refetch };
};

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => client,
	injectMutation: (build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: () => void }) => {
		const options = build();
		return { mutate: (vars: unknown) => void options.mutationFn(vars).then(() => options.onSuccess?.()) };
	},
}));
vi.mock('@jsverse/transloco', async (original) => ({
	...(await original<object>()),
	translateSignal: (key: string) => () => key,
}));
vi.mock('@data-access/queries/admin-customers.queries', () => ({
	injectAdminCustomersQuery: (p: () => unknown, v: () => unknown) => query(p, v),
}));
vi.mock('@data-access/queries/admin-users.queries', () => ({ injectAdminUsersQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/faq.queries', () => ({ injectFaqsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/product.queries', () => ({ injectCatalogProductsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/review.queries', () => ({
	injectModerationReviewsQuery: (p: () => unknown) => query(p),
}));
vi.mock('@data-access/queries/role.queries', () => ({ injectRolesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/store.queries', () => ({ injectStoresQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/tag.queries', () => ({ injectTagsQuery: (p: () => unknown) => query(p) }));

const render = <T>(type: Type<T>, providers: unknown[] = [], url = '/list', template = '') => {
	const router = { url, navigateByUrl: vi.fn(), navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }, ...(providers as never[])] });
	TestBed.overrideComponent(type, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router };
};
const settle = async () => {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

afterEach(() => {
	data.set(undefined);
	refetch.mockClear();
	client.invalidateQueries.mockClear();
});

describe('Customer list', () => {
	const setup = () => {
		const gateway = { softDelete: vi.fn(() => of({})), restore: vi.fn(() => of({})) };
		const notification = { showSuccess: vi.fn() };
		const parts = render(Customer, [
			{ provide: AdminCustomersGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notification },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		]);
		return { ...parts, gateway, notification };
	};

	it('fills the table, falling back through the names', () => {
		const { page } = setup();
		expect(page.tableConfig().total).toBe(0);
		data.set({
			items: [
				{ id: 'c1', displayName: 'Asha', email: 'a@b.co', phone: '+91', createdAt: 'now', status: 'active' },
				{ id: 'c2', email: 'b@c.co', status: 'active' },
				{ id: 'c3', status: 'deleted' },
			],
			meta: { total: 3 },
		});
		TestBed.tick();
		const rows = page.tableConfig().data as { name: string; email: string; phone: string; created_at: unknown }[];
		expect(rows.map((row) => row.name)).toEqual(['Asha', 'b@c.co', 'c3']);
		expect(rows[2]).toMatchObject({ email: '', phone: '', created_at: null });
		expect(page.tableConfig().total).toBe(3);
		expect(page.viewOptions()).toHaveLength(2);
	});

	it('turns the table state into list parameters', () => {
		const { page } = setup();
		page.onTableChange({ page: 2, paginate: 10, search: ' asha ' });
		page.onTableChange({ search: '   ' });
		page.onTableChange({ search: 5 });
		page.onTableChange();
		expect(page.view()).toBe('live');
	});

	it('switches views, returning to the first page and keeping the search', () => {
		const { page } = setup();
		page.onViewChange({ value: 'live' } as never);
		expect(page.view()).toBe('live');
		page.onTableChange({ search: 'asha', paginate: 10 });
		page.onViewChange({ value: 'deleted' } as never);
		expect(page.view()).toBe('deleted');
		page.onTableChange({});
		page.onViewChange({ value: 'other' } as never);
		expect(page.view()).toBe('live');
	});

	it('edits a live customer only', () => {
		const { page, router } = setup();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'c1', status: 'deleted' } } as never);
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'c1', status: 'active' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/customer/edit/c1');
	});

	it('deletes and restores, then refreshes', async () => {
		const { page, gateway, notification } = setup();
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'c1' } } as never);
		page.onActionClicked({ actionToPerform: 'restore', data: { id: 'c1' } } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		await settle();
		expect(gateway.softDelete).toHaveBeenCalledWith('c1');
		expect(gateway.restore).toHaveBeenCalledWith('c1');
		expect(notification.showSuccess).toHaveBeenCalledWith('customer_deleted_successfully');
		expect(notification.showSuccess).toHaveBeenCalledWith('customer_restored');
	});
});

describe('Admin users list', () => {
	const setup = () => {
		const gateway = { setStatus: vi.fn(() => of(undefined)) };
		return { ...render(AdminUsers, [{ provide: AdminUsersGateway, useValue: gateway }]), gateway };
	};

	it('fills the table, falling back through the names', () => {
		const { page } = setup();
		expect(page.tableConfig().total).toBe(0);
		data.set({
			items: [
				{ id: 'u1', displayName: 'Asha', email: 'a@b.co', role: 'admin', createdAt: 'now', status: 'active' },
				{ id: 'u2', username: 'bina', role: 'staff', status: 'disabled' },
				{ id: 'u3', email: 'c@d.co', role: 'staff', status: 'disabled' },
				{ id: 'u4', role: 'staff', status: 'disabled' },
			],
			meta: { total: 4 },
		});
		TestBed.tick();
		const rows = page.tableConfig().data as { name: string; status: string }[];
		expect(rows.map((row) => row.name)).toEqual(['Asha', 'bina', 'c@d.co', 'u4']);
		expect(rows.map((row) => row.status)).toEqual(['1', '0', '0', '0']);
		page.onTableChange({ page: 1 });
	});

	it('edits and sets a status', async () => {
		const { page, router, gateway } = setup();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'u1' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/admin-user/edit/u1');
		page.onActionClicked({ actionToPerform: 'status', data: { id: 'u1', status: 1 } } as never);
		page.onActionClicked({ actionToPerform: 'status', data: { id: 'u1', status: 0 } } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		await settle();
		expect(gateway.setStatus).toHaveBeenCalledWith('u1', { status: 'active' });
		expect(gateway.setStatus).toHaveBeenCalledWith('u1', { status: 'disabled' });
		expect(client.invalidateQueries).toHaveBeenCalled();
	});
});

describe('Role list', () => {
	const setup = () => {
		const gateway = { remove: vi.fn(() => of(undefined)) };
		return { ...render(Role, [{ provide: AdminRolesGateway, useValue: gateway }]), gateway };
	};

	it('fills the table', () => {
		const { page } = setup();
		data.set({ data: [{ id: 'r1' }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		page.onTableChange({ page: 1 });
	});

	it('protects system roles from edit and delete', async () => {
		const { page, router, gateway } = setup();
		for (const role of [
			{ id: 'r1', isSystem: true },
			{ id: 'r2', system_reserve: '1' },
		]) {
			page.onActionClicked({ actionToPerform: 'edit', data: role } as never);
			page.onActionClicked({ actionToPerform: 'delete', data: role } as never);
		}
		await settle();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		expect(gateway.remove).not.toHaveBeenCalled();
	});

	it('edits and deletes a custom role', async () => {
		const { page, router, gateway } = setup();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'r1' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/role/edit/r1');
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'r1' } } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		await settle();
		expect(gateway.remove).toHaveBeenCalledWith('r1');
		expect(client.invalidateQueries).toHaveBeenCalled();
	});

	it('deletes in bulk, skipping protected rows', async () => {
		const { page, gateway } = setup();
		data.set({
			data: [{ id: 'r1' }, { id: 'r2', isSystem: true }, { id: 'r3', system_reserve: '1' }],
			total: 3,
		});
		TestBed.tick();
		page.onActionClicked({ actionToPerform: 'deleteAll', data: ['r1', 'r2', 'r3', 'r9'] } as never);
		page.deleteAll(undefined as never);
		await settle();
		expect(gateway.remove.mock.calls.map(([id]) => id)).toEqual(['r1', 'r9']);
	});
});

describe('Tag list', () => {
	it('fills the table and opens the right edit screen', () => {
		const { fixture, page, router } = render(Tag);
		expect(page.tableConfig.total).toBe(0);
		data.set({ data: [{ id: 1 }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig.total).toBe(1);
		page.onTableChange({ page: 1 });
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/tag/edit/1');
		fixture.componentRef.setInput('tagType', 'post');
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/blog/tag/edit/1');
		fixture.componentRef.setInput('tagType', null);
		TestBed.tick();
		expect(lastParams?.()).toEqual({ page: 1, type: undefined });
		for (const actionToPerform of ['status', 'delete', 'deleteAll', 'other']) {
			page.onActionClicked({ actionToPerform, data: {} } as never);
		}
	});
});

describe('Stores list', () => {
	it('names the vendor on each row and opens a row', () => {
		const { page, router } = render(Stores);
		expect(page.tableConfig.data).toEqual([]);
		data.set({ data: [{ id: 1, vendor: { name: 'Asha' } }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig.data).toMatchObject([{ vendor_name: 'Asha' }]);
		data.set({});
		TestBed.tick();
		expect(page.tableConfig.data).toEqual([]);
		page.onTableChange({ page: 1 });
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/store/edit/1');
		for (const actionToPerform of ['is_approved', 'delete', 'deleteAll', 'other']) {
			page.onActionClicked({ actionToPerform, data: {} } as never);
		}
	});
});

const productDeps = () => [
	{ provide: ProductService, useValue: { goLive: vi.fn() } },
	{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
	{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
];

describe('Product list', () => {
	it('passes only a text search on to the catalogue', () => {
		const { page } = render(Product, productDeps());
		const params = lastParams;
		page.onTableChange({ search: 'silk', page: 2, paginate: 30 });
		expect(params?.()).toEqual({ search: 'silk', page: 2, pageSize: 30 });
		page.onTableChange({ search: 5 });
		expect(params?.()).toEqual({ search: undefined, page: 1, pageSize: 15 });
	});

	it('maps the catalogue rows', () => {
		const { page } = render(Product, productDeps());
		expect(page.tableConfig().total).toBe(0);
		data.set({
			items: [
				{
					id: 'p1',
					slug: 's',
					title: 'T',
					sku: 'K',
					sellingFromINR: 10,
					thumbnailUrl: 'u',
					stock: 2,
					status: 'live',
				},
				{
					id: 'p2',
					slug: 's',
					title: 'T',
					sku: 'K',
					sellingFromINR: 10,
					thumbnailUrl: null,
					stock: 0,
					status: 'draft',
				},
			],
			total: 2,
		});
		TestBed.tick();
		expect(page.tableConfig().data![0]).toMatchObject({ product_thumbnail: { original_url: 'u' }, status: 1 });
		expect(page.tableConfig().data![0]?.stock).toContain('in stock');
		expect(page.tableConfig().data![1]).toMatchObject({ product_thumbnail: null, status: 0 });
		expect(page.tableConfig().data![1]?.stock).toContain('out of stock');
	});

	it('opens a row, and passes the table state to the query', () => {
		const { page, router } = render(Product, productDeps());
		page.onTableChange({ search: 'silk', page: 2, paginate: 10 });
		TestBed.tick();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'p1' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product/edit/p1');
		for (const actionToPerform of ['is_approved', 'status', 'delete', 'deleteAll', 'duplicate', 'other']) {
			page.onActionClicked({ actionToPerform, data: {} } as never);
		}
	});
});

describe('FAQ list', () => {
	const setup = () => {
		const service = { save: vi.fn(() => of({})), remove: vi.fn(() => of({})) };
		return { ...render(Faq, [{ provide: FaqService, useValue: service }]), service };
	};

	it('fills the table', () => {
		const { page } = setup();
		expect(page.tableConfig().total).toBe(0);
		data.set({ data: [{ id: 1 }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		page.onTableChange({ page: 1 });
	});

	it('edits, flips the status and deletes', () => {
		const { page, router, service } = setup();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/faq/edit/1');
		page.onActionClicked({ actionToPerform: 'status', data: { id: 1, status: true } } as never);
		expect(service.save).toHaveBeenCalledWith({ id: 1, status: false });
		page.onActionClicked({ actionToPerform: 'delete', data: { faqId: 'f1' } } as never);
		expect(service.remove).toHaveBeenCalledWith('f1');
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(refetch).toHaveBeenCalledTimes(2);
	});

	it('deletes the chosen rows together', () => {
		const { page, service } = setup();
		data.set({
			data: [
				{ id: 1, faqId: 'f1' },
				{ id: 2, faqId: 'f2' },
			],
			total: 2,
		});
		TestBed.tick();
		page.onActionClicked({ actionToPerform: 'deleteAll', data: [2] } as never);
		expect(service.remove).toHaveBeenCalledWith('f2');
		expect(service.remove).toHaveBeenCalledOnce();
		expect(refetch).toHaveBeenCalledOnce();
	});
});

describe('Review moderation', () => {
	const setup = () => {
		const gateway = { moderate: vi.fn(() => of({})) };
		const modal = { open: vi.fn() };
		const queries = { invalidateQueries: vi.fn(async () => undefined) };
		const notification = { showSuccess: vi.fn(), showError: vi.fn() };
		const parts = render(
			Review,
			[
				{ provide: ReviewsGateway, useValue: gateway },
				{ provide: NgbModal, useValue: modal },
				{ provide: QueryClient, useValue: queries },
				{ provide: NotificationService, useValue: notification },
			],
			'/review',
			'<ng-template #photosModal></ng-template>',
		);
		parts.fixture.detectChanges();
		return { ...parts, gateway, modal, queries, notification };
	};
	const row = (photos: unknown[], extra: Record<string, unknown> = {}) => ({
		review: { id: 'r1', userId: 'u1', productId: 'p1', rating: 5, status: 'pending', ...extra },
		photos,
	});

	it('maps the rows, falling back to the ids', () => {
		const { page } = setup();
		expect(page.tableConfig().total).toBe(0);
		data.set({
			items: [
				{ ...row([{ thumbUrl: 't' }]), productName: 'Red', customerName: 'Asha' },
				row([{ thumbUrl: null }]),
				row([]),
			],
			total: 3,
		});
		TestBed.tick();
		const rows = page.tableConfig().data as Record<string, unknown>[];
		expect(rows[0]).toMatchObject({ consumer_name: 'Asha', product_name: 'Red', photo_count: 1 });
		expect(rows[1]).toMatchObject({ product_review_image: null, consumer_name: 'u1', product_name: 'p1' });
		expect(rows[2]).toMatchObject({ product_review_image: null });
		page.onTableChange({ page: 1 });
	});

	it('opens the photos', async () => {
		const { page, modal } = setup();
		await page.onActionClicked({
			actionToPerform: 'photos',
			data: { source: { photos: [{ assetId: 'a' }] } },
		} as never);
		expect(page.openPhotos()).toEqual([{ assetId: 'a' }]);
		expect(modal.open).toHaveBeenCalledOnce();
	});

	it('ignores an unknown action', async () => {
		const { page, gateway } = setup();
		await page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(gateway.moderate).not.toHaveBeenCalled();
	});

	it('approves and rejects, then refreshes', async () => {
		const { page, gateway, queries, notification } = setup();
		await page.onActionClicked({ actionToPerform: 'approve', data: { id: 'r1' } } as never);
		expect(gateway.moderate).toHaveBeenCalledWith('r1', 'approve');
		expect(notification.showSuccess).toHaveBeenLastCalledWith('Review approved.');
		await page.onActionClicked({ actionToPerform: 'reject', data: { id: 'r1' } } as never);
		expect(notification.showSuccess).toHaveBeenLastCalledWith('Review rejected.');
		expect(queries.invalidateQueries).toHaveBeenCalledTimes(2);
	});

	it('says when moderation fails', async () => {
		const { page, gateway, notification } = setup();
		gateway.moderate.mockReturnValue(throwError(() => new Error('down')) as never);
		await page.onActionClicked({ actionToPerform: 'approve', data: { id: 'r1' } } as never);
		expect(notification.showError).toHaveBeenCalledOnce();
	});
});

describe('Redirects', () => {
	const rows = [
		{ id: '1', sourcePath: '/old', statusCode: 301, targetPath: '/new', reason: 'manual' },
		{ id: '2', sourcePath: '/gone', statusCode: 410, reason: 'slug_change' },
	];
	const setup = (url = '/redirect', answer: unknown = of(rows)) => {
		const api = {
			list: vi.fn(() => answer),
			remove: vi.fn(() => of(undefined)),
			save: vi.fn(() => of({})),
		};
		return { ...render(Redirect, [{ provide: RedirectService, useValue: api }], url), api };
	};

	it('loads the list and knows its mode', () => {
		const { page } = setup();
		expect(page.tableConfig().total).toBe(2);
		expect(page.formOnly()).toBe(false);
		expect(setup('/redirect/create').page.formOnly()).toBe(true);
	});

	it('shows nothing when the list fails', () => {
		expect(
			setup(
				'/redirect',
				throwError(() => new Error('down')),
			).page.tableConfig().total,
		).toBe(0);
	});

	it('fills the form from the address, locking automatic rows', () => {
		const manual = setup(`/redirect/edit/${encodeURIComponent('/old')}?x=1`).page;
		expect(manual.form.getRawValue()).toMatchObject({ sourcePath: '/old', statusCode: '301', targetPath: '/new' });
		expect(manual.form.controls.sourcePath.disabled).toBe(false);
		const automatic = setup(`/redirect/edit/${encodeURIComponent('/gone')}`).page;
		expect(automatic.form.controls.sourcePath.disabled).toBe(true);
		expect(automatic.form.getRawValue().targetPath).toBe('');
		const unknown = setup('/redirect/edit/nope').page;
		expect(unknown.form.getRawValue().sourcePath).toBe('');
	});

	it('filters by text and reason', () => {
		const { page } = setup();
		page.onTableChange({ search: 'NEW' });
		expect(page.tableConfig().total).toBe(1);
		page.onTableChange();
		expect(page.tableConfig().total).toBe(2);
		page.setReason('slug_change');
		expect(page.tableConfig().total).toBe(1);
	});

	it('edits and deletes a row', () => {
		const { page, router, api } = setup();
		page.onAction({ actionToPerform: 'edit', data: rows[0] } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/redirect/edit', encodeURIComponent('/old')]);
		page.onAction({ actionToPerform: 'delete', data: rows[0] } as never);
		expect(api.remove).toHaveBeenCalledWith('/old');
		expect(api.list).toHaveBeenCalledTimes(2);
		page.onAction({ actionToPerform: 'other', data: rows[0] } as never);
	});

	it('saves each status, dropping the target for a 410', () => {
		const { page, api } = setup();
		page.save();
		expect(api.save).not.toHaveBeenCalled();
		for (const [statusCode, expected] of [
			['301', 301],
			['302', 302],
			['410', 410],
		] as const) {
			page.form.patchValue({ sourcePath: '/a', statusCode, targetPath: '/b' });
			page.save();
			expect(api.save.mock.lastCall).toBeDefined();
			expect((api.save.mock.lastCall as unknown[])[0]).toMatchObject({ statusCode: expected });
		}
		expect((api.save.mock.lastCall as unknown[])[0]).toMatchObject({ targetPath: undefined });
		expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/redirect']);
	});

	it('says when a save is refused', () => {
		const { page, api } = setup();
		api.save.mockReturnValue(throwError(() => new Error('refused')) as never);
		page.form.patchValue({ sourcePath: '/a' });
		page.save();
		expect(page.error()).toBe('redirect_rejected');
	});
});

describe('Add-on templates', () => {
	const chest = { code: 'chest', label: { en: 'Chest', fr: 'Poitrine' }, unit: 'in', min: 24, max: 50, step: 0.5 };
	const rows = [{ code: 'fall', label: { en: 'Fall', fr: 'Pli' }, priceINR: 100, fields: [chest] }];
	const setup = (url = '/addon-template', answer: unknown = of(rows)) => {
		const api = { list: vi.fn(() => answer), remove: vi.fn(() => of(undefined)), save: vi.fn(() => of({})) };
		return { ...render(AddonTemplate, [{ provide: AddonTemplateService, useValue: api }], url), api };
	};

	it('loads the list, or nothing on failure', () => {
		expect(setup().page.tableConfig().data).toEqual([{ ...rows[0], id: 'fall', name: 'Fall' }]);
		const bare = setup('/addon-template', of([{ code: 'x', label: {}, priceINR: 0, fields: [] }]));
		expect(bare.page.tableConfig().data[0]).toMatchObject({ name: 'x' });
		expect(
			setup(
				'/addon-template',
				throwError(() => new Error('down')),
			).page.tableConfig().total,
		).toBe(0);
	});

	it('fills the form from the address', () => {
		const { page } = setup('/addon-template/edit/fall?x=1');
		expect(page.form.getRawValue()).toMatchObject({ code: 'fall', label: 'Fall', priceINR: 100 });
		expect(page.measures()).toEqual([chest]);
		expect(page.missing()).toEqual({ en: 0, fr: 0 });
		expect(setup('/addon-template/edit/none').page.form.getRawValue().code).toBe('');
		expect(setup('/addon-template/create').page.formOnly()).toBe(true);
	});

	it('finds a template that has no English name by its code', () => {
		const { page } = setup('/addon-template', of([{ code: 'bare', label: {}, priceINR: 0, fields: [] }]));
		page.onTableChange({ search: 'bare' });
		expect(page.tableConfig().total).toBe(1);
	});

	it('edits fields in the language on screen, and counts what is missing', () => {
		const { page } = setup('/addon-template/create');
		expect(page.missing()).toEqual({ en: 0, fr: 0 });
		expect(page.onSourceLanguage).toBe(true);
		page.addField();
		page.addField();
		page.setLabel(0, page.measures()[0] as never, 'Waist');
		page.setUnit(0, 'cm');
		page.setUnit(1, 'in');
		page.setLimit(0, 'min', '22');
		page.setLimit(0, 'max', '');
		expect(page.measures()[0]).toMatchObject({ label: { en: 'Waist' }, unit: 'cm', min: 22, max: null });
		expect(page.guide(page.measures()[0] as never)).toBe('Waist');
		expect(page.guide(page.measures()[1] as never)).toBe('');
		page.switchLanguage('fr');
		expect(page.onSourceLanguage).toBe(false);
		page.setLabel(0, page.measures()[0] as never, 'Taille');
		expect(page.measures()[0]?.label).toEqual({ en: 'Waist', fr: 'Taille' });
		expect(page.missing()['fr']).toBe(2);
		page.removeField(1);
		expect(page.measures()).toHaveLength(1);
	});

	it('filters by text', () => {
		const { page } = setup();
		page.onTableChange({ search: 'zzz' });
		expect(page.tableConfig().total).toBe(0);
		page.onTableChange();
		expect(page.tableConfig().total).toBe(1);
	});

	it('edits under whichever section it was opened from, and deletes', () => {
		const { page, router, api } = setup();
		page.onAction({ actionToPerform: 'edit', data: rows[0] } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/addon-template', 'edit', 'fall']);
		const other = setup('/measurement');
		other.page.edit(rows[0] as never);
		expect(other.router.navigate).toHaveBeenCalledWith(['/measurement', 'edit', 'fall']);
		page.onAction({ actionToPerform: 'delete', data: rows[0] } as never);
		expect(api.remove).toHaveBeenCalledWith('fall');
		page.onAction({ actionToPerform: 'other', data: rows[0] } as never);
	});

	it('needs an English name and a code, then saves and returns to the list', () => {
		const { page, api, router } = setup('/measurement/create');
		page.switchLanguage('fr');
		page.save();
		expect(page.onSourceLanguage).toBe(true);
		expect(page.form.controls.label.errors).toEqual({ required: true });
		page.form.patchValue({ label: 'Blouse' });
		page.save();
		expect(api.save).not.toHaveBeenCalled();
		page.form.patchValue({ code: 'c', priceINR: '50' as never });
		page.addField();
		page.addField();
		page.setLabel(0, page.measures()[0] as never, 'Upper Arm');
		page.save();
		expect((api.save.mock.lastCall as unknown[])[0]).toMatchObject({
			code: 'c',
			label: { en: 'Blouse' },
			priceINR: 50,
			fields: [{ code: 'upper-arm', label: { en: 'Upper Arm' } }],
		});
		expect(router.navigate).toHaveBeenLastCalledWith(['/measurement']);
	});

	it('keeps the code of a saved field', () => {
		const { page, api } = setup('/addon-template/edit/fall');
		page.save();
		expect((api.save.mock.lastCall as unknown[])[0]).toMatchObject({ fields: [{ code: 'chest' }] });
	});
});
