import { IPaginateModel } from './core.interface';

export interface IPageModel extends IPaginateModel {
	data: IPage[];
}

export interface IPage {
	id: number;
	title: string;
	slug: string;
	content: string;
	status: boolean;
	meta_title: string;
	meta_description: string;
	created_by_id?: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface IFaqModel extends IPaginateModel {
	data: IFaq[];
}

export interface IFaq {
	id: number;
	title: string;
	description: string;
	created_by_id: string;
	status: string;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface IFooterPage {
	link: string;
	label: string;
}

export interface IContactUsModel {
	name: string;
	email: string;
	phone: number;
	subject: string;
	message: string;
}
