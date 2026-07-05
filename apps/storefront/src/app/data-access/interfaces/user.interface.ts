import { IAttachment } from './attachment.interface';
import { ICountry } from './country.interface';
import { IPaymentDetails } from './payment-details.interface';
import { IPoint } from './point.interface';
import { IRole } from './role.interface';
import { IStates } from './state.interface';
import { IWallet } from './wallet.interface';

export interface IUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  country_code: string;
  profile_image?: IAttachment;
  profile_image_id?: number;
  status: boolean;
  email_verified_at: string;
  payment_account: IPaymentDetails;
  role_id: number;
  role_name?: string;
  role?: IRole;
  address?: IUserAddress[];
  point?: IPoint;
  wallet?: IWallet;
  orders_count: number;
  is_approved: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface IUserAddress {
  id: number;
  user_id: number;
  title: string;
  street: string;
  type: string;
  city: string;
  pincode: string | number;
  state_id: number;
  state: IStates;
  country: ICountry;
  country_code: number;
  phone: number;
  country_id: number;
  is_default: boolean;
}
