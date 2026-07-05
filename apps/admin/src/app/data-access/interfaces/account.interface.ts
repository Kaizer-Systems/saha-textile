import { IAttachment } from './attachment.interface';
import { IRole, IPermission } from './role.interface';
import { IStores } from './store.interface';
import { IWallet } from './wallet.interface';

export interface IAccountUser {
	id: number;
	name: string;
	email: string;
	status: boolean;
	country_code: number;
	phone: string;
	profile: string;
	profile_image?: IAttachment;
	profile_image_id?: number;
	email_verified_at?: string;
	store?: IStores;
	vendor_wallet: IWallet;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string;
	role: IRole;
	permission: IPermission[];
}

export interface IAccountUserUpdatePassword {
	current_password: string;
	new_password: string;
	confirm_password: string;
}
