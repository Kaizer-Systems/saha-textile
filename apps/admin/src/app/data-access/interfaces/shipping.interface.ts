import { IPaginateModel } from './core.interface';
import { ICountry } from './country.interface';

export interface IShippingModel extends IPaginateModel {
	data: IShipping[];
}

export interface IShipping {
	id: number;
	country_id: number;
	country: ICountry;
	status: boolean;
	created_by_id: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
	shipping_rules: IShippingRule[];
}

export interface IShippingRule {
	id: number;
	name: string;
	shipping_id: number;
	rule_type: string;
	min: number;
	max: number;
	shipping_type: string;
	amount: number;
	status: boolean;
	created_by_id: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
