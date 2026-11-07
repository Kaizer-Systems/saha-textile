import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';

export interface ICategoryModel extends IPaginateModel {
	data: ICategory[];
}

/** One placement of a category in the taxonomy DAG (canonical parent + optional extra merchandising spots). */
export interface ICategoryPlacement {
	parent_id: number | string | null;
	path: string;
	canonical: boolean;
}

export interface ICategory {
	id: number | string;
	name: string;
	slug: string;
	description: string;
	type: string;
	parent_id?: number | string;
	/** DAG depth: 1 = top-level, 2/3/… = nested. From category.json. */
	level?: number;
	/** Single canonical URL path, e.g. `sarees/pure-silk/katan-banarasi`. From category.json. */
	canonical_path?: string;
	/** All placements (canonical + extra). Extra placements are NOT traversed when building the nav tree. */
	placements?: ICategoryPlacement[];
	category_image?: IAttachment;
	category_image_id?: number;
	category_icon?: IAttachment;
	category_icon_id?: number;
	commission_rate?: number;
	subcategories?: ICategory[];
	products_count: number;
	/** The category's own image, else its first product's photo. */
	cover_image?: IAttachment;
	status: boolean;
	created_by_id?: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
