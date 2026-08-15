import { Observable } from 'rxjs';

export type AdminRoleBase = 'staff' | 'admin';

/** One role definition as returned by `GET/POST/PATCH /admin/roles`. */
export interface AdminRole {
	id: string;
	key: string;
	label: string;
	description: string | null;
	baseRole: AdminRoleBase;
	permissions: string[];
	isSystem: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface AdminRoleListResponse {
	items: AdminRole[];
}

export interface AdminRoleCreateInput {
	key: string;
	label: string;
	description?: string | null;
	baseRole: AdminRoleBase;
	permissions: string[];
}

export interface AdminRoleUpdateInput {
	label?: string;
	description?: string | null;
	permissions?: string[];
}

/** One registry entry from `GET /admin/permissions`. */
export interface PermissionDescriptor {
	code: string;
	resource: string;
	action: string;
	serverOnly: boolean;
}

export interface PermissionListResponse {
	items: PermissionDescriptor[];
}

/**
 * Admin role management gateway — fine-grained role CRUD and the permission registry.
 *
 * Separate from operator invites (`AdminUsersGateway.listRoles` is a slim picker). This surface
 * owns create/update/delete and the grant matrix fed by `GET /admin/permissions`.
 */
export abstract class AdminRolesGateway {
	abstract list(): Observable<AdminRoleListResponse>;

	abstract get(roleId: string): Observable<AdminRole>;

	abstract create(input: AdminRoleCreateInput): Observable<AdminRole>;

	abstract update(roleId: string, input: AdminRoleUpdateInput): Observable<AdminRole>;

	abstract remove(roleId: string): Observable<void>;

	abstract listPermissions(): Observable<PermissionListResponse>;
}
