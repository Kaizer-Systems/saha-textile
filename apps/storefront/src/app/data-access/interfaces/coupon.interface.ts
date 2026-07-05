import { IPaginateModel } from './core.interface';
import { IProduct } from './product.interface';

export interface ICouponModel extends IPaginateModel {
  data: ICoupon[];
}

export interface ICoupon {
  id: number;
  title: string;
  description: string;
  code: string;
  type: string;
  amount: number;
  min_spend: number;
  max_spend: number;
  is_unlimited: boolean;
  usage_per_coupon: number;
  usage_per_customer: number;
  is_expired: boolean;
  start_date: string;
  end_date: string;
  is_apply_all: boolean;
  exclude_products: IProduct[];
  products: IProduct[];
  is_first_order: boolean;
  status: boolean;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  deleted_at: string;
}
