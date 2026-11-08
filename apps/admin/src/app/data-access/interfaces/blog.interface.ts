import { IPaginateModel } from './core.interface';

import type { AdminBlogPostRow } from '@saha-textile/contracts';

export interface IBlogModel extends IPaginateModel {
	data: IBlog[];
}

/** A post as the blog table and pickers draw it, with the API row kept for the form. */
export interface IBlog {
	id: string;
	title: string;
	slug: string;
	/** 1 when live, 0 when a draft: the table's switch. */
	status: number;
	blog_thumbnail: { original_url: string } | null;
	published_at: string | null;
	created_at?: string;
	row: AdminBlogPostRow;
}
