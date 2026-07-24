import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, computed, DOCUMENT, inject, input, PLATFORM_ID, Renderer2, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
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
import { Select2, Select2Data, Select2Module, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Observable, of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';

import { SettingStore } from '@core/state/setting.store';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IVariant, IVariation, IVariationCombination } from '@data-access/interfaces/product.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { injectAttributesQuery, injectAttributeValuesQuery } from '@data-access/queries/attribute.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { injectStoresQuery } from '@data-access/queries/store.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { injectTaxesQuery } from '@data-access/queries/tax.queries';
import { ProductService } from '@data-access/services/product.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { priceValidator } from '@shared/validators/price-validator';

function convertToNgbDate(date: NgbDateStruct): NgbDate {
	return new NgbDate(date.year, date.month, date.day);
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
		Select2Module,
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
		AdvancedDropdown,
		NgbNavOutlet,
		TranslocoModule,
		AsyncPipe,
	],
})
export class FormProduct {
	private productService = inject(ProductService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private calendar = inject(NgbCalendar);
	formatter = inject(NgbDateParserFormatter);
	private renderer = inject(Renderer2);
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
	private readonly productsQuery = injectProductsQuery(() => this.productParams());
	products$: Observable<Select2Data> = toObservable(
		computed(() =>
			(this.productsQuery.data()?.data ?? [])
				.filter((res) => res.id !== this.id)
				.map((res) => ({
					label: res?.name,
					value: res?.id,
					data: {
						type: res.type,
						name: res.name,
						slug: res.slug,
						stock_status: res.stock_status,
						image: res.product_thumbnail ? res.product_thumbnail.original_url : 'assets/images/product.png',
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
	public id: number;
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
			is_sale_enable: new FormControl(false),
			sale_starts_at: new FormControl(),
			sale_expired_at: new FormControl(),
			tags: new FormControl(),
			categories: new FormControl('', [Validators.required]),
			is_random_related_products: new FormControl(0),
			related_products: new FormControl(),
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
			return_policy_text: new FormControl(),
			is_featured: new FormControl(0),
			is_trending: new FormControl(0),
			is_return: new FormControl(1),
			status: new FormControl(1),
		});
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
				switchMap((params) => {
					if (!params['id']) return of();
					return this.productService
						.getProducts()
						.pipe(map((res) => res.data.find((product) => product.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((product) => {
				if (product?.related_products && product?.cross_sell_products) {
					let array = [...product?.related_products, ...product?.cross_sell_products];
					this.filter['paginate'] = array?.length >= 15 ? array?.length : 15;
					this.filter['ids'] = array?.join();
					this.filter['with_union_products'] = array?.length ? (array?.length >= 15 ? 0 : 1) : 0;
				}
				of(this.productParams.set({ ...this.filter })).subscribe({
					next: () => {
						this.fromDate = product?.sale_starts_at
							? convertToNgbDate(this.formatter.parse(product?.sale_starts_at)!)
							: null;
						this.toDate = product?.sale_expired_at
							? convertToNgbDate(this.formatter.parse(product?.sale_expired_at)!)
							: null;

						this.selectedCategories = product?.categories.map((value) => value?.id!)!;
						this.selectedTags = product?.tags.map((value) => value?.id!)!;

						let attributes = product?.attributes.map((value) => value?.id);
						let galleries = product?.product_galleries.map((value) => value?.id);
						if (product) this.product = product;
						this.id = product?.id!;
						this.form.patchValue({
							name: product?.name,
							short_description: product?.short_description,
							description: product?.description,
							store_id: product?.store_id,
							type: product?.type,
							unit: product?.unit,
							weight: product?.weight,
							stock_status: product?.stock_status,
							sku: product?.sku,
							quantity: product?.quantity,
							price: product?.price,
							discount: product?.discount,
							is_sale_enable: product?.is_sale_enable,
							sale_starts_at: product?.sale_starts_at,
							sale_expired_at: product?.sale_expired_at,
							tags: this.selectedTags,
							categories: this.selectedCategories,
							is_random_related_products: product?.is_random_related_products,
							related_products: product?.related_products,
							cross_sell_products: product?.cross_sell_products,
							product_thumbnail_id: product?.product_thumbnail_id,
							product_galleries_id: galleries,
							size_chart_image_id: product?.size_chart_image_id,
							attributes_ids: attributes,
							meta_title: product?.meta_title,
							meta_description: product?.meta_description,
							product_meta_image_id: product?.product_meta_image_id,
							safe_checkout: product?.safe_checkout,
							secure_checkout: product?.secure_checkout,
							social_share: product?.social_share,
							encourage_order: product?.encourage_order,
							encourage_view: product?.encourage_view,
							is_free_shipping: product?.is_free_shipping,
							is_return: product?.is_return,
							tax_id: product?.tax_id,
							estimated_delivery_text: product?.estimated_delivery_text,
							return_policy_text: product?.return_policy_text,
							is_featured: product?.is_featured,
							is_trending: product?.is_trending,
							status: product?.status,
						});

						// Create Variants
						let variants = attributes?.map((attr) => {
							let matchingVariations = product?.variations.filter((variation) => {
								return variation.attribute_values.some((attrVal) => attrVal?.attribute_id == attr);
							});

							let attributeValues = matchingVariations?.reduce((acc: any, variation) => {
								let values = variation.attribute_values
									.filter((attrVal) => attrVal?.attribute_id == attr)
									.map((attrVal) => attrVal?.id);
								return values ? [...new Set([...acc, ...values])] : acc;
							}, []);

							let options = matchingVariations?.reduce((acc: any, variation) => {
								let attrVal = variation.attribute_values.find(
									(attrVal) => attrVal.attribute_id == attr,
								);
								if (!acc.some((opt: any) => opt?.value == attrVal?.id)) {
									acc.push({ label: attrVal?.value, value: attrVal?.id });
								}
								return acc;
							}, []);

							return {
								id: attr,
								attribute_values: attributeValues,
								options: options,
								variant_option: [],
							};
						});

						// Set Variants and Variations
						this.variants = variants;
						this.variations = product?.variations!;

						if (product?.type == 'classified') {
							this?.variants?.forEach((variant) => {
								this.variantControl.push(
									this.formBuilder.group({
										id: new FormControl(variant?.id, []),
										attribute_values: new FormControl(variant?.attribute_values, []),
										options: new FormControl(variant?.options, []),
										variant_option: new FormControl(variant?.variant_option, []),
									}),
								);
							});
							this.retrieveVariants = true;
						} else {
							this.clearVariations();
						}
					},
				});
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

		this.form.controls['type'].valueChanges.subscribe((value) => {
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
					this.formBuilder.group({
						id: new FormControl(variationValue?.id, []),
						variation_name: new FormControl(variation?.name, []),
						name: new FormControl(variationValue?.name, [Validators.required]),
						price: new FormControl(variationValue?.price, [Validators.required, priceValidator]),
						discount: new FormControl(variationValue?.discount, []),
						stock_status: new FormControl(
							variationValue?.stock_status ? variationValue?.stock_status : 'in_stock',
							[Validators.required],
						),
						sku: new FormControl(variationValue?.sku, [Validators.required]),
						quantity: new FormControl(variationValue?.quantity, [Validators.required]),
						variation_image_id: new FormControl(variationValue?.variation_image_id, []),
						variation_image: new FormControl(variationValue?.variation_image, []),
						attribute_values: new FormControl(variation?.attribute_values, []),
						status: new FormControl(variationValue ? +variationValue?.status : 1),
					}),
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

		// If product type simple then clear all variation
		if (this.form.controls['type'].value == 'simple') {
			this.form.controls['attributes_ids'].setValue([]);
			this.clearVariations();
		}

		if (this.form.valid) {
			// Create/update have no backend yet — reset image fields and navigate back.
			this.form.controls['product_thumbnail_id'].setValue('');
			this.form.controls['product_galleries_id'].setValue('');
			void this.router.navigateByUrl('/product');
			this.tabError = null;
		} else {
			const invalidField = Object?.keys(this.form?.controls).find((key) => this.form.controls[key].invalid);
			if (this.isBrowser) {
				const div = document.querySelector(`#${invalidField}`)?.closest('div.tab')?.getAttribute('tab');
				if (div) {
					this.nav().select(div);
					this.tabError = div;
				}
			}
		}
	}
}
