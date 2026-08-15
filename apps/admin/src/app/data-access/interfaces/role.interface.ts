import { IPaginateModel } from './core.interface';

export interface IRoleModel extends IPaginateModel {
	data: IRole[];
}

/**
 * Role row for the admin roles table / form.
 *
 * Live API uses string ids and `label`; `name` is kept as the table/form display field
 * (mapped from `label`). `system_reserve` mirrors Fastkart's lock affordance for `isSystem`.
 */
export interface IRole {
	id: string | number;
	name: string;
	key?: string;
	label?: string;
	description?: string | null;
	baseRole?: 'staff' | 'admin';
	isSystem?: boolean;
	/** `'1'` locks edit/delete in the shared Table (system roles). */
	system_reserve?: string;
	guard_name?: string;
	created_at?: string | null;
	updated_at?: string | null;
	/** Permission codes granted to the role (`admin_user.index`, …). */
	permissions?: string[] | IPermission[];
}

/**
 * One resource group in the permissions checkbox matrix.
 *
 * Built from `GET /admin/permissions` by grouping descriptors on `resource`.
 */
export interface IModule {
	id: string | number;
	name: string;
	isChecked: boolean;
	created_at?: string;
	updated_at?: string;
	module_permissions: IPermission[];
}

export interface IPermission {
	id: string | number;
	/** Checkbox value — live API uses the permission code string. */
	permission_id: string | number;
	/** Action half (`index`, `create`, …) or full code for account-store gating. */
	name: string;
	/** Full registry code when known (`role.update`). */
	code?: string;
	isChecked?: boolean;
	guard_name?: string;
	created_at?: string;
	updated_at?: string;
}
