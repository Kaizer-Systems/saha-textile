import { IPaginateModel } from './core.interface';

export interface IFaqModel extends IPaginateModel {
	data: IFaq[];
}

export interface IFaq {
	id: number;
	title: string;
	description: string;
	created_by_id: boolean;
	status: boolean;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
