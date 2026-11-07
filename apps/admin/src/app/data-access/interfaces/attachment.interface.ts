import { IPaginateModel } from './core.interface';

export interface IAttachmentModel extends IPaginateModel {
	data: IAttachment[];
}

export interface IAttachment {
	id: number | string;
	collection_name: string;
	name: string;
	file_name: string;
	mime_type: string;
	disk: string;
	conversions_disk: string;
	size: string;
	original_url: string;
	width?: number;
	height?: number;
	created_by_id: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
