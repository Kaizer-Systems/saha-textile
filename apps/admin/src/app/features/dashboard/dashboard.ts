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

import { TranslocoModule } from '@jsverse/transloco';
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
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IRevenueChart, IStatisticsCount } from '@data-access/interfaces/dashboard.interface';
import { IOrder, IOrderModel } from '@data-access/interfaces/order.interface';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { IReviewModel } from '@data-access/interfaces/review.interface';
import { IStoresModel } from '@data-access/interfaces/store.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectRevenueChartQuery, injectStatisticsQuery } from '@data-access/queries/dashboard.queries';
import { injectOrdersQuery } from '@data-access/queries/order.queries';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { injectReviewsQuery } from '@data-access/queries/review.queries';
import { injectStoresQuery } from '@data-access/queries/store.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe as CurrencySymbolPipe_1, CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Table } from '@shared/ui/table/table';

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
		HasPermissionDirective,
		Select2Module,
		Table,
		RouterModule,
		NgbRating,
		SlicePipe,
		DatePipe,
		TranslocoModule,
		CurrencySymbolPipe_1,
		AsyncPipe,
		DatePipe,
		SlicePipe,
	],
})
export class Dashboard {
	private renderer = inject(Renderer2);
	private platformId = inject(PLATFORM_ID);
	private document = inject<Document>(DOCUMENT);
	private router = inject(Router);
	private accountStore = inject(AccountStore);

	private readonly statisticsQuery = injectStatisticsQuery();
	statistics$: Observable<IStatisticsCount | undefined> = toObservable(this.statisticsQuery.data);
	private readonly revenueChartQuery = injectRevenueChartQuery();
	revenueChart$: Observable<IRevenueChart | undefined> = toObservable(this.revenueChartQuery.data);
	private readonly orderParams = signal<Params>({});
	private readonly ordersQuery = injectOrdersQuery(() => this.orderParams());
	order$: Observable<IOrderModel | undefined> = toObservable(this.ordersQuery.data);

	private readonly productParams = signal<Params>({});
	private readonly productsQuery = injectProductsQuery(() => this.productParams());
	product$: Observable<IProductModel | undefined> = toObservable(this.productsQuery.data);

	private readonly topProductParams = signal<Params>({
		status: 1,
		top_selling: 1,
		filter_by: 'this_year',
		paginate: 5,
	});
	private readonly topProductsQuery = injectProductsQuery(() => this.topProductParams());
	topProduct$: Observable<IProduct[]> = toObservable(
		computed(() => this.topProductsQuery.data()?.data.slice(0, 7) ?? []),
	);

	private readonly reviewsQuery = injectReviewsQuery(() => ({ paginate: 5 }));
	review$: Observable<IReviewModel | undefined> = toObservable(this.reviewsQuery.data);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
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

	private readonly sellerParams = signal<Params>({ paginate: 6, top_vendor: 1, filter_by: 'this_year' });
	readonly storesQuery = injectStoresQuery(() => this.sellerParams());
	store$: Observable<IStoresModel | undefined> = toObservable(this.storesQuery.data);

	user$: Observable<IAccountUser | null> = toObservable(this.accountStore.user);
	readonly chart = viewChild.required<ElementRef>('chart');
	public chartOptions!: Partial<ChartOptions>;
	// Revenue is no longer persisted, so it arrives asynchronously. We create the chart once BOTH the
	// view is ready AND the options are built, then updateOptions() on any later revenue change.
	private chartInstance?: { updateOptions: (o: unknown) => void; render: () => void };
	private viewReady = false;

	public topProductLoader: boolean = false;
	public productStockLoader: boolean = false;
	public topSellerLoader: boolean = false;
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

	public sellerTableConfig: ITableConfig = {
		columns: [
			{ title: 'store_name', dataField: 'store_name' },
			{ title: 'orders', dataField: 'orders_count' },
			{ title: 'earning', dataField: 'order_amount' },
		],
		data: [],
		total: 0,
	};

	public orderTableConfig: ITableConfig = {
		columns: [
			{ title: 'number', dataField: 'order_id' },
			{ title: 'date', dataField: 'created_at', type: 'date', date_format: 'dd MMM yyyy' },
			{ title: 'name', dataField: 'consumer_name' },
			{ title: 'amount', dataField: 'total', type: 'price' },
			{ title: 'payment', dataField: 'order_payment_status' },
		],
		rowActions: [{ label: 'View', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'order.edit' }],
		data: [],
		total: 0,
	};

	public productStockTableConfig: ITableConfig = {
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
				label: 'Edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'product.edit',
			},
		],
		data: [] as IProduct[],
		total: 0,
	};

	constructor() {
		const config = inject(NgbRatingConfig);
		const platformId = this.platformId;

		this.isBrowser = isPlatformBrowser(platformId);
		config.max = 5;
		config.readonly = true;

		// Revenue & Commision Chart
		this.revenueChart$.subscribe((revenue) => {
			if (revenue) {
				this.chartOptions = {
					series: [
						{
							name: 'Revenue',
							data: revenue.revenues,
							color: '#0da487',
						},
						{
							name: 'Comission',
							data: revenue.commissions,
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
						categories: revenue.months,
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

		// For Order
		this.order$.subscribe((order) => {
			this.orderTableConfig.data = order ? order?.data.slice(0, 5) : [];
			this.orderTableConfig.total = order ? order?.total : 0;
		});

		this.order$.subscribe((order) => {
			let orders = order?.data?.filter((element: IOrder) => {
				element.order_id = `<span class="fw-bolder">#${element.order_number}</span>`;
				element.order_payment_status = element.payment_status
					? `<div class="status-${element.payment_status.toLowerCase()}"><span>${element.payment_status.replace(/_/g, ' ')}</span></div>`
					: '-';
				element.consumer_name = `<span class="text-capitalize">${element.consumer.name}</span>`;
				return element;
			});
			this.orderTableConfig.data = order ? orders?.slice(0, 5) : [];
			this.orderTableConfig.total = order ? order?.total : 0;
		});

		// For Product
		this.product$.subscribe((product) => {
			let products = product?.data?.filter((element: IProduct) => {
				element.stock = element.stock_status
					? `<div class="status-${element.stock_status}"><span>${element.stock_status.replace(/_/g, ' ')}</span></div>`
					: '-';
				return element;
			});
			this.productStockTableConfig.data = product ? products.slice(0, 8) : [];
			this.productStockTableConfig.total = product ? product?.total : 0;
		});

		// For Store
		this.store$.subscribe((store) => {
			this.sellerTableConfig.data = store ? store?.data?.slice(0, 6) : [];
			this.sellerTableConfig.total = store ? store?.total : 0;
		});

		effect(() => {
			this.topSellerLoader = this.storesQuery.isFetching();
		});
		effect(() => {
			this.topProductLoader = this.topProductsQuery.isFetching();
		});
		effect(() => {
			this.productStockLoader = this.productsQuery.isFetching();
		});
	}

	ngAfterViewInit() {
		this.viewReady = true;
		void this.renderChart();
	}

	// Creates + renders the ApexChart exactly once, only when the view is ready AND options are built.
	private async renderChart() {
		if (!isPlatformBrowser(this.platformId)) return;
		if (this.chartInstance || !this.viewReady || !this.chartOptions) return;
		const ApexCharts = (await import('apexcharts')).default;
		const element = this.chart().nativeElement;
		this.chartInstance = new ApexCharts(element, this.chartOptions);
		void this.chartInstance.render();
	}

	filterTopProduct(data: Select2UpdateEvent) {
		this.renderer.addClass(this.document.body, 'loader-none');
		let params: Params = { status: 1, top_selling: 1, filter_by: 'this_year', paginate: 5 };
		if (data.value) {
			params['filter_by'] = data.value;
		}
		this.topProductParams.set({ ...params });
	}

	// For Order

	onOrderTableChange(data?: Params) {
		if (data) {
			data['paginate'] = 7;
		}
		this.orderParams.set({ ...data });
	}

	onOrderActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'view') this.orderView(action.data);
	}

	orderView(data: IOrder) {
		void this.router.navigateByUrl(`/order/details/${data.order_number}`);
	}

	// For Products

	onProductTableChange(data?: Params) {
		if (data) {
			data['paginate'] = 8;
			data['field'] = 'quantity';
			data['sort'] = 'asc';
		}
		this.productParams.set({ ...data });
	}

	filterProduct(data: Select2UpdateEvent) {
		this.renderer.addClass(this.document.body, 'loader-none');
		let params: Params = {
			paginate: 8,
			field: 'quantity',
			sort: 'asc',
		};
		if (data.value) {
			params['category_ids'] = data.value;
		}
		this.productStockLoader = true;
		this.onProductTableChange(params);
	}

	onProductActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.productEdit(action.data);
	}

	productEdit(data: IProduct) {
		void this.router.navigateByUrl(`/product/edit/${data.id}`);
	}

	// For Seller

	onSellerTableChange(data?: Params) {
		if (data && !data['filter_by']) {
			data['paginate'] = 6;
			data['top_vendor'] = 1;
			data['filter_by'] = 'this_year';
		}
		this.sellerParams.set({ ...data });
	}

	filterSeller(data: Select2UpdateEvent) {
		this.renderer.addClass(this.document.body, 'loader-none');
		let params: Params = {
			paginate: 6,
			top_vendor: 1,
			filter_by: 'this_year',
		};
		if (data.value) {
			params['filter_by'] = data.value;
		}
		this.topSellerLoader = true;
		this.onSellerTableChange(params);
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
