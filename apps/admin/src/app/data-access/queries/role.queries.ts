import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom, map } from 'rxjs';

import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import type { IModule, IRole, IRoleModel } from '@data-access/interfaces/role.interface';

/** Map a live API role into the table/form `IRole` shape (`name` ← `label`). */
export function toRoleRow(role: {
	id: string;
	key: string;
	label: string;
	description?: string | null;
	baseRole: 'staff' | 'admin';
	permissions: string[];
	isSystem: boolean;
	createdAt: string;
	updatedAt: string;
}): IRole {
	return {
		id: role.id,
		name: role.label,
		key: role.key,
		label: role.label,
		description: role.description ?? null,
		baseRole: role.baseRole,
		isSystem: role.isSystem,
		system_reserve: role.isSystem ? '1' : '0',
		created_at: role.createdAt ?? null,
		updated_at: role.updatedAt ?? null,
		permissions: role.permissions ?? [],
	};
}

/**
 * Group permission registry entries into the existing checkbox-matrix `IModule` shape.
 * No new CSS — same resource row + action toggles the template already renders.
 */
export function permissionsToModules(items: Array<{ code: string; resource: string; action: string }>): IModule[] {
	const byResource = new Map<string, IModule>();

	for (const item of items) {
		let module = byResource.get(item.resource);
		if (!module) {
			module = {
				id: item.resource,
				name: item.resource,
				isChecked: false,
				module_permissions: [],
			};
			byResource.set(item.resource, module);
		}
		module.module_permissions.push({
			id: item.code,
			permission_id: item.code,
			name: item.action,
			code: item.code,
			isChecked: false,
		});
	}

	return [...byResource.values()];
}

export function injectRolesQuery(_params: () => Params = () => ({})) {
	const gateway = inject(AdminRolesGateway);

	return injectQuery(() => ({
		queryKey: ['admin-roles', 'list'],
		queryFn: () =>
			lastValueFrom(
				gateway.list().pipe(
					map((response): IRoleModel => {
						const data = (response.items ?? []).map(toRoleRow);
						return {
							data,
							total: data.length,
						};
					}),
				),
			),
	}));
}

export function injectRoleQuery(roleId: () => string | null) {
	const gateway = inject(AdminRolesGateway);

	return injectQuery(() => ({
		queryKey: ['admin-roles', 'detail', roleId()],
		queryFn: () => {
			const id = roleId();
			if (!id) throw new Error('roleId is required');
			return lastValueFrom(gateway.get(id).pipe(map(toRoleRow)));
		},
		enabled: !!roleId(),
	}));
}

/** Permission registry for the grant matrix (`GET /admin/permissions`). */
export function injectRoleModulesQuery() {
	const gateway = inject(AdminRolesGateway);

	return injectQuery(() => ({
		queryKey: ['admin-permissions'],
		queryFn: () =>
			lastValueFrom(
				gateway.listPermissions().pipe(map((response) => permissionsToModules(response.items ?? []))),
			),
	}));
}
