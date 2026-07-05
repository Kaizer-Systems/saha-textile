import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';
import { IProduct } from './product.interface';
import { IStores } from './store.interface';
import { IUser } from './user.interface';

export interface IReviewModel extends IPaginateModel {
  data: IReview[];
}
export interface IReview {
  id: number;
  consumer: IUser;
  consumer_id: number;
  consumer_name: string;
  description: string;
  product: IProduct;
  product_id: number;
  product_name: string;
  rating: number;
  review_image: IAttachment;
  review_image_id: number;
  product_review_image: IAttachment;
  store: IStores;
  store_id: number;
  created_at?: string;
  deleted_at?: string;
  updated_at?: string;
}
