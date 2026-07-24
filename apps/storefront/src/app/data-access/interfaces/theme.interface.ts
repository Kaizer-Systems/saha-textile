import { IProduct } from './product.interface';

// Data shapes still used by the surviving home-page widgets (features/themes/widgets),
// the home page, and the footer. The per-theme page shapes (IParis, IDenver, …) were
// removed with the theme system.

export interface ILink {
	redirect_link: IRedirectLink;
	image_url: string;
}

export interface IRedirectLink {
	link_type: string;
	link: string | number;
}

export interface IProductSection {
	title: string;
	description?: string;
	product_ids: number[];
	status: boolean;
}

export interface INewsLetter {
	title?: string;
	sub_title?: string;
	image_url?: string;
	status?: boolean;
}

export interface ISliderProductsTokyo {
	status: boolean;
	product_slider_1?: IProductSection;
	product_slider_2?: IProductSection;
	product_slider_3?: IProductSection;
	product_slider_4?: IProductSection;
}

export interface IBundles {
	title: string;
	sub_title: string;
	button_text: string;
	image_url: string;
	status: boolean;
}

export interface IOffer {
	coupon_code: string;
	image_url: string;
	status: boolean;
}

export interface IDealOfDays {
	title: string;
	status: boolean;
	image_url: string;
	label: string;
	deals?: IDeal[];
}

export interface IDeal {
	offer_title: string;
	product_id: number;
	status: boolean;
	end_date: string;
	remainingTime?: IRemainingTime;
	product: IProduct;
}

export interface IRemainingTime {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

export interface IIServices {
	title: string;
	sub_title: string;
	status: boolean;
	image_url: string;
}

export interface IFooter {
	footer_logo?: string;
	footer_class?: string;
}
