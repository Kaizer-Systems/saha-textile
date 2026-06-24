export interface PageQuery {
	page?: number;
	pageSize?: number;
}

export interface Paginated<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}
