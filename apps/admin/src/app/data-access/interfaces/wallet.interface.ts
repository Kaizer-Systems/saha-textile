import { IPaginateModel } from './core.interface';
import { IBaseRow } from './table.interface';

export interface IWallet {
	id?: number;
	consumer_id: number;
	balance: number;
	transactions: ITransactions;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface ITransactions extends IPaginateModel {
	data: ITransactionsData[];
}

export interface ITransactionsData extends IBaseRow {
	id: number;
	wallet_id: number;
	order_id: number;
	point_id: number;
	amount: number;
	type: string;
	type_status: string;
	detail: string;
	from: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}
