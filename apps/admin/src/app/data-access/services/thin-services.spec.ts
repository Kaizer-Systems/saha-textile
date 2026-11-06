import { HttpClient } from '@angular/common/http';
import { NgZone, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddonTemplateService } from './addon-template.service';
import { AttachmentService } from './attachment.service';
import { AttributeService } from './attribute.service';
import { AuthService } from './auth.service';
import { BlogService } from './blog.service';
import { CartService } from './cart.service';
import { CategoryService } from './category.service';
import { CountryService } from './country.service';
import { CouponService } from './coupon.service';
import { CurrencyService } from './currency.service';
import { CustomerLedgerService } from './customer-ledger.service';
import { DashboardService } from './dashboard.service';
import { ErrorService } from './error.service';
import { FaqService } from './faq.service';
import { LoggingService } from './logging.service';
import { NavService } from './nav.service';
import { NotificationService } from './notification.service';
import { OrderStatusService } from './order-status.service';
import { OrderService } from './order.service';
import { PageService } from './page.service';
import { PointService } from './point.service';
import { ProductService } from './product.service';
import { QuestionsAnswersService } from './questions-answers.service';
import { RedirectService } from './redirect.service';
import { RefundService } from './refund.service';
import { ReviewService } from './review.service';
import { SettingService } from './setting.service';
import { ShippingService } from './shipping.service';
import { StateService } from './state.service';
import { StoreService } from './store.service';
import { TagService } from './tag.service';
import { TaxService } from './tax.service';
import { ThemeOptionService } from './theme-option.service';

const http = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const lastUrl = (call: typeof http.get) => String(call.mock.lastCall?.[0]);

beforeEach(() => {
	for (const call of Object.values(http)) call.mockReset().mockReturnValue(of({}));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
});

describe('read services', () => {
	it.each<[string, () => unknown, string]>([
		['attachments', () => TestBed.inject(AttachmentService).getAttachments({ a: 1 }), '/media.json'],
		['attributes', () => TestBed.inject(AttributeService).getAttributes({ a: 1 }), '/attribute.json'],
		[
			'attribute values',
			() => TestBed.inject(AttributeService).getAttributeValues({ a: 1 }),
			'/attribute-value.json',
		],
		['blogs', () => TestBed.inject(BlogService).getBlogs({ a: 1 }), '/blog.json'],
		['categories', () => TestBed.inject(CategoryService).getCategories({ a: 1 }), '/category.json'],
		['coupons', () => TestBed.inject(CouponService).getCoupons({ a: 1 }), '/coupon.json'],
		['currencies', () => TestBed.inject(CurrencyService).getCurrencies({ a: 1 }), '/currency.json'],
		['ledger', () => TestBed.inject(CustomerLedgerService).getUserTransaction({ a: 1 }), '/wallet.json'],
		['order status', () => TestBed.inject(OrderStatusService).getOrderStatus({ a: 1 }), '/order-status.json'],
		['orders', () => TestBed.inject(OrderService).getOrders({ a: 1 }), '/order.json'],
		['pages', () => TestBed.inject(PageService).getPages({ a: 1 }), '/page.json'],
		['points', () => TestBed.inject(PointService).getUserTransaction({ a: 1 }), '/point.json'],
		['products', () => TestBed.inject(ProductService).getProducts({ a: 1 }), '/product.json'],
		['refunds', () => TestBed.inject(RefundService).getRefunds({ a: 1 }), '/refund.json'],
		['reviews', () => TestBed.inject(ReviewService).getReviews({ a: 1 }), '/review.json'],
		['stores', () => TestBed.inject(StoreService).getStores({ a: 1 }), '/store.json'],
		['tags', () => TestBed.inject(TagService).getTags({ a: 1 }), '/tag.json'],
		['taxes', () => TestBed.inject(TaxService).getTaxes({ a: 1 }), '/tax.json'],
	])('%s passes its parameters', (_name, call, path) => {
		call();
		expect(lastUrl(http.get)).toContain(path);
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { a: 1 } });
	});

	it.each<[string, () => unknown, string]>([
		['cart', () => TestBed.inject(CartService).getCartItems(), '/cart.json'],
		['countries', () => TestBed.inject(CountryService).getCountries(), '/country.json'],
		['counts', () => TestBed.inject(DashboardService).getStatisticsCount(), '/count.json'],
		['chart', () => TestBed.inject(DashboardService).getRevenueChart(), '/chart.json'],
		['badges', () => TestBed.inject(NavService).getBadges(), '/badge.json'],
		['settings', () => TestBed.inject(SettingService).getSettingOption(), '/setting.json'],
		['backend settings', () => TestBed.inject(SettingService).getBackendSettingOption(), '/setting.json'],
		['states', () => TestBed.inject(StateService).getStates(), '/state.json'],
		['theme options', () => TestBed.inject(ThemeOptionService).getThemeOption(), '/theme-option.json'],
	])('%s reads its file', (_name, call, path) => {
		call();
		expect(lastUrl(http.get)).toContain(path);
	});

	it('wraps the shipping list with its total', async () => {
		http.get.mockReturnValue(of([{ id: 1 }]));
		await expect(firstValueFrom(TestBed.inject(ShippingService).getShippings())).resolves.toEqual({
			data: [{ id: 1 }],
			total: 1,
		});
	});

	it('creates the empty auth service', () => {
		expect(TestBed.inject(AuthService)).toBeInstanceOf(AuthService);
	});
});

describe('AddonTemplateService', () => {
	it('lists, saves and removes', () => {
		const service = TestBed.inject(AddonTemplateService);
		service.list();
		expect(lastUrl(http.get)).toMatch(/\/admin\/catalog\/addon-templates$/);
		service.save({ code: 'fall', label: 'Fall', priceINR: 100 });
		expect(http.post.mock.lastCall?.[1]).toMatchObject({ code: 'fall' });
		service.remove('fall pico');
		expect(lastUrl(http.delete)).toMatch(/addon-templates\/fall%20pico$/);
	});
});

describe('RedirectService', () => {
	it('lists, saves and removes by source path', () => {
		const service = TestBed.inject(RedirectService);
		service.list();
		expect(lastUrl(http.get)).toMatch(/\/admin\/catalog\/redirects$/);
		service.save({ sourcePath: '/a', statusCode: 301, targetPath: '/b', reason: 'x' });
		expect(http.post.mock.lastCall?.[1]).toMatchObject({ sourcePath: '/a' });
		service.remove('/a');
		expect(http.delete.mock.lastCall?.[1]).toEqual({ params: { sourcePath: '/a' } });
	});
});

describe('FaqService', () => {
	const service = () => TestBed.inject(FaqService);
	const row = {
		id: 'f1',
		question: { en: 'Q', fr: 'Qf' },
		answer: { en: 'A' },
		status: 'live',
		scope: 'global',
		categoryIds: [],
		productIds: [],
	};

	it('maps each row for the table', async () => {
		http.get.mockReturnValue(
			of({
				items: [row, { ...row, question: { en: 'Q' }, answer: { en: 'A', fr: 'Af' }, status: 'draft' }],
				total: 2,
			}),
		);
		const page = await firstValueFrom(service().getFaqs({ page: 1 }));
		expect(page.total).toBe(2);
		expect(page.data[0]).toMatchObject({ id: 1, faqId: 'f1', titleFr: 'Qf', descriptionFr: '', status: true });
		expect(page.data[1]).toMatchObject({ titleFr: '', descriptionFr: 'Af', status: false });
	});

	it('saves a full row', () => {
		service().save({
			faqId: 'f1',
			title: 'Q',
			description: 'A',
			titleFr: 'Qf',
			descriptionFr: 'Af',
			status: true,
			scope: 'product' as never,
			categoryIds: ['c'],
			productIds: ['p'],
		});
		expect(http.post.mock.lastCall?.[1]).toEqual({
			id: 'f1',
			question: { en: 'Q', fr: 'Qf' },
			answer: { en: 'A', fr: 'Af' },
			scope: 'product',
			categoryIds: ['c'],
			productIds: ['p'],
			status: 'live',
		});
	});

	it('fills the defaults for a minimal row', () => {
		service().save({ title: 'Q', description: 'A', status: false });
		expect(http.post.mock.lastCall?.[1]).toMatchObject({
			question: { en: 'Q', fr: undefined },
			scope: 'global',
			categoryIds: [],
			productIds: [],
			status: 'draft',
		});
	});

	it('removes by id', () => {
		service().remove('f 1');
		expect(lastUrl(http.delete)).toMatch(/\/faq\/f%201$/);
		service().remove(undefined);
		expect(lastUrl(http.delete)).toMatch(/\/faq\/$/);
	});
});

describe('ProductService catalogue', () => {
	const service = () => TestBed.inject(ProductService);

	it('sends only the parameters it was given', () => {
		service().getCatalogProducts({});
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: {} });
		service().getCatalogProducts({ search: 'silk', page: 2, pageSize: 10 });
		expect(http.get.mock.lastCall?.[1]).toEqual({ params: { search: 'silk', page: '2', pageSize: '10' } });
	});

	it('reads, saves and retires a product, escaping its id', () => {
		service().getCatalogProduct('red saree');
		expect(lastUrl(http.get)).toMatch(/\/products\/red%20saree$/);
		service().getReplacementTargets();
		expect(lastUrl(http.get)).toMatch(/\/products\/replacement-targets$/);
		service().saveCatalogProduct('red saree', { name: 'x' } as never);
		expect(lastUrl(http.post)).toMatch(/\/products\/red%20saree$/);
		service().discontinueCatalogProduct('red', '/collections');
		expect(lastUrl(http.post)).toMatch(/\/red\/discontinue$/);
		expect(http.post.mock.lastCall?.[1]).toEqual({ replacementPath: '/collections' });
	});
});

describe('QuestionsAnswersService', () => {
	const service = () => TestBed.inject(QuestionsAnswersService);

	it('maps each row, filling a missing answer', async () => {
		http.get.mockReturnValue(
			of({
				items: [
					{ id: 'q1', question: 'Q', answer: 'A', productId: 'p1', createdAt: 'now' },
					{ id: 'q2', question: 'Q', answer: null, productId: 'p1' },
				],
				total: 2,
			}),
		);
		const page = await firstValueFrom(service().getQuestionAnswers());
		expect(page.data[0]).toMatchObject({ id: 1, questionId: 'q1', answer: 'A', product: { name: 'p1' } });
		expect(page.data[1]).toMatchObject({ answer: '' });
	});

	it('posts an answer', () => {
		service().answer('q 1', 'Yes');
		expect(lastUrl(http.post)).toMatch(/\/questions\/q%201\/answer$/);
		expect(http.post.mock.lastCall?.[1]).toEqual({ answer: 'Yes' });
	});
});

describe('NotificationService', () => {
	const setup = () => {
		const toastr = { success: vi.fn(), error: vi.fn() };
		const modal = { dismissAll: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: HttpClient, useValue: http },
				{ provide: ToastrService, useValue: toastr },
				{ provide: NgbModal, useValue: modal },
			],
		});
		TestBed.inject(NgZone);
		return { service: TestBed.inject(NotificationService), toastr, modal };
	};

	it('shows a success, closes modals and tells subscribers', () => {
		const { service, toastr, modal } = setup();
		const seen: unknown[] = [];
		service.alertSubject.subscribe((value) => seen.push(value));
		service.showSuccess('Saved');
		expect(toastr.success).toHaveBeenCalledWith('Saved');
		expect(modal.dismissAll).toHaveBeenCalledOnce();
		expect(seen).toEqual([{ type: 'success', message: 'Saved' }]);
	});

	it('shows an error', () => {
		const { service, toastr } = setup();
		service.showError('Failed');
		expect(toastr.error).toHaveBeenCalledWith('Failed');
	});

	it.each(['', '  ', undefined as unknown as string])('stays quiet for %j', (message) => {
		const { service, toastr } = setup();
		service.showSuccess(message);
		service.showError(message);
		expect(toastr.success).not.toHaveBeenCalled();
		expect(toastr.error).not.toHaveBeenCalled();
	});

	it('stays quiet when switched off', () => {
		const { service, toastr } = setup();
		service.notification = false;
		service.showSuccess('x');
		service.showError('x');
		expect(toastr.success).not.toHaveBeenCalled();
		expect(toastr.error).not.toHaveBeenCalled();
	});

	it('reads the notifications', () => {
		const { service } = setup();
		service.getNotifications({ a: 1 });
		expect(lastUrl(http.get)).toContain('/notification.json');
	});
});

describe('ErrorService', () => {
	const service = (platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
		return TestBed.inject(ErrorService);
	};

	it('says when the browser is offline, and never touches navigator on the server', () => {
		vi.stubGlobal('navigator', { onLine: false });
		expect(service().getClientErrorMessage(new Error('x'))).toBe('No internet connection.');
		expect(service('server').getClientErrorMessage(new Error('x'))).toBe('Something went wrong. Please try again.');
		vi.unstubAllGlobals();
	});

	it('reads the API message, or the generic one', () => {
		const refusal = { error: { code: 'x', message: 'Readable' } };
		expect(service().getClientErrorMessage(refusal)).toBe('Readable');
		expect(service().getClientErrorMessage(new Error('x'))).toBe('Something went wrong. Please try again.');
	});

	it('reads a server error, or its own message', () => {
		expect(
			service().getServerErrorMessage({ error: { code: 'x', message: 'Readable' }, message: 'raw' } as never),
		).toBe('Readable');
		expect(service().getServerErrorMessage({ message: 'raw' } as never)).toBe('raw');
	});
});

describe('LoggingService', () => {
	it('logs', () => {
		const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		TestBed.inject(LoggingService).logError('boom');
		expect(logged).toHaveBeenCalledWith('LoggingService: boom');
		logged.mockRestore();
	});
});
