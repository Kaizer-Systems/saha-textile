export interface Params {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic query-param dictionary consumed across the app
	[key: string]: any;
}

export interface IPaginateModel {
	current_page?: number;
	first_page_url?: string;
	from?: number;
	last_page?: number;
	last_page_url?: string;
	links?: ILink[];
	next_page_url?: string;
	path?: string;
	per_page?: number;
	prev_page_url?: string;
	to?: number;
	total: number;
}

export interface ILink {
	active?: number;
	label?: string;
	url?: string;
}
