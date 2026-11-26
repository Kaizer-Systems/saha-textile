import { IPaginateModel } from './core.interface';

export type FaqScope = 'global' | 'category' | 'product' | 'mixed';

export interface IFaqModel extends IPaginateModel {
	data: IFaq[];
}

export interface IFaq {
	id: number;
	title: string;
	description: string;
	titleBn?: string;
	descriptionBn?: string;
	faqId?: string;
	created_by_id: boolean;
	status: boolean;
	scope?: FaqScope;
	categoryIds?: string[];
	productIds?: string[];
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
