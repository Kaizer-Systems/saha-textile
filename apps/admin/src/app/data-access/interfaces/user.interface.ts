import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';
import { ICountry } from './country.interface';
import { IPaymentDetails } from './payment-details.interface';
import { IPoint } from './point.interface';
import { IRole } from './role.interface';
import { IStates } from './state.interface';
import { IWallet } from './wallet.interface';

/**
 * Legacy Fastkart mock user for marketplace screens (checkout customer picker, orders,
 * reviews). NOT the signed-in operator — that is {@link AdminUser} in `@core/auth/auth-gateway`.
 *
 * `/admin/users/**` will administer operators only (`DEC-ACCOUNT-SEPARATION` D3); this shape
 * remains until those screens are wired to the real API and customer CRM lands separately.
 */
export interface IUserModel extends IPaginateModel {
	data: IUser[];
}

export interface IUser {
	id: number;
	name: string;
	email: string;
	phone: string;
	country_code: number;
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
	country_code: number;
	country: ICountry;
	phone: number;
	country_id: number;
	is_default: boolean;
}
