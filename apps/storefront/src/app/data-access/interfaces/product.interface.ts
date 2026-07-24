import { IAttachment } from './attachment.interface';
import { IAttribute, IAttributeValue } from './attribute.interface';
import { ICategory } from './category.interface';
import { IPaginateModel } from './core.interface';
import { IAddonGroup, IBundle, IMeasurementField, ISemanticAttribute } from './product-detail.interface';
import { IReview } from './review.interface';
import { IStores } from './store.interface';
import { ITag } from './tag.interface';
import { ITax } from './tax.interface';

export interface IProductModel extends IPaginateModel {
	data: IProduct[];
}

export interface IProduct {
	id: number;
	name: string;
	slug: string;
	short_description: string;
	description: string;
	type: string;
	product_thumbnail_id?: number;
	product_thumbnail?: IAttachment;
	product_galleries_id?: [];
	product_galleries?: IAttachment[];
	unit: string;
	weight: number;
	price: number;
	sale_price: number;
	discount: number;
	is_sale_enable: boolean | number;
	sale_starts_at: string;
	sale_expired_at: string;
	sku: string;
	stock_status: string;
	stock: string;
	visible_time: string;
	quantity: number;
	store_id?: number;
	size_chart_image_id: number;
	size_chart_image: IAttachment;
	estimated_delivery_text: string;
	return_policy_text: string;
	safe_checkout: boolean;
	secure_checkout: boolean;
	social_share: boolean;
	encourage_order: boolean;
	encourage_view: boolean;
	is_free_shipping: boolean;
	is_featured: boolean | number;
	is_trending: boolean;
	is_return: boolean | number;
	shipping_days: number;
	tax_id: number;
	tax: ITax;
	status: boolean;
	meta_title: string;
	meta_description: string;
	product_meta_image: IAttachment;
	product_meta_image_id: number;
	tags: ITag[];
	tag: ITag;
	categories: ICategory[];
	category: ICategory;
	store?: IStores;
	store_name?: string;
	orders_count: string | number;
	order_amount: string | number;
	attribute_values: [];
	variations: IVariation[];
	variants: IVariant[];
	attributes: IAttribute[];
	attributes_ids: number[];
	/**
	 * PDP semantic-role additions (KB §03/§04). Optional so legacy/simple
	 * products are unaffected. See product-detail.interface.ts.
	 */
	semantic_role?: 'simple' | 'variation_axis' | 'named_add_on' | 'bundle';
	semantic_attributes?: ISemanticAttribute[]; // filter_only display attributes
	addon_groups?: IAddonGroup[]; // named_add_on option groups
	measurement_fields?: IMeasurementField[]; // tailoring inputs for add-on/bundle
	bundle?: IBundle; // true composite/kit
	related_blog_ids?: number[]; // blogs the admin linked to this (or parent) product
	is_random_related_products: boolean;
	related_products: number[];
	cross_sell_products: number[];
	pivot?: IPivotProduct;
	created_by_id: number;
	is_approved: boolean;
	total_in_approved_products: number;
	published_at: string;
	reviews: IReview[];
	reviews_count: number;
	rating_count: number;
	review_ratings: number[];
	user_review: IReview;
	can_review: boolean;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface IPivotProduct {
	order_id: number;
	product_id: number;
	quantity: number;
	shipping_cost: number;
	single_price: number;
	subtotal: number;
	variation_id?: number;
	variation: IVariation;
	is_refunded: number;
}

export interface IVariation {
	id: number;
	name: string;
	price: number;
	sale_price: number;
	stock_status: string;
	sku: string;
	discount: number;
	quantity: number;
	variation_image: IAttachment;
	variation_image_id: number;
	variation_options: IVariationOption[];
	attribute_values: IAttributeValue[];
	selected_variation: string;
	status: boolean;
}

export interface IVariationOption {
	name: string;
	value: string;
}

export interface IVariant {
	id: number | null;
	attribute_values: number[] | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor variant shape, typed during state migration
	options: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vendor variant shape, typed during state migration
	variant_option: any;
}

export interface ISelectedVariant {
	id: number;
	attribute_id: number;
}
