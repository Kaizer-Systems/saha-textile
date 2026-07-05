import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';
import { ICountry } from './country.interface';
import { IStates } from './state.interface';
import { IUser } from './user.interface';

export interface IStoresModel extends IPaginateModel {
  data: IStores[];
}

export interface IStores {
  id: number;
  address: string;
  city: string;
  country: ICountry;
  country_id: number;
  description: string;
  hide_vendor_email: boolean;
  hide_vendor_phone: boolean;
  pincode: string;
  product_images: string[];
  slug: string;
  state: IStates;
  state_id: number;
  status: boolean;
  total_in_approved_stores: number;
  is_approved: boolean;
  store_logo: IAttachment;
  store_logo_id: number;
  store_name: string;
  vendor: IUser;
  vendor_id: number;
  facebook: string;
  instagram: string;
  pinterest: string;
  youtube: string;
  twitter: string;
  vendor_name: string;
  order_amount: number;
  orders_count: number;
  reviews_count: number;
  rating_count: number;
  products_count: number;
  created_at?: string;
  updated_at?: string;
}
