import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type PermissionListResponse, describePermissions } from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

/**
 * The permission registry, published so a grant screen can render it.
 *
 * Read-only and deliberately so: the registry is a compile-time closed set, not data. A route
 * that could add a code would defeat the whole reason it is closed — an unknown permission
 * would become grantable again, and `RequirePermissions` would stop being a compile-time
 * check. Adding a permission is a code change plus the route that consumes it.
 *
 * There is no service: the answer is a pure function over a constant, and a class that only
 * forwards to one would be indirection with nothing to hide.
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/permissions')
export class PermissionsController {
	@Get()
	@RequirePermissions('permission.index')
	@ApiOperation({ operationId: 'listPermissions', summary: 'The full permission registry' })
	list(): PermissionListResponse {
		return { items: describePermissions() };
	}
}
