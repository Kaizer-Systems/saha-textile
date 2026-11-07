import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminUsersGateway,
	type AdminUserAuthority,
	type AdminUserListResponse,
	type AdminUserStatusInput,
	type RoleListItem,
	type RoleListResponse,
} from './admin-users.gateway';

const ROUTES = {
	list: '/admin/users',
	authority: (userId: string) => `/admin/users/${userId}/authority`,
	status: (userId: string) => `/admin/users/${userId}/status`,
	assignRole: (userId: string) => `/admin/users/${userId}/roles`,
	revokeRole: (userId: string, roleId: string) => `/admin/users/${userId}/roles/${roleId}`,
	roles: '/admin/roles',
} as const;

@Injectable({ providedIn: 'root' })
export class HttpAdminUsersGateway extends AdminUsersGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override list(params: { page?: number; pageSize?: number }): Observable<AdminUserListResponse> {
		const queryParams: Record<string, string> = {};
		if (params.page !== undefined) queryParams['page'] = String(params.page);
		if (params.pageSize !== undefined) queryParams['pageSize'] = String(params.pageSize);

		const query = new URLSearchParams(queryParams).toString();
		const path = query ? `${ROUTES.list}?${query}` : ROUTES.list;

		return this.http.get<AdminUserListResponse>(this.url(path));
	}

	override authority(userId: string): Observable<AdminUserAuthority> {
		return this.http.get<AdminUserAuthority>(this.url(ROUTES.authority(userId))).pipe(
			map((body) => ({
				...body,
				permissions: body.effectivePermissions ?? body.permissions ?? [],
			})),
		);
	}

	override setStatus(userId: string, input: AdminUserStatusInput): Observable<void> {
		return this.http.patch<void>(this.url(ROUTES.status(userId)), input);
	}

	override listRoles(): Observable<RoleListResponse> {
		return this.http.get<{ items: RoleListItem[] }>(this.url(ROUTES.roles)).pipe(
			map((body) => ({
				items: (body.items ?? []).map((role) => ({
					id: role.id,
					key: role.key,
					label: role.label,
					description: role.description ?? null,
					baseRole: role.baseRole,
				})),
			})),
		);
	}

	override assignRole(userId: string, roleId: string): Observable<AdminUserAuthority> {
		return this.http.post<AdminUserAuthority>(this.url(ROUTES.assignRole(userId)), { roleId }).pipe(
			map((body) => ({
				...body,
				permissions: body.effectivePermissions ?? body.permissions ?? [],
			})),
		);
	}

	override revokeRole(userId: string, roleId: string): Observable<AdminUserAuthority> {
		return this.http.delete<AdminUserAuthority>(this.url(ROUTES.revokeRole(userId, roleId))).pipe(
			map((body) => ({
				...body,
				permissions: body.effectivePermissions ?? body.permissions ?? [],
			})),
		);
	}
}
