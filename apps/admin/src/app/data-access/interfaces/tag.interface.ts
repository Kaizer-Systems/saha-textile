import { IPaginateModel } from './core.interface';

import type { BlogTag } from '@saha-textile/contracts';

export interface ITagModel extends IPaginateModel {
	data: ITag[];
}

export interface ITag {
	/** A number on the theme's demo tags, a string on blog tags. */
	id: number | string;
	name: string;
	slug: string;
	description?: string;
	type: string;
	/** A boolean on the theme's demo tags; '1' or '0' on blog tags, as the shared table's switch reads it. */
	status: boolean | '1' | '0';
	created_by_id: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
	/** A blog tag, every language as the API holds it. */
	blog?: BlogTag;
}
