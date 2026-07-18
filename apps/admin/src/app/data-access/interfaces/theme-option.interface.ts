import { IAttachment } from './attachment.interface';

export interface IThemeOption {
	id: number;
	options: IOption;
}

export interface IOption {
	logo: ILogo;
	general: IGeneral;
	seo: ISEO;
	header: IHeader;
	footer: IFooter;
	blog: IBlog;
	product: IProductThemeOption;
	collection: ICollection;
	seller: ISeller;
	about_us: IAboutUs;
	contact_us: IContact;
}

export interface ILogo {
	header_logo_id: number;
	footer_logo_id: number;
	favicon_icon_id: number;
	favicon_icon: IAttachment;
	header_logo: IAttachment;
	footer_logo: IAttachment;
}

export interface IGeneral {
	site_title: string;
	site_tagline: string;
	sticky_cart_enable: boolean;
	preloader_enable: number | boolean;
	back_to_top_enable: number | boolean;
	cart_style: string;
	language_direction: string;
	hover_color: string;
	primary_color: string;
	secondary_color: string;
	link_color: string;
	mode: string;
}

export interface ISEO {
	meta_tags: string;
	meta_title: string;
	meta_description: string;
	og_title: string;
	og_description: string;
	og_image_id: number;
	og_image: IAttachment;
}

export interface IHeader {
	sticky_header_enable: number | boolean;
	header_options: string;
	page_top_bar_enable: number | boolean;
	top_bar_content: ITopBarContent[];
	page_top_bar_dark: number | boolean;
	support_number: string;
	today_deals: [];
	category_ids: number[];
}

export interface ITopBarContent {
	content: string;
}

export interface IFooter {
	footer_style: string;
	footer_copyright: number | boolean;
	copyright_content: string;
	footer_about: string;
	about_address: string;
	about_email: string;
	footer_categories: number[];
	footer_pages: [];
	useful_link: ICustomDropdown[];
	help_center: ICustomDropdown[];
	support_number: number;
	support_email: string;
	play_store_url: string;
	app_store_url: string;
	social_media_enable: number | boolean;
	facebook: string;
	instagram: string;
	twitter: string;
	pinterest: string;
}

export interface ICustomDropdown {
	id: number;
	name: string;
	value: string;
}

export interface IBlog {
	blog_style: string;
	blog_sidebar_type: string;
	blog_author_enable: number | boolean;
	read_more_enable: number | boolean;
}

export interface ISeller {
	about: IAbout;
	services: IServices;
	steps: ISteps;
	start_selling: IStep;
	store_layout: string;
	store_details: string;
}

export interface IAboutUs {
	about: IAboutSection;
	clients: IClients;
	team: ITeam;
	testimonial: ITestimonial;
	blog: IBlog;
}

export interface IAboutSection {
	status: boolean;
	content_left_image_url: string;
	content_right_image_url: string;
	sub_title: string;
	title: string;
	description: string;
	futures: IAboutFutures[];
}

export interface IAboutFutures {
	icon: string;
	title: string;
}

export interface IAbout {
	status: boolean;
	title: string;
	description: string;
	image_url: string;
}

export interface IClients {
	status: boolean;
	sub_title: string;
	title: string;
	content: IClientsContent[];
}

export interface IClientsContent {
	icon: string;
	title: string;
	description: string;
}

export interface ITeam {
	status: boolean;
	sub_title: string;
	title: string;
	members: IMember[];
}

export interface IMember {
	profile_image_url: string;
	name: string;
	designation: string;
	description: string;
	instagram: string;
	twitter: string;
	pinterest: string;
	facebook: string;
}

export interface ITestimonial {
	status: boolean;
	sub_title: string;
	title: string;
	reviews: IReview[];
}

export interface IReview {
	title: string;
	profile_image_url: string;
	name: string;
	designation: string;
	review: string;
}

export interface IBlog {
	status: boolean;
	blog_ids: number[];
}

export interface IServices {
	status: boolean;
	title: string;
	service_1: IService;
	service_2: IService;
	service_3: IService;
	service_4: IService;
}

export interface IService {
	status: boolean;
	title: string;
	description: string;
	image_url: string;
}

export interface ISteps {
	status: boolean;
	title: string;
	step_1: IStep;
	step_2: IStep;
	step_3: IStep;
}

export interface IStep {
	status: boolean;
	title: string;
	description: string;
}

export interface IContact {
	contact_image_url: string;
	detail_1: IDetail;
	detail_2: IDetail;
	detail_3: IDetail;
	detail_4: IDetail;
}

export interface IDetail {
	label: string;
	icon: string;
	text: string;
}

export interface IProductThemeOption {
	product_layout: string;
	is_trending_product: boolean;
	banner_enable: boolean;
	banner_image_url: string;
	safe_checkout: boolean;
	safe_checkout_image: string;
	secure_checkout: boolean;
	secure_checkout_image: string;
	encourage_order: boolean;
	encourage_max_order_count: number;
	encourage_view: boolean;
	encourage_max_view_count: number;
	sticky_checkout: boolean;
	sticky_product: boolean;
	social_share: boolean;
	shipping_and_return: string;
}

export interface ICollection {
	collection_layout: string;
	collection_banner_image_url: string;
}

export interface IImages {
	image_url: string;
}
