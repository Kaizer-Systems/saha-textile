import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbAccordionModule, NgbNavModule, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { map, of, Observable } from 'rxjs';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import {
	IAboutFutures,
	IClientsContent,
	ICustomDropdown,
	IMember,
	IOption,
	IReview,
	ITopBarContent,
} from '@data-access/interfaces/theme-option.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import * as data from '@shared/data/theme-option';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

@Component({
	selector: 'app-theme-option',
	templateUrl: './theme-option.html',
	styleUrls: ['./theme-option.scss'],
	imports: [
		PageWrapper,
		ReactiveFormsModule,
		NgbNavModule,
		FormFields,
		ImageUpload,
		Select2Module,
		AdvancedDropdown,
		NgxEditorModule,
		NgbNavOutlet,
		Button,
		NgbAccordionModule,
		HasPermissionDirective,
		TranslocoModule,
		AsyncPipe,
	],
})
export class ThemeOption {
	private formBuilder = inject(FormBuilder);
	private themeOptionService = inject(ThemeOptionService);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1, type: 'product' }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	categories$: Observable<Select2Data> = toObservable(
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

	private readonly productParams = signal<Params>({ search: '', paginate: 15, ids: '', with_union_products: 0 });
	private readonly productsQuery = injectProductsQuery(() => this.productParams());
	product$: Observable<Select2Data> = toObservable(
		computed(
			() =>
				this.productsQuery.data()?.data.map((res) => ({
					label: res?.name,
					value: res?.id,
					data: {
						type: res.type,
						name: res.name,
						slug: res.slug,
						stock_status: res.stock_status,
						image: res.product_thumbnail ? res.product_thumbnail.original_url : 'assets/images/product.png',
					},
				})) ?? [],
		),
	);

	private readonly blogsQuery = injectBlogsQuery(() => ({ status: 1 }));
	blogs$: Observable<Select2Data> = toObservable(
		computed(() => this.blogsQuery.data()?.data.map((blog) => ({ label: blog.title, value: blog.id })) ?? []),
	);

	public active = 'general';
	public seller = 'about';
	public about = 'about';
	public form: FormGroup;
	public selectedCategories: number[] = [];
	public theme_option_data: IOption;
	public collection_layout = data.collection_layout;
	public product_layout = data.product_layout;
	public language_direction: Select2Data = data.language_direction;
	public footer_mode: Select2Data = data.footer_mode;
	public useful_link = data.useful_link;
	public blog_sidebar = data.blog_sidebar_type;
	public help_center = data.help_center;
	public usefulLinks: number[] = [];
	public helpCenterIds: number[] = [];
	public top_bar_content = [{ content: '' }, { content: '' }, { content: '' }];
	public filter = {
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: 0,
	};

	public mode: Select2Data = [
		{
			value: 'light',
			label: 'Light',
		},
		{
			value: 'dark',
			label: 'Dark',
		},
	];

	public cart_style: Select2Data = [
		{
			value: 'cart_sidebar',
			label: 'Cart Sidebar',
		},
		{
			value: 'cart_mini',
			label: 'Cart Mini',
		},
	];

	public editor: Editor;
	public html = '';
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = new FormGroup({
			general: new FormGroup({
				site_title: new FormControl(),
				site_tagline: new FormControl(),
				sticky_cart_enable: new FormControl(true),
				cart_style: new FormControl('cart_sidebar'),
				back_to_top_enable: new FormControl(false),
				language_direction: new FormControl('rtl'),
				primary_color: new FormControl(''),
				mode: new FormControl('light'),
			}),
			logo: new FormGroup({
				header_logo_id: new FormControl(''),
				footer_logo_id: new FormControl(''),
				favicon_icon_id: new FormControl(''),
			}),
			header: new FormGroup({
				sticky_header_enable: new FormControl(true),
				header_options: new FormControl('basic_header'),
				page_top_bar_enable: new FormControl(true),
				top_bar_content: new FormArray([]),
				page_top_bar_dark: new FormControl(false),
				support_number: new FormControl(''),
				today_deals: new FormControl([]),
				category_ids: new FormControl([]),
			}),
			footer: new FormGroup({
				footer_style: new FormControl('light_mode'),
				footer_copyright: new FormControl(true),
				copyright_content: new FormControl(''),
				footer_about: new FormControl(''),
				about_address: new FormControl(''),
				about_email: new FormControl(''),
				footer_categories: new FormControl([]),
				useful_link: new FormControl([]),
				help_center: new FormControl([]),
				support_number: new FormControl(''),
				support_email: new FormControl(''),
				play_store_url: new FormControl(''),
				app_store_url: new FormControl(''),
				social_media_enable: new FormControl(true),
				facebook: new FormControl(''),
				instagram: new FormControl(''),
				twitter: new FormControl(''),
				pinterest: new FormControl(''),
			}),
			collection: new FormGroup({
				collection_layout: new FormControl('collection_category_slider'),
				collection_banner_image_url: new FormControl(''),
			}),
			product: new FormGroup({
				product_layout: new FormControl('product_images'),
				is_trending_product: new FormControl(true),
				banner_enable: new FormControl(true),
				banner_image_url: new FormControl(''),
				safe_checkout: new FormControl(true),
				safe_checkout_image: new FormControl(''),
				secure_checkout: new FormControl(true),
				secure_checkout_image: new FormControl(''),
				encourage_order: new FormControl(true),
				encourage_max_order_count: new FormControl(''),
				encourage_view: new FormControl(true),
				encourage_max_view_count: new FormControl(''),
				sticky_checkout: new FormControl(true),
				sticky_product: new FormControl(true),
				social_share: new FormControl(true),
				shipping_and_return: new FormControl(''),
			}),
			blog: new FormGroup({
				blog_style: new FormControl('grid_view'),
				blog_sidebar_type: new FormControl('left_sidebar'),
				blog_author_enable: new FormControl(true),
				read_more_enable: new FormControl(true),
			}),
			seller: new FormGroup({
				about: new FormGroup({
					status: new FormControl(true),
					title: new FormControl(''),
					description: new FormControl(''),
					image_url: new FormControl(''),
				}),
				services: new FormGroup({
					status: new FormControl(true),
					title: new FormControl(''),
					service_1: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
						image_url: new FormControl(''),
					}),
					service_2: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
						image_url: new FormControl(''),
					}),
					service_3: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
						image_url: new FormControl(''),
					}),
					service_4: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
						image_url: new FormControl(''),
					}),
				}),
				steps: new FormGroup({
					status: new FormControl(true),
					title: new FormControl(''),
					step_1: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
					}),
					step_2: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
					}),
					step_3: new FormGroup({
						title: new FormControl(''),
						description: new FormControl(''),
					}),
				}),
				start_selling: new FormGroup({
					status: new FormControl(true),
					title: new FormControl(''),
					description: new FormControl(''),
				}),
				store_layout: new FormControl('basic_store'),
				store_details: new FormControl('basic_store_details'),
			}),
			contact_us: new FormGroup({
				contact_image_url: new FormControl(''),
				detail_1: new FormGroup({
					label: new FormControl(''),
					icon: new FormControl(''),
					text: new FormControl(''),
				}),
				detail_2: new FormGroup({
					label: new FormControl(''),
					icon: new FormControl(''),
					text: new FormControl(''),
				}),
				detail_3: new FormGroup({
					label: new FormControl(''),
					icon: new FormControl(''),
					text: new FormControl(''),
				}),
				detail_4: new FormGroup({
					label: new FormControl(''),
					icon: new FormControl(''),
					text: new FormControl(''),
				}),
			}),
			about_us: new FormGroup({
				about: new FormGroup({
					status: new FormControl(true),
					content_left_image_url: new FormControl(''),
					content_right_image_url: new FormControl(''),
					sub_title: new FormControl(''),
					title: new FormControl(''),
					description: new FormControl(''),
					futures: new FormArray([]),
				}),
				clients: new FormGroup({
					status: new FormControl(true),
					sub_title: new FormControl(''),
					title: new FormControl(''),
					content: new FormArray([]),
				}),
				team: new FormGroup({
					status: new FormControl(true),
					sub_title: new FormControl(''),
					title: new FormControl(''),
					members: new FormArray([]),
				}),
				testimonial: new FormGroup({
					status: new FormControl(true),
					sub_title: new FormControl(''),
					title: new FormControl(''),
					reviews: new FormArray([]),
				}),
				blog: new FormGroup({
					status: new FormControl(true),
					blog_ids: new FormControl([]),
				}),
			}),
			seo: new FormGroup({
				meta_tags: new FormControl(''),
				meta_title: new FormControl(''),
				meta_description: new FormControl(''),
				og_title: new FormControl(''),
				og_description: new FormControl(''),
				og_image_id: new FormControl(),
			}),
		});
	}

	ngOnInit() {
		this.patchForm();

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	patchForm() {
		this.themeOptionService
			.getThemeOption()
			.pipe(map((res) => res.options))
			.subscribe((option) => {
				this.selectedCategories = option?.footer?.footer_categories!;
				this.theme_option_data = option!;
				if (option?.header.today_deals?.length) {
					let array = option?.header.today_deals;
					this.filter['paginate'] = array?.length >= 15 ? array?.length : 15;
					this.filter['ids'] = array?.join();
					this.filter['with_union_products'] = array?.length ? (array?.length >= 15 ? 0 : 1) : 0;
				}

				of(this.productParams.set({ ...this.filter })).subscribe({
					next: () => {
						this.topBarContent.clear();
						this.initializeForm(option?.header?.top_bar_content!);
						this.usefulLinks = option?.footer?.useful_link?.map((link: ICustomDropdown) => link.id) || [];
						this.helpCenterIds = option?.footer?.help_center?.map((link: ICustomDropdown) => link.id) || [];
						this.form.patchValue({
							general: {
								site_title: option?.general?.site_title,
								site_tagline: option?.general?.site_tagline,
								sticky_cart_enable: option?.general?.sticky_cart_enable,
								cart_style: option?.general?.cart_style,
								back_to_top_enable: option?.general?.back_to_top_enable,
								language_direction: option?.general?.language_direction,
								primary_color: option?.general?.primary_color,
								mode: option?.general?.mode,
							},
							logo: {
								header_logo_id: option?.logo?.header_logo_id,
								footer_logo_id: option?.logo?.footer_logo_id,
								favicon_icon_id: option?.logo?.favicon_icon_id,
							},
							seo: {
								meta_tags: option?.seo?.meta_tags,
								meta_title: option?.seo?.meta_title,
								meta_description: option?.seo?.meta_description,
								og_title: option?.seo?.og_title,
								og_description: option?.seo?.og_description,
								og_image_id: option?.seo?.og_image_id,
							},
							header: {
								sticky_header_enable: option?.header?.sticky_header_enable,
								header_options: option?.header?.header_options,
								page_top_bar_enable: option?.header?.page_top_bar_enable,
								top_bar_content: option?.header?.top_bar_content,
								page_top_bar_dark: option?.header?.page_top_bar_dark,
								support_number: option?.header?.support_number,
								today_deals: option?.header?.today_deals,
								category_ids: option?.header?.category_ids,
							},
							footer: {
								footer_style: option?.footer?.footer_style,
								footer_copyright: option?.footer?.footer_copyright,
								copyright_content: option?.footer?.copyright_content,
								footer_about: option?.footer?.footer_about,
								about_address: option?.footer?.about_address,
								about_email: option?.footer?.about_email,
								footer_categories: option?.footer?.footer_categories,
								useful_link: option?.footer?.useful_link,
								help_center: option?.footer?.help_center,
								support_number: option?.footer?.support_number,
								support_email: option?.footer?.support_email,
								play_store_url: option?.footer?.play_store_url,
								app_store_url: option?.footer?.app_store_url,
								social_media_enable: option?.footer?.social_media_enable,
								facebook: option?.footer?.facebook,
								instagram: option?.footer?.instagram,
								twitter: option?.footer?.twitter,
								pinterest: option?.footer?.pinterest,
							},
							blog: {
								blog_style: option?.blog?.blog_style,
								blog_sidebar_type: option?.blog?.blog_sidebar_type,
								blog_author_enable: option?.blog?.blog_author_enable,
								read_more_enable: option?.blog?.read_more_enable,
							},
							seller: {
								about: {
									title: option?.seller?.about?.title,
									description: option?.seller?.about?.description,
									image_url: option?.seller?.about?.image_url,
								},
								services: {
									status: option?.seller?.services?.status,
									title: option?.seller?.services?.title,
									service_1: {
										title: option?.seller?.services?.service_1?.title,
										description: option?.seller?.services?.service_1?.description,
										image_url: option?.seller?.services?.service_1?.image_url,
									},
									service_2: {
										title: option?.seller?.services?.service_2?.title,
										description: option?.seller?.services?.service_2?.description,
										image_url: option?.seller?.services?.service_2?.image_url,
									},
									service_3: {
										title: option?.seller?.services?.service_3?.title,
										description: option?.seller?.services?.service_3?.description,
										image_url: option?.seller?.services?.service_3?.image_url,
									},
									service_4: {
										title: option?.seller?.services?.service_4?.title,
										description: option?.seller?.services?.service_4?.description,
										image_url: option?.seller?.services?.service_4?.image_url,
									},
								},
								steps: {
									status: option?.seller?.steps?.status,
									title: option?.seller?.steps?.title,
									step_1: {
										title: option?.seller?.steps?.step_1?.title,
										description: option?.seller?.steps?.step_1?.description,
									},
									step_2: {
										title: option?.seller?.steps?.step_2?.title,
										description: option?.seller?.steps?.step_2?.description,
									},
									step_3: {
										title: option?.seller?.steps?.step_3?.title,
										description: option?.seller?.steps?.step_3?.description,
									},
								},
								start_selling: {
									status: option?.seller?.steps?.status,
									title: option?.seller?.start_selling?.title,
									description: option?.seller?.start_selling?.description,
								},
								store_layout: option?.seller?.store_layout,
								store_details: option?.seller?.store_details,
							},
							about_us: {
								about: {
									status: option?.about_us?.about?.status,
									content_left_image_url: option?.about_us?.about?.content_left_image_url,
									content_right_image_url: option?.about_us?.about?.content_right_image_url,
									sub_title: option?.about_us?.about?.sub_title,
									title: option?.about_us?.about?.title,
									description: option?.about_us?.about?.description,
									futures: option?.about_us?.about?.futures,
								},
								clients: {
									status: option?.about_us?.clients?.status,
									sub_title: option?.about_us?.clients?.sub_title,
									title: option?.about_us?.clients?.title,
									content: option?.about_us?.clients?.content,
								},
								team: {
									status: option?.about_us?.team?.status,
									sub_title: option?.about_us?.team?.sub_title,
									title: option?.about_us?.team?.title,
									members: option?.about_us?.team?.members,
								},
								testimonial: {
									status: option?.about_us?.testimonial?.status,
									sub_title: option?.about_us?.testimonial?.sub_title,
									title: option?.about_us?.testimonial?.title,
									reviews: option?.about_us?.testimonial?.reviews,
								},
								blog: {
									status: option?.about_us?.blog?.status,
									blog_ids: option?.about_us?.blog?.blog_ids,
								},
							},
							contact_us: {
								contact_image_url: option?.contact_us?.contact_image_url,
								detail_1: {
									label: option?.contact_us?.detail_1?.label,
									icon: option?.contact_us?.detail_1?.icon,
									text: option?.contact_us?.detail_1?.text,
								},
								detail_2: {
									label: option?.contact_us?.detail_2?.label,
									icon: option?.contact_us?.detail_2?.icon,
									text: option?.contact_us?.detail_2?.text,
								},
								detail_3: {
									label: option?.contact_us?.detail_3?.label,
									icon: option?.contact_us?.detail_3?.icon,
									text: option?.contact_us?.detail_3?.text,
								},
								detail_4: {
									label: option?.contact_us?.detail_4?.label,
									icon: option?.contact_us?.detail_4?.icon,
									text: option?.contact_us?.detail_4?.text,
								},
							},
							collection: {
								collection_layout: option?.collection?.collection_layout,
								collection_banner_image_url: option?.collection?.collection_banner_image_url,
							},
							product: {
								product_layout: option?.product?.product_layout,
								is_trending_product: option?.product?.is_trending_product,
								banner_enable: option?.product?.banner_enable,
								banner_image_url: option?.product?.banner_image_url,
								safe_checkout: option?.product?.safe_checkout,
								safe_checkout_image: option?.product?.safe_checkout_image,
								secure_checkout: option?.product?.secure_checkout,
								secure_checkout_image: option?.product?.secure_checkout_image,
								encourage_order: option?.product?.encourage_order,
								encourage_max_order_count: option?.product?.encourage_max_order_count,
								encourage_view: option?.product?.encourage_view,
								encourage_max_view_count: option?.product?.encourage_max_view_count,
								sticky_checkout: option?.product?.sticky_checkout,
								sticky_product: option?.product?.sticky_product,
								social_share: option?.product?.social_share,
								shipping_and_return: option?.product?.shipping_and_return,
							},
						});
					},
				});

				this.futuresContent.clear();
				option?.about_us?.about?.futures?.forEach((future: IAboutFutures) => {
					this.futuresContent?.push(
						this.formBuilder.group({
							icon: new FormControl(future?.icon),
							title: new FormControl(future?.title),
						}),
					);
				});

				this.clientsContent.clear();
				option?.about_us?.clients?.content?.forEach((content: IClientsContent) => {
					this.clientsContent.push(
						this.formBuilder.group({
							icon: new FormControl(content.icon),
							title: new FormControl(content.title),
							description: new FormControl(content.description),
						}),
					);
				});

				this.members.clear();
				option?.about_us?.team?.members?.forEach((member: IMember) => {
					this.members.push(
						this.formBuilder.group({
							profile_image_url: new FormControl(member.profile_image_url),
							name: new FormControl(member.name),
							designation: new FormControl(member.designation),
							description: new FormControl(member.description),
							instagram: new FormControl(member.instagram),
							twitter: new FormControl(member.twitter),
							pinterest: new FormControl(member.pinterest),
							facebook: new FormControl(member.facebook),
						}),
					);
				});

				this.testimonials.clear();
				option?.about_us?.testimonial?.reviews?.forEach((review: IReview) => {
					this.testimonials.push(
						this.formBuilder.group({
							title: new FormControl(review.name),
							profile_image_url: new FormControl(review.profile_image_url),
							name: new FormControl(review.name),
							review: new FormControl(review.review),
							designation: new FormControl(review.designation),
						}),
					);
				});
			});
	}

	get topBarContent(): FormArray {
		return this.form.get('header.top_bar_content') as FormArray;
	}

	get futuresContent(): FormArray {
		return this.form.get('about_us.about.futures') as FormArray;
	}

	get clientsContent(): FormArray {
		return this.form.get('about_us.clients.content') as FormArray;
	}

	get members(): FormArray {
		return this.form.get('about_us.team.members') as FormArray;
	}

	get testimonials(): FormArray {
		return this.form.get('about_us.testimonial.reviews') as FormArray;
	}

	initializeForm(_value: ITopBarContent[]) {
		this.top_bar_content.forEach((item) => {
			const group = this.formBuilder.group({
				content: item.content,
			});
			this.topBarContent.push(group);
		});
	}

	addFuture(event: Event) {
		event.preventDefault();
		this.futuresContent.push(
			this.formBuilder.group({
				icon: new FormControl(''),
				title: new FormControl(''),
			}),
		);
	}

	addClientsContent(event: Event) {
		event.preventDefault();
		this.clientsContent.push(
			this.formBuilder.group({
				icon: new FormControl(''),
				title: new FormControl(''),
				description: new FormControl(''),
			}),
		);
	}

	addMember(event: Event) {
		event.preventDefault();
		this.members.push(
			this.formBuilder.group({
				profile_image_url: new FormControl(''),
				name: new FormControl(''),
				designation: new FormControl(''),
				description: new FormControl(''),
				instagram: new FormControl(''),
				twitter: new FormControl(''),
				pinterest: new FormControl(''),
				facebook: new FormControl(''),
			}),
		);
	}

	reviews(event: Event) {
		event.preventDefault();
		this.testimonials.push(
			this.formBuilder.group({
				title: new FormControl(''),
				profile_image_url: new FormControl(''),
				name: new FormControl(''),
				designation: new FormControl(''),
				review: new FormControl(''),
			}),
		);
	}

	selectHeaderLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['logo']).controls['header_logo_id'].setValue(data ? data?.id : null);
		}
	}

	selectFooterLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['logo']).controls['footer_logo_id']?.setValue(data ? data?.id : null);
		}
	}

	selectFaviconIcon(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['logo']).controls['favicon_icon_id']?.setValue(data ? data?.id : null);
		}
	}

	selectOgImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['seo']).controls['og_image_id']?.setValue(data ? data?.id : null);
		}
	}

	selectSellerImage(data: string, key: string) {
		if (!Array.isArray(data)) {
			this.form.get(key)?.setValue(data ? data : null);
		}
	}

	usefulLink(data: number[]) {
		if (Array.isArray(data)) {
			(<FormGroup>this.form.controls['footer']).controls['useful_link']?.setValue(
				this.useful_link.filter((value) => data.includes(value.id)),
			);
		}
	}

	helpCenter(data: number[]) {
		if (Array.isArray(data)) {
			(<FormGroup>this.form.controls['footer']).controls['help_center']?.setValue(
				this.help_center.filter((value) => data.includes(value.id)),
			);
		}
	}

	selectCategoryItem(data: []) {
		if (Array.isArray(data)) {
			(<FormGroup>this.form.controls['footer']).controls['footer_categories']?.setValue(data);
		}
	}

	selectBanner(url: string, key: string) {
		this.form.get(key)?.setValue(url ? url : null);
	}

	selectFutures(url: string, index: number) {
		this.futuresContent
			.at(index)
			.get('icon')
			?.setValue(url ? url : null);
	}

	selectIcon(url: string, index: number) {
		this.clientsContent
			.at(index)
			.get('icon')
			?.setValue(url ? url : null);
	}

	selectMemberProfile(url: string, index: number) {
		this.members
			.at(index)
			.get('profile_image_url')
			?.setValue(url ? url : null);
	}

	selectReviewProfile(url: string, index: number) {
		this.testimonials
			.at(index)
			.get('profile_image_url')
			?.setValue(url ? url : null);
	}

	removeFutures(index: number) {
		if (this.futuresContent.length <= 0) return;
		this.futuresContent.removeAt(index);
	}

	removeMember(index: number) {
		if (this.members.length <= 0) return;
		this.members.removeAt(index);
	}

	removeClient(index: number) {
		if (this.clientsContent.length <= 0) return;
		this.clientsContent.removeAt(index);
	}

	removeProfile(index: number) {
		if (this.testimonials.length <= 0) return;
		this.testimonials.removeAt(index);
	}

	submit() {
		this.form.markAllAsTouched();
		// Update has no backend yet — form value is ready to persist once the API exists.
	}
}
