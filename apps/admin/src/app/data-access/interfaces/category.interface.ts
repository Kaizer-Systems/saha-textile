import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';

export interface ICategoryModel extends IPaginateModel {
	data: ICategory[];
}

export interface ICategory {
	id: number;
	name: string;
	slug: string;
	description: string;
	type: string;
	parent_id?: number;
	category_image?: IAttachment;
	category_image_id?: number;
	category_icon?: IAttachment;
	category_icon_id?: number;
	commission_rate?: number;
	subcategories?: ICategory[];
	status: boolean;
	created_by_id?: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
