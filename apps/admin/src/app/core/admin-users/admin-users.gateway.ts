import { Observable } from 'rxjs';

export interface AdminUserListItem {
	id: string;
	email: string;
	emailVerified: boolean;
	username: string | null;
	displayName: string | null;
	role: 'staff' | 'admin';
	status: 'active' | 'disabled' | 'pending' | 'locked' | 'deleted';
	pinConfigured: boolean;
	preferredLoginMethod: string;
	adminProfile?: Record<string, unknown>;
	lastLoginAt: string | null;
	createdAt?: string;
}

export interface AdminUserListResponse {
	items: AdminUserListItem[];
	meta: {
		total: number;
		page: number;
		pageSize: number;
	};
}

export interface AdminUserRoleSummary {
	roleId: string;
	key: string;
	label: string;
	baseRole: 'staff' | 'admin';
	assignedAt: string;
	assignedByUserId: string | null;
}

export interface AdminUserAuthority {
	userId: string;
	role: 'staff' | 'admin';
	status: string;
	roles: AdminUserRoleSummary[];
	effectivePermissions: string[];
	/** @deprecated use effectivePermissions — kept for older call sites */
	permissions?: string[];
}

export interface AdminUserStatusInput {
	status: 'active' | 'disabled' | 'pending';
	reason?: string;
}

export interface RoleListItem {
	id: string;
	key: string;
	label: string;
	description?: string | null;
	baseRole: 'staff' | 'admin';
}

export interface RoleListResponse {
	items: RoleListItem[];
}

/**
 * Admin user management gateway — operator CRUD and invites.
 *
 * Separate from commerce customer management (the future `/admin/customers/**`). This
 * administers back-office operators only: staff and admin roles, invite provisioning,
 * status control, and authority inspection.
 */
export abstract class AdminUsersGateway {
	abstract list(params: { page?: number; pageSize?: number }): Observable<AdminUserListResponse>;

	abstract authority(userId: string): Observable<AdminUserAuthority>;

	abstract setStatus(userId: string, input: AdminUserStatusInput): Observable<void>;

	abstract listRoles(): Observable<RoleListResponse>;

	abstract assignRole(userId: string, roleId: string): Observable<AdminUserAuthority>;

	abstract revokeRole(userId: string, roleId: string): Observable<AdminUserAuthority>;
}
