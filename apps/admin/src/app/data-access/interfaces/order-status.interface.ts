import { IPaginateModel } from './core.interface';
import { IBaseRow } from './table.interface';

export interface IOrderStatusModel extends IPaginateModel {
	data: IOrderStatus[];
}

export interface IOrderStatus extends IBaseRow {
	id: number;
	name: string;
	sequence: number;
	slug: string;
	created_by_id: number;
	status: boolean;
	deleted_at?: string;
	created_at?: string;
	updated_at?: string;
}
