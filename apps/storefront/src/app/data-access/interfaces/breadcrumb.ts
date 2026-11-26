export interface IBreadcrumb {
	title: string;
	items: IItem[];
	/**
	 * Writes the title as the page's main heading (h1), read by search engines and screen readers
	 * but not drawn: for pages that have no visible heading of their own (cart, account, sign-in).
	 */
	hiddenHeading?: boolean;
}

export interface IItem {
	label: string;
	url?: string;
	active?: boolean;
}
