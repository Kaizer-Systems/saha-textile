import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';
import { IOrder } from './order.interface';
import { IStores } from './store.interface';
import { IUser } from './user.interface';

export interface IRefundModel extends IPaginateModel {
	data: IRefund[];
}

export interface IRefund {
	id: number;
	reason: string;
	message: string;
	amount: number;
	quantity: number;
	store_id: number;
	store: IStores;
	order: IOrder;
	order_id?: string;
	product_id: number;
	consumer_id: number;
	user: IUser;
	consumer_name?: string;
	consumer_phone?: string;
	variation_id?: number;
	refund_image_id: number;
	payment_type: string;
	status: string;
	refund_status: string;
	is_used: number;
	refund_image: IAttachment;
	total_pending_refunds: number;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
}

export interface IPayoutStatus {
	data: IRefund;
	status?: string;
}
