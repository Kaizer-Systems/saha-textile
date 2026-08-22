export interface IMenu {
	id?: number;
	path?: string;
	params?: IMenu;
	title?: string;
	/** False when `title` is catalog/taxonomy copy and must not go through Transloco. */
	i18nTitle?: boolean;
	/** Interpolation for a Machine-1 title key, e.g. `{ name }` on `view_all`. */
	titleParams?: Record<string, string>;
	type?: string;
	active?: boolean;
	image?: string;
	megaMenuType?: string;
	badge?: string;
	megaMenu?: boolean;
	children?: IMenu[];
	subChildren?: IMenu[];
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
