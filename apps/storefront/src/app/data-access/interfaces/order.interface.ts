import { IPaginateModel } from './core.interface';
import { ICoupon } from './coupon.interface';
import { IOrderStatus } from './order-status.interface';
import { IProduct } from './product.interface';
import { IStores } from './store.interface';
import { IUser, IUserAddress } from './user.interface';
import { ITransactionsData } from './wallet.interface';

export interface IOrderModel extends IPaginateModel {
	data: IOrder[];
}

export interface IOrder {
	id: number;
	order_id: string;
	order_number: number;
	amount: number;
	store_id: number;
	store: IStores;
	consumer_id: number;
	consumer: IUser;
	consumer_name: string;
	products: IProduct[];
	coupon_id: number;
	coupon: ICoupon;
	coupon_total_discount: number;
	billing_address_id: number;
	billing_address: IUserAddress;
	shipping_address_id: number;
	shipping_address: IUserAddress;
	shipping_total: number;
	delivery_interval: string;
	order_status_id: number;
	order_status: IOrderStatus;
	parent_id: number;
	payment_method: string;
	payment_mode: string;
	payment_status: string;
	delivery_description: string;
	order_payment_status: string;
	sub_orders: IOrder[];
	tax_total: number;
	total: number;
	points_amount: number;
	wallet_balance: number;
	transactions: ITransactionsData[];
	invoice_url: string;
	status: boolean;
	created_by_id: number;
	deleted_at?: string;
	created_at?: string;
	updated_at?: string;
}

export interface IOrderCheckout {
	total: ICheckoutTotal;
}

export interface ICheckoutTotal {
	convert_point_amount: number;
	convert_wallet_balance: number;
	coupon_total_discount: number;
	points: number;
	points_amount: number;
	shipping_total: number;
	sub_total: number;
	tax_total: number;
	total: number;
	wallet_balance: number;
}

export interface ICheckoutPayload {
	consumer_id: number;
	products: IOrderProduct[];
	shipping_address_id: number;
	billing_address_id: number;
	coupon?: string;
	points_amount?: boolean;
	wallet_balance?: boolean;
	delivery_description?: string;
	delivery_interval?: string;
	payment_method?: string;
}

export interface IOrderProduct {
	product_id: number;
	variation_id: number | null | String;
	quantity: number;
}

export interface IPlaceOrder {
	is_redirect: boolean;
	order_number: string;
	transaction_id: string;
	url: string;
}

export interface IRePaymentPayload {
	order_number: number;
	payment_method: string;
}
