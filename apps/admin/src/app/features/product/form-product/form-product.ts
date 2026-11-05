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
	NgbDateStruct,
	NgbInputDatepicker,
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { Select2, Select2Data, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Observable, of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';

import { SettingStore } from '@core/state/setting.store';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import {
	CATALOG_BADGE_CODES,
	CatalogBadgeCode,
	CatalogProductDetail,
	CatalogProductWrite,
} from '@data-access/interfaces/catalog-product.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IVariant, IVariation, IVariationCombination } from '@data-access/interfaces/product.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { injectAttributesQuery, injectAttributeValuesQuery } from '@data-access/queries/attribute.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { injectStoresQuery } from '@data-access/queries/store.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { injectTaxesQuery } from '@data-access/queries/tax.queries';
import { ProductService } from '@data-access/services/product.service';
import { environment } from '../../../../../public/environments/environment';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { YouTubeVideoField } from '@shared/ui/youtube-video-field/youtube-video-field';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { priceValidator } from '@shared/validators/price-validator';

function convertToNgbDate(date: NgbDateStruct): NgbDate {
	return new NgbDate(date.year, date.month, date.day);
}

/** Required in the vendor form, but not held by the catalogue API, so an edit never blocks on them. */
const FIELDS_THE_API_DOES_NOT_SAVE = ['short_description', 'description', 'categories', 'tax_id', 'store_id'];

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
		search: String(this.productParams()['search'] ?? '') || undefined,
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
	private readonly storesQuery = injectStoresQuery(() => ({ status: 1, is_approved: 1 }));
	store$: Observable<Select2Data> = toObservable(
		computed(
			() => this.storesQuery.data()?.data.map((store) => ({ label: store.store_name, value: store.id })) ?? [],
		),
	);
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'product', status: 1 }));
	private readonly taxesQuery = injectTaxesQuery(() => ({ status: 1 }));
	readonly taxes = computed(
		() => this.taxesQuery.data()?.data.map((tax) => ({ label: tax.name, value: tax.id })) ?? [],
	);
	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);

	private readonly attributesQuery = injectAttributesQuery(() => ({ status: 1 }));
	private readonly attributeValuesQuery = injectAttributeValuesQuery(() => ({ status: 1 }));
	private readonly selectedAttrIds = signal<string>('');
	public attribute$: Observable<Select2Data> = toObservable(
		computed(() => this.filterAttributes(this.selectedAttrIds())),
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
	public selectedCategories: Number[] = [];
	public selectedTags: Number[] = [];
	public variationCombinations: IVariationCombination[] = [];
	public retrieveVariants: boolean = false;
	public variantCount: number = 0;
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
			label: 'Classified',
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

	public variants: IVariant[] = [
		{
			id: null,
			attribute_values: null,
			options: null,
			variant_option: null,
		},
	];
	public variations: IVariation[] = [];
	private search = new Subject<string>();
	public editor: Editor;
	public html = '';

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			/** Validated YouTube video id for the PDP (catalog chunk persists it). */
			youtube_video_id: new FormControl<string | null>(null),
			name: new FormControl('', [Validators.required]),
			short_description: new FormControl('', [Validators.required]),
			description: new FormControl('', [Validators.required]),
			store_id: new FormControl(),
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
			categories: new FormControl('', [Validators.required]),
			is_random_related_products: new FormControl(0),
			related_products: new FormControl(),
			upsell_products: new FormControl([]),
			cross_sell_products: new FormControl([]),
			product_thumbnail_id: new FormControl(),
			product_galleries_id: new FormControl(),
			size_chart_image_id: new FormControl(),
			variants: this.formBuilder.array([], []),
			variations: this.formBuilder.array([], []),
			attributes_ids: new FormControl([]),
			meta_title: new FormControl(),
			meta_description: new FormControl(),
			product_meta_image_id: new FormControl(),
			safe_checkout: new FormControl(1),
			secure_checkout: new FormControl(1),
			social_share: new FormControl(1),
			encourage_order: new FormControl(1),
			encourage_view: new FormControl(1),
			is_free_shipping: new FormControl(0),
			tax_id: new FormControl('', [Validators.required]),
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
			status: new FormControl<string>('live'),
		});

		this.transloco.selectTranslation().subscribe(() => this.buildOptions());
	}

	private buildOptions() {
		const t = (key: string) => this.transloco.translate(key);
		this.badgeOptions = CATALOG_BADGE_CODES.map((code) => ({ value: code, label: t(`badge_${code}`) }));
		this.availabilityOptions = [
			{ value: 'available', label: t('available') },
			{ value: 'unavailable', label: t('not_available') },
		];
		const statuses = ['live', 'disabled', 'discontinued'];
		if (this.catalogProduct?.status === 'draft') statuses.unshift('draft');
		this.statusOptions = statuses.map((status) => ({
			value: status,
			label: t(`product_status_${status}`),
			disabled: status === 'draft',
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
		for (const name of FIELDS_THE_API_DOES_NOT_SAVE) {
			this.form.get(name)?.clearValidators();
			this.form.get(name)?.updateValueAndValidity({ emitEvent: false });
		}
		this.form.patchValue(
			{
				name: detail.title,
				sku: detail.sku,
				type: detail.type === 'variable' ? 'classified' : 'simple',
				weight: detail.shipping.weightGrams,
				length_cm: detail.shipping.lengthCm,
				width_cm: detail.shipping.widthCm,
				height_cm: detail.shipping.heightCm,
				hsn_code: detail.hsnCode,
				estimated_delivery_text: detail.estimatedDeliveryText,
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

	get variantControl(): FormArray {
		return this.form.get('variants') as FormArray;
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

		if (this.type() == 'create') {
			this.variants.forEach((variant) =>
				this.variantControl.push(
					this.formBuilder.group({
						id: new FormControl(variant?.id, []),
						attribute_values: new FormControl(variant?.attribute_values, []),
						options: new FormControl(variant?.attribute_values, []),
						variant_option: new FormControl(variant?.variant_option, []),
					}),
				),
			);
		}

		this.variantControl.valueChanges.pipe(debounceTime(200), distinctUntilChanged()).subscribe((variantValue) => {
			let selectedAttr = variantValue.filter((el: any) => el.id != null).map((val: IVariant) => val.id);
			this.selectedAttrIds.set(selectedAttr.join(','));

			let variantValues = variantValue.filter((el: any) => el.attribute_values != null);
			let attributesIds = variantValues?.map((attr: IVariant) => attr.id);

			this.form.controls['attributes_ids'].setValue(attributesIds);

			this.variationCombinations = this.generateCombinations(variantValues);

			this.addVariation();
		});

		this.products$.subscribe((product) => {
			this.collectionProduct = product?.length
				? product.filter((res) => res?.data?.type == 'simple' && res?.data?.stock_status == 'in_stock')
				: [];
		});

		this.setting$.subscribe((setting) => {
			if (setting?.activation?.multivendor) {
				this.form.controls['store_id'].setValidators([Validators.required]);
			} else {
				this.form.controls['store_id'].removeValidators([]);
			}
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

	addVariant(event: Event) {
		event.preventDefault();
		this.variantControl.push(
			this.formBuilder.group({
				id: new FormControl(),
				attribute_values: new FormControl(),
				options: new FormControl(),
				variant_option: new FormControl(),
			}),
		);
	}

	removeVariant(index: number) {
		if (this.variantControl.length <= 1) return;
		this.variantControl.removeAt(index);
	}

	getAttributeValues(id: number | null): Observable<Select2Data> {
		return of(this.filterAttributeValues(id ? id : null));
	}

	// Replicates the former AttributeState.attributes selector over the TanStack query data:
	// maps attributes to Select2 options, optionally excluding ids already chosen in other variant rows.
	private filterAttributes(ids: string): Select2Data {
		const attrIds = Array.from(new Set(ids.split(','))).map(Number);
		const data = this.attributesQuery.data()?.data ?? [];
		const filter = attrIds.length ? data.filter((attr) => !attrIds.includes(Number(attr.id!))) : data;
		return filter.map((attribute) => ({
			label: attribute?.name,
			value: attribute?.id,
			attribute_values: attribute?.attribute_values,
		})) as Select2Data;
	}

	// Replicates the former AttributeState.attribute_value selector: values belonging to one attribute.
	private filterAttributeValues(id: number | null): Select2Data {
		if (!id) return [];
		return (this.attributeValuesQuery.data()?.data ?? [])
			.filter((attrVal) => +attrVal.attribute_id === id)
			.map((value) => ({ label: value?.value, value: value?.id })) as Select2Data;
	}

	updateAttribute(data: Select2UpdateEvent, index: number) {
		const variantControl = this.form.get('variants') as FormArray; // get the variants FormArray
		const control = variantControl.at(index); // get the control at the specified index

		let variant_option = null;
		this.getAttributeValues(data ? +data?.value : null).subscribe((option) => (variant_option = option));
		control.patchValue({ variant_option: variant_option }); // patch the new value
		this.variantCount++;
		if (!this.retrieveVariants) {
			control.patchValue({ attribute_values: null, options: null }); // patch the new value
		}
		if (this.variantCount == this.variants?.length) {
			this.retrieveVariants = false;
		}
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

	updateAttributeValue(data: Select2UpdateEvent, index: number) {
		const variantControl = this.form.get('variants') as FormArray;
		const control = variantControl.at(index);
		control.patchValue({ options: data?.options });
	}

	clearVariations() {
		const variantsControl = this.form.get('variations') as FormArray; // assuming your FormArray group is named 'variations'
		variantsControl.clear(); // remove all the controls from the FormArray
	}

	addVariation() {
		this.clearVariations();
		if (this.variationCombinations.length) {
			this.variationCombinations.forEach((variation) => {
				const index = this.variations.findIndex((value) =>
					value.attribute_values.every((item) => variation?.attribute_values.includes(+item?.id!)),
				);
				let variationValue;
				if (index != -1 && this.variations[index]) {
					variationValue = this.variations[index];
				}
				this.variationControl.push(
					this.formBuilder.group(
						{
							id: new FormControl(variationValue?.id, []),
							variation_name: new FormControl(variation?.name, []),
							name: new FormControl(variationValue?.name, [Validators.required]),
							sku: new FormControl(variationValue?.sku, [Validators.required]),
							mrp: new FormControl(variationValue?.price, []),
							price: new FormControl(variationValue?.sale_price, [Validators.required, priceValidator]),
							discount: new FormControl(variationValue?.discount, []),
							quantity: new FormControl(variationValue?.quantity, [Validators.required]),
							weight_grams: new FormControl(),
							length_cm: new FormControl(),
							width_cm: new FormControl(),
							height_cm: new FormControl(),
							barcode: new FormControl(),
							hsn: new FormControl(),
							availability: new FormControl('available', [Validators.required]),
							variation_image_id: new FormControl(variationValue?.variation_image_id, []),
							variation_image: new FormControl(variationValue?.variation_image, []),
							attribute_values: new FormControl(variation?.attribute_values, []),
						},
						{ validators: sellingWithinMrp },
					),
				);
			});
		}
	}

	removeVariation(index: number) {
		if (this.variationControl.length <= 1) return;
		this.variationControl.removeAt(index);
	}

	selectCategoryItem(data: Number[]) {
		if (Array.isArray(data)) {
			this.form.controls['categories'].setValue(data);
		}
	}

	selectTagItem(data: Number[]) {
		if (Array.isArray(data)) {
			this.form.controls['tags'].setValue(Array.isArray(data) ? data : []);
		}
	}

	selectThumbnail(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['product_thumbnail_id'].setValue(data ? data.id : null);
		}
	}

	selectImages(data: IAttachment) {
		let ids = Array.isArray(data) ? data?.map((image) => image.id) : [];
		this.form.controls['product_galleries_id'].setValue(ids);
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

	// Combination Of Variations
	generateCombinations(attributes: IVariant[], index = 0, prefix = '', attribute_values: number[] = []): any {
		if (index >= attributes.length) {
			if (!attribute_values.length) return [];
			// End of recursion
			return [{ name: prefix.replace(/\/$/, ''), attribute_values }];
		}

		const currentAttribute = attributes[index];
		const currentOptions = currentAttribute.options;
		const combinations = [];

		if (currentOptions?.length === 1) {
			// If attribute has only one option, include it in the prefix and IDs
			const currentOption = currentOptions[0];
			const newPrefix = `${prefix}${currentOption.label}/`;
			const newIds: number[] = [...attribute_values, ...currentAttribute?.attribute_values!];

			const childCombinations = this.generateCombinations(attributes, index + 1, newPrefix, newIds);

			combinations.push(...childCombinations);
		} else {
			// If attribute has multiple options, generate separate combinations for each option
			for (let i = 0; i < currentOptions?.length!; i++) {
				const currentOption = currentOptions?.[i]!;
				const currentValue = currentOption?.value;
				const newPrefix = `${prefix}${currentOption.label}/`;
				const newIds: number[] = [...attribute_values, currentValue];

				const childCombinations = this.generateCombinations(attributes, index + 1, newPrefix, newIds);

				combinations.push(...childCombinations);
			}
		}

		return combinations;
	}

	submit() {
		this.form.markAllAsTouched();
		const product = this.catalogProduct;
		if (!product) {
			// Creating a product needs a catalogue create endpoint, which the API does not have yet.
			this.tabError = 'general';
			return;
		}
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const leadTime = textOrNull(raw['estimated_delivery_text']);
		const leadTimeControl = this.form.get('estimated_delivery_text');
		if (raw['made_to_order'] && !leadTime) leadTimeControl?.setErrors({ leadTimeRequired: true });
		if (!this.form.valid) {
			this.showInvalidTab();
			return;
		}
		if (this.isDiscontinuing) {
			this.productService.discontinueCatalogProduct(product.id, textOrNull(raw['replacement_path'])).subscribe({
				next: () => void this.router.navigateByUrl('/product'),
			});
			return;
		}
		const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
		const body: CatalogProductWrite = {
			sku: String(raw['sku'] ?? product.sku).trim(),
			status: raw['status'] === 'disabled' ? 'disabled' : 'live',
			featured: Boolean(raw['is_featured']),
			madeToOrder: Boolean(raw['made_to_order']),
			estimatedDeliveryText: leadTime,
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
			relatedProductIds: ids(raw['related_products']),
			upsellProductIds: ids(raw['upsell_products']),
			crossSellProductIds: ids(raw['cross_sell_products']),
		};
		this.productService.saveCatalogProduct(product.id, body).subscribe({
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
