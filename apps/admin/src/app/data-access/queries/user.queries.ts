import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { UserService } from '@data-access/services/user.service';

export function injectUsersQuery(params: () => Params) {
	const userService = inject(UserService);
	return injectQuery(() => ({
		queryKey: ['users', params()],
		queryFn: () => firstValueFrom(userService.getUsers(params())),
	}));
}
