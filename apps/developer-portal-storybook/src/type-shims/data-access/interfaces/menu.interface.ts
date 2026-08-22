export interface IMenuModel {
	data: IMenu[];
}

export interface IMenu {
	id?: number;
	parent_id?: number;
	title?: string;
	/** False when `title` is catalog/taxonomy copy and must not go through Transloco. */
	i18nTitle?: boolean;
	/** Interpolation for a Machine-1 title key, e.g. `{ name }` on `view_all`. */
	titleParams?: Record<string, string>;
	path?: string;
	params?: IMenu;
	active?: boolean;
	children?: IMenu[];
	subChildren?: IMenu[];
	icon?: string;
	type?: string | String;
	badge?: string;
	badgeType?: string;
	badgeValue?: string | number;
	level?: number;
	acl_permission?: string[];
	permission?: string[];
	image?: string;
	megaMenuType?: string;
	megaMenu?: boolean;
	slider?: string;
	class?: string;
	label?: string;
	labelClass?: string;
	layout?: string;
	category?: string;
	tag?: string;
	style?: string;
	sidebar?: string;
}

export interface IMobileMenu {
	id?: number;
	active?: boolean;
	title?: string;
	icon?: string;
	path?: string;
}

export interface IBadges {
	product: { total_products: number; total_approved_products: number; total_in_approved_products: number };
	store: { total_stores: number; total_approved_stores: number; total_in_approved_stores: number };
	refund: {
		total_refunds: number;
		total_pending_refunds: number;
		total_approved_refunds: number;
		total_rejected_refunds: number;
	};
	withdraw_request: {
		total_withdraw_requests: number;
		total_pending_withdraw_requests: number;
		total_approved_withdraw_requests: number;
		total_rejected_withdraw_requests: number;
	};
}
