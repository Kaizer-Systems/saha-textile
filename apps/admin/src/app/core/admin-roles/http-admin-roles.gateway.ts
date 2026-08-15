import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminRolesGateway,
	type AdminRole,
	type AdminRoleCreateInput,
	type AdminRoleListResponse,
	type AdminRoleUpdateInput,
	type PermissionListResponse,
} from './admin-roles.gateway';

const ROUTES = {
	roles: '/admin/roles',
	role: (roleId: string) => `/admin/roles/${roleId}`,
	permissions: '/admin/permissions',
} as const;

@Injectable({ providedIn: 'root' })
export class HttpAdminRolesGateway extends AdminRolesGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override list(): Observable<AdminRoleListResponse> {
		return this.http.get<AdminRoleListResponse>(this.url(ROUTES.roles)).pipe(
			map((body) => ({
				items: (body.items ?? []).map((role) => this.normalizeRole(role)),
			})),
		);
	}

	override get(roleId: string): Observable<AdminRole> {
		return this.http.get<AdminRole>(this.url(ROUTES.role(roleId))).pipe(map((role) => this.normalizeRole(role)));
	}

	override create(input: AdminRoleCreateInput): Observable<AdminRole> {
		return this.http.post<AdminRole>(this.url(ROUTES.roles), input).pipe(map((role) => this.normalizeRole(role)));
	}

	override update(roleId: string, input: AdminRoleUpdateInput): Observable<AdminRole> {
		return this.http
			.patch<AdminRole>(this.url(ROUTES.role(roleId)), input)
			.pipe(map((role) => this.normalizeRole(role)));
	}

	override remove(roleId: string): Observable<void> {
		return this.http.delete<void>(this.url(ROUTES.role(roleId)));
	}

	override listPermissions(): Observable<PermissionListResponse> {
		return this.http.get<PermissionListResponse>(this.url(ROUTES.permissions)).pipe(
			map((body) => ({
				items: body.items ?? [],
			})),
		);
	}

	private normalizeRole(role: AdminRole): AdminRole {
		return {
			id: role.id,
			key: role.key,
			label: role.label,
			description: role.description ?? null,
			baseRole: role.baseRole,
			permissions: role.permissions ?? [],
			isSystem: Boolean(role.isSystem),
			createdAt: role.createdAt,
			updatedAt: role.updatedAt,
		};
	}
}
