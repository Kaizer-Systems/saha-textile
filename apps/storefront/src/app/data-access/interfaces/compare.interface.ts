import { IPaginateModel } from './core.interface';
import { IProduct } from './product.interface';

export interface ICompareModel extends IPaginateModel {
  data: IProduct[];
}
