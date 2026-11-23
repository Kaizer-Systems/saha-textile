import { DatePipe, isPlatformBrowser, SlicePipe, AsyncPipe } from '@angular/common';
import {
	Component,
	computed,
	effect,
	ElementRef,
	inject,
	PLATFORM_ID,
	Renderer2,
	signal,
	DOCUMENT,
	viewChild,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbRating, NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import {
	ApexAxisChartSeries,
	ApexChart,
	ApexDataLabels,
	ApexFill,
	ApexGrid,
	ApexLegend,
	ApexMarkers,
	ApexResponsive,
	ApexStroke,
	ApexTitleSubtitle,
	ApexTooltip,
	ApexXAxis,
	ApexYAxis,
} from 'ng-apexcharts';
import { Select2Data, Select2, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { intlLocale } from '@core/i18n/localized-fields';
import { ORDER_STATUS_PILL } from '@core/orders/order-format';
import { pill } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { injectStoreLocationsQuery } from '@core/stores/store-location.gateway';
import { IBaseRow, ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import {
	injectDashboardCustomersQuery,
	injectDashboardMonthlyRevenueQuery,
	injectDashboardOrdersQuery,
	injectDashboardRecentOrdersQuery,
	injectDashboardReviewsQuery,
	injectDashboardRevenueQuery,
	injectDashboardStockQuery,
	injectDashboardTopProductsQuery,
	injectRevenueChartQuery,
} from '@data-access/queries/dashboard.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe as CurrencySymbolPipe_1, CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import type { DashboardPeriodQuery, DashboardStockState, I18nString, PermissionCode } from '@saha-textile/contracts';

/**
 * What each widget needs, in one place so the template, the queries and the empty-page message
 * cannot disagree. The Stores tile counts the shop's active stores (Settings › Stores, so super
 * admin only). The `blog.index` widget lists the two newest blog posts from the blog API.
 */
const WIDGET_PERMISSIONS: readonly PermissionCode[] = [
	'dashboard.revenue',
	'dashboard.orders',
	'dashboard.customers',
	'dashboard.top_products',
	'dashboard.stock',
	'dashboard.reviews',
	'setting.index',
	'blog.index',
];

export interface ChartOptions {
	series: ApexAxisChartSeries;
	chart: ApexChart;
	xaxis: ApexXAxis;
	yaxis: ApexYAxis;
	stroke: ApexStroke;
	tooltip: ApexTooltip;
	dataLabels: ApexDataLabels;
	fill: ApexFill;
	title: ApexTitleSubtitle;
	grid: ApexGrid;
	markers: ApexMarkers;
	legend: ApexLegend;
	responsive: ApexResponsive[];
}
@Component({
	selector: 'app-dashboard',
	templateUrl: './dashboard.html',
	styleUrls: ['./dashboard.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		PageWrapper,
		PeriodPicker,
		HasPermissionDirective,
		Select2,
		Table,
		RouterModule,
		NgbRating,
		SlicePipe,
		DatePipe,
		TranslocoModule,
		CurrencySymbolPipe_1,
		AsyncPipe,
	],
})
export class Dashboard {
	private renderer = inject(Renderer2);
	private platformId = inject(PLATFORM_ID);
	private document = inject<Document>(DOCUMENT);
	private router = inject(Router);
	private authStore = inject(AuthStore);
	private transloco = inject(TranslocoService);

	/** Hides nothing by itself: the template and queries read it, and the API decides. */
	private can(code: PermissionCode): boolean {
		return this.authStore.permissions().includes(code);
	}

	readonly hasAnyWidget = computed(() => WIDGET_PERMISSIONS.some((code) => this.can(code)));

	readonly revenuePeriod = signal<DashboardPeriodQuery>({ period: 'last_12_months' });
	readonly ordersPeriod = signal<DashboardPeriodQuery>({ period: 'last_12_months' });
	private readonly topProductPeriod = signal<DashboardPeriodQuery>({ period: 'this_year' });
	private readonly stockCategory = signal<string | undefined>(undefined);

	private readonly revenueQuery = injectDashboardRevenueQuery(
		() => this.revenuePeriod(),
		() => this.can('dashboard.revenue'),
	);
	readonly revenue = computed(() => this.revenueQuery.data()?.revenueINR);

	private readonly ordersQuery = injectDashboardOrdersQuery(
		() => this.ordersPeriod(),
		() => this.can('dashboard.orders'),
	);
	readonly orderCount = computed(() => this.ordersQuery.data()?.orders);

	private readonly customersQuery = injectDashboardCustomersQuery(() => this.can('dashboard.customers'));
	readonly customerCount = computed(() => this.customersQuery.data()?.customers);

	private readonly monthlyRevenueQuery = injectDashboardMonthlyRevenueQuery(() => this.can('dashboard.revenue'));
	private readonly recentOrdersQuery = injectDashboardRecentOrdersQuery(() => this.can('dashboard.orders'));

	private readonly topProductsQuery = injectDashboardTopProductsQuery(
		() => this.topProductPeriod(),
		() => this.can('dashboard.top_products'),
	);
	readonly topProducts = computed(() => this.topProductsQuery.data()?.items ?? []);

	private readonly stockQuery = injectDashboardStockQuery(
		() => this.stockCategory(),
		() => this.can('dashboard.stock'),
	);

	private readonly reviewsQuery = injectDashboardReviewsQuery(() => this.can('dashboard.reviews'));
	readonly reviews = computed(() => this.reviewsQuery.data()?.items ?? []);

	private readonly blogsQuery = injectBlogsQuery(
		() => ({ status: 1, paginate: 2 }),
		() => this.can('blog.index'),
	);
	readonly blogs = computed(() => this.blogsQuery.data()?.data ?? []);

	/** The Stores tile: how many stores show on Contact Us. */
	private readonly storesQuery = injectStoreLocationsQuery(() => this.can('setting.index'));
	readonly activeStores = computed(() => (this.storesQuery.data() ?? []).filter((row) => row.store.active).length);

	/** Demo data for the commission line, kept until that line is replaced. */
	private readonly commissionQuery = injectRevenueChartQuery();

	private readonly categoriesQuery = injectCategoriesQuery(
		() => ({ type: 'product', status: 1 }),
		() => this.can('category.index'),
	);
	category$: Observable<Select2Data> = toObservable(
		computed(
			() =>
				this.categoriesQuery.data()?.data.map((res) => ({
					label: res?.name,
					value: res?.id,
					data: {
						name: res.name,
						slug: res.slug,
						image: res.category_icon ? res.category_icon.original_url : 'assets/images/category.png',
					},
				})) ?? [],
		),
	);

	readonly chart = viewChild<ElementRef>('chart');
	public chartOptions!: Partial<ChartOptions>;
	// The chart sits behind a permission, so its element may arrive after the data or never.
	private chartInstance?: { updateOptions: (o: unknown) => void; render: () => void };

	readonly topProductLoader = computed(() => this.topProductsQuery.isFetching());
	readonly productStockLoader = computed(() => this.stockQuery.isFetching());
	public isBrowser: boolean;

	public filter: Select2Data = [
		{
			value: 'today',
			label: 'Today',
		},
		{
			value: 'last_week',
			label: 'Last Week',
		},
		{
			value: 'last_month',
			label: 'Last Month',
		},
		{
			value: 'this_year',
			label: 'This Year',
		},
	];

	/**
	 * Signals, not plain objects: the query answers outside the render cycle, so a mutated object
	 * never reached a table when no other widget on the page happened to redraw it. Each update
	 * carries `rowActions` over because the table clears them for a role without the action.
	 */
	readonly orderTableConfig = signal<ITableConfig<IBaseRow & { order_number: string }>>({
		columns: [
			{ title: 'number', dataField: 'order_id' },
			{ title: 'date', dataField: 'created_at', type: 'date', date_format: 'dd MMM yyyy' },
			{ title: 'name', dataField: 'consumer_name' },
			{ title: 'amount', dataField: 'total', type: 'price' },
			{ title: 'payment', dataField: 'order_payment_status' },
		],
		rowActions: [{ label: 'view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'order.edit' }],
		data: [],
		total: 0,
	});

	readonly productStockTableConfig = signal<ITableConfig<IBaseRow & { id: string }>>({
		columns: [
			{
				title: 'image',
				dataField: 'product_thumbnail',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'name', dataField: 'name' },
			{ title: 'quantity', dataField: 'quantity' },
			{ title: 'stock', dataField: 'stock' },
		],
		rowActions: [
			{
				label: 'edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'product.edit',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		const config = inject(NgbRatingConfig);
		const platformId = this.platformId;

		this.isBrowser = isPlatformBrowser(platformId);
		config.max = 5;
		config.readonly = true;

		// Revenue is real. The commission line is demo data kept by owner decision, drawn by
		// position against the same twelve months until it is replaced.
		effect(() => {
			const monthly = this.monthlyRevenueQuery.data();
			const commissions = this.commissionQuery.data()?.commissions ?? [];
			if (monthly) {
				this.chartOptions = {
					series: [
						{
							name: 'Revenue',
							data: monthly.months.map((row) => row.revenueINR),
							color: this.themeColor(),
						},
						{
							name: 'Comission',
							data: commissions.slice(0, monthly.months.length),
							color: '#FFA53B',
						},
					],
					chart: {
						height: 350,
						type: 'line',
						dropShadow: {
							enabled: true,
							top: 10,
							left: 0,
							blur: 3,
							color: '#720f1e',
							opacity: 0.1,
						},
						zoom: {
							enabled: false,
						},
					},
					dataLabels: {
						enabled: false,
					},
					markers: {
						strokeWidth: 4,
						strokeColors: '#ffffff',
						hover: {
							size: 9,
						},
					},
					stroke: {
						curve: 'smooth',
						lineCap: 'butt',
						width: 4,
					},
					grid: {
						xaxis: {
							lines: {
								show: true,
							},
						},
						yaxis: {
							lines: {
								show: false,
							},
						},
					},
					legend: {
						show: false,
					},
					responsive: [
						{
							breakpoint: 1200,
							options: {
								grid: {
									padding: {
										right: -95,
									},
								},
							},
						},
						{
							breakpoint: 992,
							options: {
								grid: {
									padding: {
										right: -69,
									},
								},
							},
						},
						{
							breakpoint: 767,
							options: {
								chart: {
									height: 200,
								},
							},
						},
						{
							breakpoint: 576,
							options: {
								yaxis: {
									labels: {
										show: false,
									},
								},
							},
						},
					],
					xaxis: {
						categories: monthly.months.map((row) => this.monthLabel(row.month)),
						range: undefined,
						axisBorder: {
							offsetX: 0,
							show: false,
						},
						axisTicks: {
							show: false,
						},
					},
				};
				// Refresh the chart if already rendered; otherwise render now that options exist.
				if (this.chartInstance) {
					this.chartInstance.updateOptions(this.chartOptions);
				} else {
					void this.renderChart();
				}
			}
		});

		// The chart element may appear after the data, when the permission arrives later.
		effect(() => {
			if (this.chart()) void this.renderChart();
		});

		effect(() => {
			const items = this.recentOrdersQuery.data()?.items ?? [];
			const data = items.map((order) => ({
				id: order.id,
				order_number: order.orderNumber,
				order_id: `<span class="fw-bolder">#${order.orderNumber}</span>`,
				created_at: order.placedAt,
				consumer_name: order.customerName ?? '-',
				total: order.totalINR,
				// The orders list's own pill and wording for each status (brief ol02), so the two never differ.
				order_payment_status: pill(
					ORDER_STATUS_PILL[order.status],
					this.transloco.translate(`ord_status_${order.status}`),
				),
			}));
			this.orderTableConfig.update((config) => ({ ...config, data, total: items.length }));
		});

		effect(() => {
			const items = this.stockQuery.data()?.items ?? [];
			const data = items.map((row) => ({
				id: row.productId,
				product_thumbnail: row.thumbnailUrl ? { original_url: row.thumbnailUrl } : null,
				name: `${this.localized(row.title)} (${row.sku})`,
				quantity: row.quantity,
				stock: this.stockBadge(row.state),
			}));
			this.productStockTableConfig.update((config) => ({ ...config, data, total: items.length }));
		});
	}

	/** A product name in the language the admin is using, falling back to English. */
	localized(title: I18nString): string {
		return title[this.transloco.getActiveLang()] ?? title.en;
	}

	/** `2026-11` as "Nov '26", in the language the admin is using. */
	/**
	 * The chart library needs a real colour, so the revenue line reads the admin's theme colour
	 * (`--theme-color`, Brand Kit) when it draws; the theme's green until one is set.
	 */
	private themeColor(): string {
		const value = this.document.defaultView
			?.getComputedStyle(this.document.documentElement)
			.getPropertyValue('--theme-color')
			.trim();
		return value || '#0da487';
	}

	private monthLabel(month: string): string {
		const name = new Intl.DateTimeFormat(intlLocale(this.transloco.getActiveLang()), {
			month: 'short',
			timeZone: 'UTC',
		});
		return `${name.format(new Date(`${month}-01T00:00:00Z`))} '${month.slice(2, 4)}`;
	}

	private stockBadge(state: DashboardStockState): string {
		return `<div class="status-${state}"><span>${this.transloco.translate(state)}</span></div>`;
	}

	// Creates + renders the ApexChart exactly once, only when the element AND options exist.
	private async renderChart() {
		const element = this.chart()?.nativeElement;
		if (!isPlatformBrowser(this.platformId)) return;
		if (this.chartInstance || !element || !this.chartOptions) return;
		const ApexCharts = (await import('apexcharts')).default;
		// The data and the view can both request a chart while the chunk is loading.
		if (this.chartInstance || this.chart()?.nativeElement !== element) return;
		this.chartInstance = new ApexCharts(element, this.chartOptions);
		void this.chartInstance.render();
	}

	filterTopProduct(data: Select2UpdateEvent) {
		this.renderer.addClass(this.document.body, 'loader-none');
		this.topProductPeriod.set({ period: (data.value as DashboardPeriodQuery['period']) || 'this_year' });
	}

	// For Order

	onOrderActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'view') this.orderView(action.data as { order_number: string });
	}

	orderView(data: { order_number: string }) {
		void this.router.navigateByUrl(`/order/details/${data.order_number}`);
	}

	// For Products

	filterProduct(data: Select2UpdateEvent) {
		this.renderer.addClass(this.document.body, 'loader-none');
		this.stockCategory.set(data.value ? String(data.value) : undefined);
	}

	onProductActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.productEdit(action.data as { id: string });
	}

	productEdit(data: { id: string }) {
		void this.router.navigateByUrl(`/product/edit/${data.id}`);
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
