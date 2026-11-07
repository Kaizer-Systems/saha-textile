import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { AdminNotificationsGateway } from '@core/admin-notifications/admin-notifications.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { ReviewsGateway } from '@core/media/reviews.gateway';
import { AttributeService } from '@data-access/services/attribute.service';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { CountryService } from '@data-access/services/country.service';
import { CouponService } from '@data-access/services/coupon.service';
import { CurrencyService } from '@data-access/services/currency.service';
import { DashboardService } from '@data-access/services/dashboard.service';
import { FaqService } from '@data-access/services/faq.service';
import { NotificationService } from '@data-access/services/notification.service';
import { OrderStatusService } from '@data-access/services/order-status.service';
import { OrderService } from '@data-access/services/order.service';
import { PageService } from '@data-access/services/page.service';
import { ProductService } from '@data-access/services/product.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { RefundService } from '@data-access/services/refund.service';
import { ReviewService } from '@data-access/services/review.service';
import { ShippingService } from '@data-access/services/shipping.service';
import { StateService } from '@data-access/services/state.service';
import { StoreService } from '@data-access/services/store.service';
import { TagService } from '@data-access/services/tag.service';
import { TaxService } from '@data-access/services/tax.service';

import {
	injectAdminCustomerOrdersQuery,
	injectAdminCustomerQuery,
	injectAdminCustomersQuery,
} from './admin-customers.queries';
import {
	injectNotificationChannelsQuery,
	injectNotificationProviderQuery,
	injectNotificationTemplatesQuery,
} from './admin-notifications.queries';
import { injectAdminUserAuthorityQuery, injectAdminUsersQuery, injectRolesForInviteQuery } from './admin-users.queries';
import { injectAttachmentsQuery } from './attachment.queries';
import { injectAttributesQuery } from './attribute.queries';
import { injectBlogsQuery } from './blog.queries';
import { injectCategoriesQuery } from './category.queries';
import { injectCountriesQuery } from './country.queries';
import { injectCouponQuery, injectCouponsQuery } from './coupon.queries';
import { injectCurrenciesQuery } from './currency.queries';
import { injectRevenueChartQuery, injectStatisticsQuery } from './dashboard.queries';
import { injectFaqsQuery } from './faq.queries';
import { injectNotificationsQuery } from './notification.queries';
import { injectOrderStatusQuery } from './order-status.queries';
import { injectOrdersQuery } from './order.queries';
import { injectPagesQuery } from './page.queries';
import { injectCatalogProductsQuery, injectProductsQuery } from './product.queries';
import { injectQuestionAnswersQuery } from './questions-answers.queries';
import { injectRefundsQuery } from './refund.queries';
import { injectModerationReviewsQuery, injectReviewsQuery } from './review.queries';
import {
	injectRoleModulesQuery,
	injectRoleQuery,
	injectRolesQuery,
	permissionsToModules,
	toRoleRow,
} from './role.queries';
import { injectShippingsQuery } from './shipping.queries';
import { injectStatesQuery } from './state.queries';
import { injectStoresQuery } from './store.queries';
import { injectTagQuery, injectTagsQuery } from './tag.queries';
import { injectTaxesQuery } from './tax.queries';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
}

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (options: () => Options) => options,
}));

const answer = vi.fn(() => of<unknown>({ ok: true }));
const service = (...methods: string[]) => Object.fromEntries(methods.map((name) => [name, answer]));

beforeEach(() => {
	answer.mockReset().mockReturnValue(of({ ok: true }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: AdminCustomersGateway,
				useValue: service('list', 'listDeleted', 'get', 'listOrders'),
			},
			{
				provide: AdminNotificationsGateway,
				useValue: service('providerStatus', 'listChannels', 'listTemplates'),
			},
			{ provide: AdminUsersGateway, useValue: service('list', 'authority', 'listRoles') },
			{ provide: AdminRolesGateway, useValue: service('list', 'get', 'listPermissions') },
			{ provide: MediaGateway, useValue: service('library') },
			{ provide: ReviewsGateway, useValue: service('list') },
			{ provide: AttributeService, useValue: service('getAttributes', 'getAttributeValues') },
			{ provide: BlogService, useValue: service('getBlogs') },
			{ provide: CategoryService, useValue: service('getCategories') },
			{ provide: CountryService, useValue: service('getCountries') },
			{ provide: CouponService, useValue: service('getCoupons') },
			{ provide: CurrencyService, useValue: service('getCurrencies') },
			{ provide: DashboardService, useValue: service('getStatisticsCount', 'getRevenueChart') },
			{ provide: FaqService, useValue: service('getFaqs') },
			{ provide: NotificationService, useValue: service('getNotifications') },
			{ provide: OrderStatusService, useValue: service('getOrderStatus') },
			{ provide: OrderService, useValue: service('getOrders') },
			{ provide: PageService, useValue: service('getPages') },
			{ provide: ProductService, useValue: service('getProducts', 'getCatalogProducts') },
			{ provide: QuestionsAnswersService, useValue: service('getQuestionAnswers') },
			{ provide: RefundService, useValue: service('getRefunds') },
			{ provide: ReviewService, useValue: service('getReviews') },
			{ provide: ShippingService, useValue: service('getShippings') },
			{ provide: StateService, useValue: service('getStates') },
			{ provide: StoreService, useValue: service('getStores') },
			{ provide: TagService, useValue: service('getTags') },
			{ provide: TaxService, useValue: service('getTaxes') },
		],
	});
});

const options = (build: () => unknown): Options => (TestBed.runInInjectionContext(build) as unknown as () => Options)();
const params = () => ({ status: 1 });

describe('list queries', () => {
	it.each<[string, () => unknown, unknown[]]>([
		['customers', () => injectAdminCustomersQuery(params as never), ['admin-customers', 'live', { status: 1 }]],
		['provider', () => injectNotificationProviderQuery(), ['admin-notifications', 'provider']],
		['channels', () => injectNotificationChannelsQuery(), ['admin-notifications', 'channels']],
		['templates', () => injectNotificationTemplatesQuery(), ['admin-notifications', 'templates']],
		['users', () => injectAdminUsersQuery(params as never), ['admin-users', { status: 1 }]],
		['invite roles', () => injectRolesForInviteQuery(), ['admin-roles']],
		['attributes', () => injectAttributesQuery(params), ['attributes', { status: 1 }]],
		['blogs', () => injectBlogsQuery(params), ['blogs', { status: 1 }]],
		['categories', () => injectCategoriesQuery(params), ['categories', { status: 1 }]],
		['countries', () => injectCountriesQuery(), ['countries']],
		['coupons', () => injectCouponsQuery(params), ['coupons', { status: 1 }]],
		['currencies', () => injectCurrenciesQuery(params), ['currencies', { status: 1 }]],
		['statistics', () => injectStatisticsQuery(), ['dashboard-statistics']],
		['revenue', () => injectRevenueChartQuery(), ['dashboard-revenue-chart']],
		['FAQs', () => injectFaqsQuery(params), ['faqs', { status: 1 }]],
		['notifications', () => injectNotificationsQuery(params), ['notifications', { status: 1 }]],
		['default notifications', () => injectNotificationsQuery(), ['notifications', {}]],
		['order status', () => injectOrderStatusQuery(params), ['order-status', { status: 1 }]],
		['orders', () => injectOrdersQuery(params), ['orders', { status: 1 }]],
		['pages', () => injectPagesQuery(params), ['pages', { status: 1 }]],
		['products', () => injectProductsQuery(params), ['products', { status: 1 }]],
		['catalog products', () => injectCatalogProductsQuery(() => ({ page: 1 })), ['catalog-products', { page: 1 }]],
		['questions', () => injectQuestionAnswersQuery(params), ['question-answers', { status: 1 }]],
		['refunds', () => injectRefundsQuery(params), ['refunds', { status: 1 }]],
		['reviews', () => injectReviewsQuery(params), ['reviews', { status: 1 }]],
		['shipping', () => injectShippingsQuery(params), ['shippings', { status: 1 }]],
		['states', () => injectStatesQuery(), ['states']],
		['stores', () => injectStoresQuery(params), ['stores', { status: 1 }]],
		['tags', () => injectTagsQuery(params), ['tags', { status: 1 }]],
		['taxes', () => injectTaxesQuery(params), ['taxes', { status: 1 }]],
	])('%s has its key and fetches', async (_name, build, key) => {
		const query = options(build);
		expect(query.queryKey).toEqual(key);
		await expect(query.queryFn()).resolves.toEqual({ ok: true });
		expect(answer).toHaveBeenCalledOnce();
	});
});

describe('customer queries', () => {
	it('reads the deleted list', async () => {
		const gateway = TestBed.inject(AdminCustomersGateway);
		await options(() =>
			injectAdminCustomersQuery(
				() => ({}) as never,
				() => 'deleted',
			),
		).queryFn();
		expect(gateway.listDeleted).toHaveBeenCalledOnce();
	});

	it('needs an id for one customer and their orders', async () => {
		const customer = options(() => injectAdminCustomerQuery(() => 'c1'));
		expect(customer.enabled).toBe(true);
		await customer.queryFn();
		const orders = options(() =>
			injectAdminCustomerOrdersQuery(
				() => 'c1',
				() => ({ page: 1 }),
			),
		);
		await orders.queryFn();
		expect(answer).toHaveBeenCalledTimes(2);
		const none = options(() => injectAdminCustomerQuery(() => null));
		expect(none.enabled).toBe(false);
		expect(() => none.queryFn()).toThrow('customerId is required');
		const noOrders = options(() =>
			injectAdminCustomerOrdersQuery(
				() => null,
				() => ({}),
			),
		);
		expect(() => noOrders.queryFn()).toThrow('customerId is required');
	});
});

describe('user and role queries', () => {
	it('needs an id for a user authority', async () => {
		await options(() => injectAdminUserAuthorityQuery(() => 'u1')).queryFn();
		expect(answer).toHaveBeenCalledOnce();
		const none = options(() => injectAdminUserAuthorityQuery(() => null));
		expect(none.enabled).toBe(false);
		expect(() => none.queryFn()).toThrow('userId is required');
	});

	const role = {
		id: 'r1',
		key: 'staff',
		label: 'Staff',
		baseRole: 'staff',
		permissions: ['a'],
		isSystem: true,
		createdAt: 'c',
		updatedAt: 'u',
	} as const;

	it('turns a role into a table row', () => {
		expect(toRoleRow({ ...role, permissions: [...role.permissions] })).toMatchObject({
			name: 'Staff',
			description: null,
			system_reserve: '1',
			created_at: 'c',
		});
		expect(
			toRoleRow({
				...role,
				isSystem: false,
				description: 'D',
				createdAt: undefined,
				updatedAt: undefined,
				permissions: undefined,
			} as never),
		).toMatchObject({ description: 'D', system_reserve: '0', created_at: null, updated_at: null, permissions: [] });
	});

	it('lists the roles, and treats a bare answer as none', async () => {
		answer.mockReturnValue(of({ items: [{ ...role }] }));
		await expect(options(() => injectRolesQuery()).queryFn()).resolves.toMatchObject({ total: 1 });
		answer.mockReturnValue(of({}));
		await expect(options(() => injectRolesQuery(params)).queryFn()).resolves.toEqual({ data: [], total: 0 });
	});

	it('reads one role, and needs an id', async () => {
		answer.mockReturnValue(of({ ...role }));
		await expect(options(() => injectRoleQuery(() => 'r1')).queryFn()).resolves.toMatchObject({ id: 'r1' });
		const none = options(() => injectRoleQuery(() => null));
		expect(none.enabled).toBe(false);
		expect(() => none.queryFn()).toThrow('roleId is required');
	});

	it('groups permissions by resource', async () => {
		const items = [
			{ code: 'a.read', resource: 'a', action: 'read' },
			{ code: 'a.write', resource: 'a', action: 'write' },
			{ code: 'b.read', resource: 'b', action: 'read' },
		];
		const modules = permissionsToModules(items);
		expect(modules.map((module) => module.module_permissions.length)).toEqual([2, 1]);
		answer.mockReturnValue(of({ items }));
		await expect(options(() => injectRoleModulesQuery()).queryFn()).resolves.toHaveLength(2);
		answer.mockReturnValue(of({}));
		await expect(options(() => injectRoleModulesQuery()).queryFn()).resolves.toEqual([]);
	});
});

describe('media and moderation queries', () => {
	it('reads the library, defaulting the paging', async () => {
		await options(() => injectAttachmentsQuery(() => ({}))).queryFn();
		expect(answer).toHaveBeenLastCalledWith({ search: undefined, page: 1, pageSize: 48 });
		await options(() => injectAttachmentsQuery(() => ({ search: 'x', page: 2, paginate: 10 }))).queryFn();
		expect(answer).toHaveBeenLastCalledWith({ search: 'x', page: 2, pageSize: 10 });
	});

	it('reads reviews for moderation, defaulting the paging', async () => {
		await options(() => injectModerationReviewsQuery(() => ({}))).queryFn();
		expect(answer).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, status: undefined });
		await options(() =>
			injectModerationReviewsQuery(() => ({ page: 2, paginate: 5, status: 'pending' })),
		).queryFn();
		expect(answer).toHaveBeenLastCalledWith({ page: 2, pageSize: 5, status: 'pending' });
	});
});

describe('single-row queries', () => {
	it('finds a coupon and a tag by id', async () => {
		answer.mockReturnValue(of({ data: [{ id: 3 }] }));
		await expect(options(() => injectCouponQuery(() => 3)).queryFn()).resolves.toEqual({ id: 3 });
		await expect(options(() => injectTagQuery(() => 3)).queryFn()).resolves.toEqual({ id: 3 });
		await expect(options(() => injectCouponQuery(() => 4)).queryFn()).resolves.toBeNull();
		await expect(options(() => injectTagQuery(() => 4)).queryFn()).resolves.toBeNull();
	});

	it('waits for an id', () => {
		expect(options(() => injectCouponQuery(() => undefined)).enabled).toBe(false);
		expect(options(() => injectTagQuery(() => undefined)).enabled).toBe(false);
	});
});
