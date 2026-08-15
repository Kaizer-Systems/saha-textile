import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';

export function injectAdminUsersQuery(params: () => { page?: number; pageSize?: number }) {
	const gateway = inject(AdminUsersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-users', params()],
		queryFn: () => lastValueFrom(gateway.list(params())),
	}));
}

export function injectAdminUserAuthorityQuery(userId: () => string | null) {
	const gateway = inject(AdminUsersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-user-authority', userId()],
		queryFn: () => {
			const id = userId();
			if (!id) throw new Error('userId is required');
			return lastValueFrom(gateway.authority(id));
		},
		enabled: !!userId(),
	}));
}

export function injectRolesForInviteQuery() {
	const gateway = inject(AdminUsersGateway);

	return injectQuery(() => ({
		queryKey: ['admin-roles'],
		queryFn: () => lastValueFrom(gateway.listRoles()),
	}));
}
