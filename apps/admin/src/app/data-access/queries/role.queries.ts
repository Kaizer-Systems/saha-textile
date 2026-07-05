import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { RoleService } from '@data-access/services/role.service';

export function injectRolesQuery(params: () => Params) {
	const roleService = inject(RoleService);
	return injectQuery(() => ({
		queryKey: ['roles', params()],
		queryFn: () => firstValueFrom(roleService.getRoles(params())),
	}));
}

export function injectRoleModulesQuery() {
	const roleService = inject(RoleService);
	return injectQuery(() => ({
		queryKey: ['role-modules'],
		queryFn: () => firstValueFrom(roleService.getRoleModules()),
	}));
}
