import { IPaginateModel } from './core.interface';
import { IProduct } from './product.interface';

export interface IWishlistModel extends IPaginateModel {
  data: IProduct[];
}
