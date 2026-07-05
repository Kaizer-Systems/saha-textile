import { IProduct, IVariation } from './product.interface';

export interface ICartModel {
  items: ICart[];
  total?: number;
}

export interface ICart {
  id: number;
  product_id: number;
  variation: IVariation;
  variation_id: number | null;
  consumer_id?: number;
  quantity: number;
  sub_total: number;
  product: IProduct;
  created_by_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface ICartAddOrUpdate {
  id: number | null;
  product: IProduct | null;
  product_id: number;
  variation: IVariation | null;
  variation_id: number | null;
  quantity: number;
}
