import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DOCUMENT, inject, input, PLATFORM_ID, Renderer2, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
	AbstractControl,
	FormArray,
	FormBuilder,
	FormControl,
	FormGroup,
	ReactiveFormsModule,
	ValidationErrors,
	Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	NgbAccordionBody,
	NgbAccordionButton,
	NgbAccordionCollapse,
	NgbAccordionDirective,
	NgbAccordionHeader,
	NgbAccordionItem,
	NgbAccordionToggle,
	NgbCalendar,
	NgbCollapse,
	NgbDate,
	NgbDateParserFormatter,
	NgbInputDatepicker,
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import type {
	AttributeDefinition,
	GoLiveGap,
	ProductBundleWrite,
	ProductContentWrite,
	ProductCreate,
	ProductOptionGroup,
} from '@saha-textile/contracts';
import { Select2, Select2Data, Select2SearchEvent } from 'ng-select2-component';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Observable, of, Subject } from 'rxjs';
import { debounceTime, switchMap, takeUntil } from 'rxjs/operators';

import { goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { ADMIN_LOCALES, LocalizedFields, type LocalizedText } from '@core/i18n/localized-fields';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import {
	CATALOG_BADGE_CODES,
	CatalogBadgeCode,
	CatalogProductDetail,
	CatalogProductWrite,
} from '@data-access/interfaces/catalog-product.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { injectTaxesQuery } from '@data-access/queries/tax.queries';
import { AddonTemplateRow, AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { YouTubeVideoField } from '@shared/ui/youtube-video-field/youtube-video-field';
import { priceValidator } from '@shared/validators/price-validator';

import { OptionGroups } from './option-groups/option-groups';
import { ProductBundleForm } from './product-bundle/product-bundle';
import { ImageCombination, ProductImages } from './product-images/product-images';
import { variantCombinations } from './variant-combinations';
import { environment } from '../../../../../public/environments/environment';

const LANGUAGE_FIELDS = ['name', 'short_description', 'description', 'meta_title', 'meta_description', 'estimated_delivery_text'];

const blankToNull = (value: unknown): number | null =>
	value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** MRP may be empty; when set, the selling price may not be above it. */
function sellingWithinMrp(group: AbstractControl): ValidationErrors | null {
	const mrp = blankToNull(group.get('mrp')?.value);
	const selling = blankToNull(group.get('price')?.value);
	return mrp !== null && selling !== null && selling > mrp ? { sellingAboveMrp: true } : null;
}

@Component({
	selector: 'app-form-product',
	templateUrl: './form-product.html',
	styleUrls: ['./form-product.scss'],
	imports: [
		ReactiveFormsModule,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		FormFields,
		NgxEditorModule,
		Select2,
		NgbInputDatepicker,
		Button,
		NgbAccordionDirective,
		NgbAccordionItem,
		NgbAccordionHeader,
		NgbAccordionToggle,
		NgbAccordionButton,
		NgbCollapse,
		NgbAccordionCollapse,
		NgbAccordionBody,
		ImageUpload,
		LanguageSwitch,
		OptionGroups,
		ProductBundleForm,
		ProductImages,
		YouTubeVideoField,
		AdvancedDropdown,
		NgbNavOutlet,
		TranslocoModule,
		AsyncPipe,
		CurrencySymbolPipe,
	],
})
export class FormProduct {
	private productService = inject(ProductService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private http = inject(HttpClient);
	private formBuilder = inject(FormBuilder);
	private calendar = inject(NgbCalendar);
	formatter = inject(NgbDateParserFormatter);
	private renderer = inject(Renderer2);
	private transloco = inject(TranslocoService);
	private document = inject<Document>(DOCUMENT);
	private attributes = inject(AttributeService);
	private templates = inject(AddonTemplateService);
	private notifier = inject(NotificationService);

	readonly type = input<string>(undefined);

	readonly nav = viewChild<NgbNav>('nav');

	private readonly productParams = signal<Params>({
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: 0,
		is_approved: 1,
	});
	private readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: String(this.productParams()['search']) || undefined,
		pageSize: 100,
	}));
	products$: Observable<Select2Data> = toObservable(
		computed(() =>
			(this.productsQuery.data()?.items ?? [])
				.filter((row) => row.id !== this.id)
				.map((row) => ({
					label: row.title,
					value: row.id,
					data: {
						type: row.variantCount > 1 ? 'classified' : 'simple',
						name: row.title,
						slug: row.slug,
						stock_status: row.stock > 0 ? 'in_stock' : 'out_of_stock',
						image: row.thumbnailUrl ?? 'assets/images/product.png',
					},
				})),
		),
	);
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'product', status: 1 }));
	private readonly taxesQuery = injectTaxesQuery(() => ({ status: 1 }));
	readonly taxes = computed(
		() => this.taxesQuery.data()?.data.map((tax) => ({ label: tax.name, value: tax.id })) ?? [],
	);
	public active = 'general';
	public tabError: string | null;
	public form: FormGroup;
	public id: string;
	/** The product as the catalogue API holds it; set on edit. */
	public catalogProduct: CatalogProductDetail | null = null;
	public replacementTargets: Select2Data = [];
	public badgeOptions: Select2Data = [];
	public statusOptions: Select2Data = [];
	public availabilityOptions: Select2Data = [];
	public selectedCategories: string[] = [];
	public selectedTags: Number[] = [];
	public fromDate: NgbDate | null;
	public toDate: NgbDate | null;
	public hoveredDate: NgbDate | null = null;
	public collectionProduct: Select2Data;
	public product: IProduct;
	private destroy$ = new Subject<void>();
	public isBrowser: boolean;

	public productType: Select2Data = [
		{
			value: 'simple',
			label: 'Simple',
		},
		{
			value: 'classified',
			label: 'Variable',
		},
		{
			value: 'bundle',
			label: 'Bundle',
		},
	];

	public stocks: Select2Data = [
		{
			value: 'in_stock',
			label: 'In Stock',
		},
		{
			value: 'out_of_stock',
			label: 'Out of Stock',
		},
	];

	public filter = {
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: 0,
		is_approved: 1,
	};

	private search = new Subject<string>();
	public editor: Editor;
	public html = '';

	readonly locales = ADMIN_LOCALES;
	/** Language-bound fields behind the Language switch. */
	readonly fields: LocalizedFields;
	readonly missing = signal<Record<string, number>>({});
	readonly definitions = signal<AttributeDefinition[]>([]);
	readonly addonTemplates = signal<AddonTemplateRow[]>([]);
	readonly addonTemplateCode = signal<string | null>(null);
	readonly optionGroups = signal<ProductOptionGroup[]>([]);
	readonly images = signal<Pick<ProductContentWrite, 'imageMode' | 'gallery' | 'compound' | 'altOverrides'>>({
		imageMode: 'simple',
		gallery: [],
		compound: [],
		altOverrides: {},
	});
	readonly tiles = signal<ReadonlyMap<string, string>>(new Map());
	readonly bundle = signal<ProductBundleWrite>({
		bundleType: 'fixed_kit',
		pricePolicy: 'sum_components',
		fixedPriceINR: null,
		groups: [],
	});
	readonly goLiveGaps = signal<GoLiveGap[]>([]);
	readonly bundleProducts = signal<Select2Data>([]);

	/** Every combination of the variation axes, for the compound image galleries. */
	readonly combinations = computed<ImageCombination[]>(() => {
		const locale = this.fields.locale();
		return variantCombinations(this.optionGroups()).map(({ selections, hash }) => ({
			hash,
			label: selections
				.map(({ attributeCode, termCode }) => {
					const group = this.optionGroups().find((row) => row.attributeCode === attributeCode);
					const term = group?.terms.find((row) => row.code === termCode);
					return term?.label[locale] ?? term?.label['en'] ?? termCode;
				})
				.join(' / '),
		}));
	});

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			/** Validated YouTube video id for the PDP (catalog chunk persists it). */
			youtube_video_id: new FormControl<string | null>(null),
			name: new FormControl(''),
			short_description: new FormControl(''),
			description: new FormControl(''),
			slug: new FormControl('', [Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
			type: new FormControl('simple', [Validators.required]),
			unit: new FormControl(),
			weight: new FormControl(),
			stock_status: new FormControl('in_stock', []),
			sku: new FormControl('', [Validators.required]),
			quantity: new FormControl('', [Validators.required]),
			price: new FormControl('', [Validators.required, priceValidator]),
			discount: new FormControl(),
			sale_starts_at: new FormControl(),
			sale_expired_at: new FormControl(),
			tags: new FormControl(),
			categories: new FormControl([]),
			is_random_related_products: new FormControl(0),
			related_products: new FormControl(),
			upsell_products: new FormControl([]),
			cross_sell_products: new FormControl([]),
			product_thumbnail_id: new FormControl(),
			product_galleries_id: new FormControl(),
			size_chart_image_id: new FormControl(),
			variations: this.formBuilder.array([], []),
			meta_title: new FormControl(),
			meta_description: new FormControl(),
			product_meta_image_id: new FormControl(),
			safe_checkout: new FormControl(1),
			secure_checkout: new FormControl(1),
			social_share: new FormControl(1),
			encourage_order: new FormControl(1),
			encourage_view: new FormControl(1),
			is_free_shipping: new FormControl(0),
			tax_id: new FormControl(''),
			estimated_delivery_text: new FormControl(),
			made_to_order: new FormControl(false),
			low_stock_threshold: new FormControl(null),
			pinned_badges: new FormControl<CatalogBadgeCode[]>([]),
			hidden_badges: new FormControl<CatalogBadgeCode[]>([]),
			replacement_path: new FormControl<string | null>(null),
			length_cm: new FormControl(),
			width_cm: new FormControl(),
			height_cm: new FormControl(),
			hsn_code: new FormControl(),
			addon_price_inr: new FormControl(null),
			return_policy_text: new FormControl(),
			is_featured: new FormControl(0),
			is_return: new FormControl(1),
			status: new FormControl<string>('disabled'),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, ['estimated_delivery_text']);

		this.transloco.selectTranslation().subscribe(() => this.buildOptions());
	}

	private buildOptions() {
		const t = (key: string) => this.transloco.translate(key);
		this.badgeOptions = CATALOG_BADGE_CODES.map((code) => ({ value: code, label: t(`badge_${code}`) }));
		this.availabilityOptions = [
			{ value: 'available', label: t('available') },
			{ value: 'unavailable', label: t('not_available') },
		];
		// The list never changes shape: a select that loses the current value mid-load clears it,
		// which saved every live product as disabled. Only Go Live can make a product live.
		const current = this.catalogProduct?.status;
		this.statusOptions = ['live', 'draft', 'disabled', 'discontinued'].map((status) => ({
			value: status,
			label: t(`product_status_${status}`),
			disabled: status === 'draft' || (status === 'live' && current !== 'live'),
		}));
	}

	/** Whole-rupee price for a percent off the MRP, rounded half up, shown before save. */
	percentPreview(variation: AbstractControl): { price: number; percent: number } | null {
		const mrp = blankToNull(variation.get('mrp')?.value);
		const selling = blankToNull(variation.get('price')?.value);
		if (mrp === null || selling === null || mrp <= 0 || selling >= mrp) return null;
		return { price: selling, percent: Math.floor(((mrp - selling) / mrp) * 100) };
	}

	applyPercent(variation: AbstractControl) {
		const mrp = blankToNull(variation.get('mrp')?.value);
		const percent = blankToNull(variation.get('discount')?.value);
		if (mrp === null || percent === null) return;
		variation.get('price')?.setValue(this.saleRupee(mrp, percent));
	}

	/** "450 · from product" placeholder for an empty variant measure that inherits. */
	fromProduct(control: string): string {
		const value = this.form.get(control)?.value;
		return value === null || value === undefined || value === ''
			? ''
			: this.transloco.translate('from_product', { value });
	}

	get isDiscontinuing(): boolean {
		return this.form.get('status')?.value === 'discontinued';
	}

	get madeToOrderAllowed(): boolean {
		return this.catalogProduct?.status === 'live' && this.form.get('status')?.value === 'live';
	}

	saleRupee(price: unknown, percent: unknown): number {
		const mrp = Number(price);
		const off = Number(percent);
		if (!Number.isFinite(mrp) || !Number.isFinite(off)) return 0;
		return Math.round((mrp * (100 - off)) / 100);
	}

	/** Fills the form from the catalogue API. Fields the API does not hold keep their defaults. */
	private applyCatalogProduct(detail: CatalogProductDetail) {
		this.catalogProduct = detail;
		this.id = detail.id;
		this.buildOptions();
		this.form.patchValue(
			{
				slug: detail.slug,
				sku: detail.sku,
				type: detail.type === 'variable' ? 'classified' : detail.type,
				weight: detail.shipping.weightGrams,
				length_cm: detail.shipping.lengthCm,
				width_cm: detail.shipping.widthCm,
				height_cm: detail.shipping.heightCm,
				hsn_code: detail.hsnCode,
				made_to_order: detail.madeToOrder,
				low_stock_threshold: detail.lowStockThreshold,
				pinned_badges: detail.pinnedBadges,
				hidden_badges: detail.hiddenBadges,
				replacement_path: detail.replacementPath,
				addon_price_inr: detail.addonPriceINR,
				is_featured: detail.featured,
				status: detail.status,
				related_products: detail.relatedProductIds,
				upsell_products: detail.upsellProductIds,
				cross_sell_products: detail.crossSellProductIds,
			},
			{ emitEvent: false },
		);
		const { content } = detail;
		this.fields.load({
			name: content.title,
			short_description: content.shortDescription,
			description: content.description,
			meta_title: content.metaTitle,
			meta_description: content.metaDescription,
			estimated_delivery_text: content.estimatedDeliveryText,
		});
		this.form.get('type')?.disable({ emitEvent: false });
		this.form.patchValue({ categories: content.categoryIds }, { emitEvent: false });
		this.selectedCategories = content.categoryIds;
		this.optionGroups.set(content.optionGroups);
		this.addonTemplateCode.set(content.addonTemplateCode);
		this.images.set({
			imageMode: content.imageMode,
			gallery: content.gallery,
			compound: content.compound,
			altOverrides: content.altOverrides,
		});
		this.tiles.set(new Map(detail.images.map((image) => [image.assetId, image.url])));
		this.refreshMissing();
		if (detail.type === 'bundle') {
			this.productService
				.getBundle(detail.id)
				.pipe(takeUntil(this.destroy$))
				.subscribe((saved) => {
					if (saved) this.bundle.set(saved);
				});
		}
		// Price and stock live on the variant rows; the product-level inputs do not apply.
		for (const name of ['price', 'quantity']) this.form.removeControl(name, { emitEvent: false });
		if (detail.published) this.form.get('sku')?.disable({ emitEvent: false });
		this.clearVariations();
		for (const row of detail.variants) {
			const group = this.formBuilder.group(
				{
					id: new FormControl(row.id),
					variation_name: new FormControl(row.label),
					name: new FormControl({ value: row.label, disabled: true }),
					sku: new FormControl({ value: row.sku, disabled: detail.published }, [Validators.required]),
					mrp: new FormControl(row.mrpINR, [Validators.min(0)]),
					price: new FormControl(row.sellingINR, [Validators.required, priceValidator]),
					discount: new FormControl(),
					quantity: new FormControl(row.quantity, [Validators.required, Validators.min(0)]),
					weight_grams: new FormControl(row.weightGrams),
					length_cm: new FormControl(row.lengthCm),
					width_cm: new FormControl(row.widthCm),
					height_cm: new FormControl(row.heightCm),
					barcode: new FormControl(row.barcode),
					hsn: new FormControl(row.hsnCode),
					availability: new FormControl(row.available ? 'available' : 'unavailable', [Validators.required]),
					variation_image_id: new FormControl(),
					variation_image: new FormControl(),
				},
				{ validators: sellingWithinMrp },
			);
			this.variationControl.push(group);
		}
	}

	get variationControl(): FormArray {
		return this.form.get('variations') as FormArray;
	}

	ngOnInit() {
		this.search
			.pipe(debounceTime(300)) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				this.filter['search'] = inputValue;
				this.productParams.set({ ...this.filter });
			});

		this.route.params
			.pipe(
				switchMap((params) => (params['id'] ? this.productService.getCatalogProduct(params['id']) : of(null))),
				takeUntil(this.destroy$),
			)
			.subscribe((detail) => {
				if (detail) this.applyCatalogProduct(detail);
			});
		this.attributes
			.getDefinitions()
			.pipe(takeUntil(this.destroy$))
			.subscribe((rows) => this.definitions.set(rows));
		this.templates.list().pipe(takeUntil(this.destroy$)).subscribe((rows) => this.addonTemplates.set(rows));
		this.productService
			.getReplacementTargets()
			.pipe(takeUntil(this.destroy$))
			.subscribe((targets) => {
				this.replacementTargets = targets
					.filter((target) => target.path !== `/product/${this.catalogProduct?.slug}`)
					.map((target) => ({
						value: target.path,
						label: `${target.label} · ${target.path}`,
					}));
			});

		this.products$.subscribe((product) => {
			this.collectionProduct = product.filter(
				(res) => res?.data?.type == 'simple' && res?.data?.stock_status == 'in_stock',
			);
			this.bundleProducts.set(product.filter((res) => res?.data?.type === 'simple'));
		});

		// Made to order is live-only, and its switch locks once the status leaves live.
		this.form.controls['status'].valueChanges.pipe(takeUntil(this.destroy$)).subscribe((status) => {
			if (status !== 'live') this.form.get('made_to_order')?.setValue(false);
		});

		this.form.controls['type'].valueChanges.subscribe((value) => {
			if (this.catalogProduct) return;
			if (value == 'simple') {
				this.form.setControl('quantity', new FormControl('', [Validators.required]));
				this.form.setControl('price', new FormControl('', [Validators.required]));
				this.form.setControl('discount', new FormControl());
			} else {
				this.form.removeControl('quantity');
				this.form.removeControl('price');
				this.form.removeControl('discount');
			}
		});

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	productFilter(filter: Params) {
		this.filter['search'] = filter['search'];
		this.filter['ids'] = this.filter['search'].length ? '' : this.product?.related_products?.join();
		this.filter['paginate'] =
			this.product?.related_products?.length >= 15 ? this.product?.related_products?.length : 15;
		this.productParams.set({ ...this.filter });
		if (this.isBrowser) {
			this.renderer.addClass(this.document.body, 'loader-none');
		}
	}

	productDropdown(event: Select2) {
		if (event['innerSearchText']) {
			this.search.next('');
		}
	}

	searchProduct(event: Select2SearchEvent) {
		this.search.next(event.search);
	}

	onDateSelection(date: NgbDate) {
		if (!this.fromDate && !this.toDate) {
			this.fromDate = date;
		} else if (this.fromDate && !this.toDate && date && date.after(this.fromDate)) {
			this.toDate = date;
		} else {
			this.toDate = null;
			this.fromDate = date;
		}

		if (this.fromDate)
			this.form.controls['sale_starts_at'].setValue(
				`${this.fromDate.year}-${this.fromDate.month}-${this.fromDate.day}`,
			);
		if (this.toDate)
			this.form.controls['sale_expired_at'].setValue(
				`${this.toDate?.year}-${this.toDate?.month}-${this.toDate?.day}`,
			);
	}

	isHovered(date: NgbDate) {
		return (
			this.fromDate &&
			!this.toDate &&
			this.hoveredDate &&
			date.after(this.fromDate) &&
			date.before(this.hoveredDate)
		);
	}

	isInside(date: NgbDate) {
		return this.toDate && date.after(this.fromDate) && date.before(this.toDate);
	}

	isRange(date: NgbDate) {
		return (
			date.equals(this.fromDate) ||
			(this.toDate && date.equals(this.toDate)) ||
			this.isInside(date) ||
			this.isHovered(date)
		);
	}

	validateInput(currentValue: NgbDate | null, input: string): NgbDate | null {
		const parsed = this.formatter.parse(input);
		return parsed && this.calendar.isValid(NgbDate.from(parsed)) ? NgbDate.from(parsed) : currentValue;
	}

	clearVariations() {
		const variantsControl = this.form.get('variations') as FormArray; // assuming your FormArray group is named 'variations'
		variantsControl.clear(); // remove all the controls from the FormArray
	}

	selectCategoryItem(data: string[]) {
		if (Array.isArray(data)) {
			this.form.controls['categories'].setValue(data);
		}
	}

	selectTagItem(data: Number[]) {
		if (Array.isArray(data)) {
			this.form.controls['tags'].setValue(data);
		}
	}

	selectSizeImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['size_chart_image_id'].setValue(data ? data.id : null);
		}
	}

	selectMetaImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['product_meta_image_id'].setValue(data ? data.id : null);
		}
	}

	selectVariationImage(data: IAttachment, index: number) {
		const variationControl = this.form.get('variations') as FormArray;
		const control = variationControl.at(+index);
		control.patchValue({ variation_image_id: data ? data.id : '' });
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	private refreshMissing() {
		this.missing.set(Object.fromEntries(this.locales.map((locale) => [locale, this.fields.missing(locale)])));
	}

	private content(raw: Record<string, unknown>): ProductContentWrite {
		const text = (field: string): LocalizedText => this.fields.text(field);
		return {
			title: text('name'),
			shortDescription: text('short_description'),
			description: text('description'),
			metaTitle: text('meta_title'),
			metaDescription: text('meta_description'),
			estimatedDeliveryText: text('estimated_delivery_text'),
			categoryIds: Array.isArray(raw['categories']) ? raw['categories'].map(String) : [],
			optionGroups: this.optionGroups(),
			addonTemplateCode: this.addonTemplateCode(),
			...this.images(),
		};
	}

	/** Go Live: the same call and the same toast as the product list. */
	goLive() {
		const product = this.catalogProduct;
		if (!product) return;
		this.productService.goLive(product.id).subscribe((result) => {
			this.goLiveGaps.set(result.gaps);
			goLiveToast(result, this.notifier, (key) => this.transloco.translate(key));
			if (result.live) void this.router.navigateByUrl('/product');
		});
	}

	gapLabels(): string[] {
		return goLiveLabels(this.goLiveGaps(), (key) => this.transloco.translate(key));
	}

	submit() {
		this.form.markAllAsTouched();
		const raw = this.form.getRawValue() as Record<string, unknown>;
		if (!this.fields.text('name')['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			this.nav()?.select('general');
			this.tabError = 'general';
			return;
		}
		const leadTime = textOrNull(this.fields.text('estimated_delivery_text')['en']);
		const leadTimeControl = this.form.get('estimated_delivery_text');
		if (raw['made_to_order'] && !leadTime) leadTimeControl?.setErrors({ leadTimeRequired: true });
		if (!this.form.valid) {
			this.showInvalidTab();
			return;
		}
		const product = this.catalogProduct;
		if (!product) {
			this.create(raw);
			return;
		}
		if (this.isDiscontinuing) {
			this.productService.discontinueCatalogProduct(product.id, textOrNull(raw['replacement_path'])).subscribe({
				next: () => void this.router.navigateByUrl('/product'),
			});
			return;
		}
		this.save(product, raw);
	}

	/** Makes the product, then saves everything typed so far onto it. */
	private create(raw: Record<string, unknown>) {
		const typed = Object.fromEntries(LANGUAGE_FIELDS.map((field) => [field, this.fields.text(field)]));
		const groups = this.optionGroups();
		const images = this.images();
		const body: ProductCreate = {
			type: raw['type'] === 'classified' ? 'variable' : (raw['type'] as ProductCreate['type']),
			sku: String(raw['sku']).trim(),
			title: { en: (typed['name'] as LocalizedText)['en'] as string },
			basePriceINR: blankToNull(raw['price']) ?? 0,
		};
		this.productService
			.createCatalogProduct(body)
			.pipe(switchMap(({ id }) => this.productService.getCatalogProduct(id)))
			.subscribe((detail) => {
				this.applyCatalogProduct(detail);
				this.fields.load({ ...typed });
				this.optionGroups.set(groups);
				this.images.set(images);
				this.variationControl.at(0)?.patchValue({ quantity: blankToNull(raw['quantity']) ?? 0 });
				this.save(detail, this.form.getRawValue() as Record<string, unknown>);
			});
	}

	private save(product: CatalogProductDetail, raw: Record<string, unknown>) {
		const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
		const slug = textOrNull(raw['slug']);
		const body: CatalogProductWrite = {
			sku: String(raw['sku'] ?? product.sku).trim(),
			...(slug && slug !== product.slug ? { slug } : {}),
			status: product.status === 'live' && raw['status'] === 'live' ? 'live' : 'disabled',
			featured: Boolean(raw['is_featured']),
			madeToOrder: Boolean(raw['made_to_order']),
			estimatedDeliveryText: textOrNull(this.fields.text('estimated_delivery_text')['en']),
			lowStockThreshold: blankToNull(raw['low_stock_threshold']),
			pinnedBadges: ids(raw['pinned_badges']) as CatalogBadgeCode[],
			hiddenBadges: ids(raw['hidden_badges']) as CatalogBadgeCode[],
			addonPriceINR: blankToNull(raw['addon_price_inr']),
			shipping: {
				weightGrams: blankToNull(raw['weight']),
				lengthCm: blankToNull(raw['length_cm']),
				widthCm: blankToNull(raw['width_cm']),
				heightCm: blankToNull(raw['height_cm']),
			},
			hsnCode: textOrNull(raw['hsn_code']),
			variants: this.variationControl.controls.map((group) => {
				const row = (group as FormGroup).getRawValue() as Record<string, unknown>;
				return {
					id: String(row['id']),
					sku: String(row['sku']).trim(),
					mrpINR: blankToNull(row['mrp']),
					sellingINR: Math.round(Number(row['price'])),
					quantity: Math.round(Number(row['quantity'])),
					available: row['availability'] !== 'unavailable',
					weightGrams: blankToNull(row['weight_grams']),
					lengthCm: blankToNull(row['length_cm']),
					widthCm: blankToNull(row['width_cm']),
					heightCm: blankToNull(row['height_cm']),
					barcode: textOrNull(row['barcode']),
					hsnCode: textOrNull(row['hsn']),
				};
			}),
			content: this.content(raw),
			relatedProductIds: ids(raw['related_products']),
			upsellProductIds: ids(raw['upsell_products']),
			crossSellProductIds: ids(raw['cross_sell_products']),
		};
		const saved: Observable<unknown> = this.productService.saveCatalogProduct(product.id, body);
		const bundled = product.type === 'bundle' && this.bundle().groups.length > 0;
		const finished = bundled
			? saved.pipe(switchMap(() => this.productService.saveBundle(product.id, this.bundle())))
			: saved;
		finished.subscribe({
			next: () => {
				this.tabError = null;
				void this.router.navigateByUrl('/product');
			},
		});
	}

	private showInvalidTab() {
		if (!this.isBrowser) return;
		const invalidField =
			Object.keys(this.form.controls).find((key) => this.form.controls[key].invalid) ?? 'variations';
		const tab = this.document
			.querySelector(`#${invalidField}, [formarrayname="${invalidField}"]`)
			?.closest('div.tab')
			?.getAttribute('tab');
		if (tab) {
			this.nav()?.select(tab);
			this.tabError = tab;
		}
	}
}
