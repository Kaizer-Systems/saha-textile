export type ParamValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;

export interface Params {
	[key: string]: ParamValue;
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
