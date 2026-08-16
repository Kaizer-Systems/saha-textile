import { IAttachment } from './attachment.interface';
import { ICountry } from './country.interface';
import { IPaymentDetails } from './payment-details.interface';
import { IPoint } from './point.interface';
import { IRole } from './role.interface';
import { IStates } from './state.interface';
import { IWallet } from './wallet.interface';

/**
 * Legacy Fastkart fixture shape, still imported by the order, review, store and refund
 * interfaces of pages that have no API yet. NOT the signed-in operator — that is
 * {@link AdminUser} in `@core/auth/auth-gateway` — and not a customer either, which is
 * `Customer` in `@saha-textile/contracts`.
 *
 * The paginated `IUserModel` wrapper that used to sit here was deleted on 2026-08-15 with
 * the `user.json` mock service it existed for: the Points page, its last caller, now reads
 * the live customer directory like the Customer Ledger beside it. What remains here goes
 * when the pages importing it are wired.
 */
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
