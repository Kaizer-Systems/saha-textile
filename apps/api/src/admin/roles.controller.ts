import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Req,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	RoleCreateRequest,
	type RoleListResponse,
	type RoleResponse,
	RoleUpdateRequest,
} from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { RolesService } from './roles.service';

/**
 * Role administration — the first surface in this API that is deny-by-default.
 *
 * Every route demands a specific permission through `@RequirePermissions`, and `SessionGuard`
 * holds that a grant list is authoritative: the `admin` ROLE alone opens nothing here. That is
 * the point of the registry, and it is why these routes could be added without locking anybody
 * out — they are new, so no existing capability starts refusing.
 *
 * `@Audience('admin')` is not redundant beside the permission checks. A storefront session
 * that somehow held an administrative grant must still be unable to reach this surface,
 * because the audience boundary is about which browser context a cookie was minted for, not
 * about what its holder may do.
 *
 * Editing a role changes what everyone holding it can do, so the service invalidates live
 * holders. That belongs in the service rather than here: the controller's job is to say who
 * may call, not to know what a change implies.
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/roles')
export class RolesController {
	constructor(private readonly roles: RolesService) {}

	@Get()
	@RequirePermissions('role.index')
	@ApiOperation({ operationId: 'listRoles', summary: 'List every role definition' })
	async list(): Promise<RoleListResponse> {
		return { items: await this.roles.list() };
	}

	@Get(':id')
	@RequirePermissions('role.index')
	@ApiOperation({ operationId: 'getRole', summary: 'Get one role definition' })
	get(@Param('id') id: string): Promise<RoleResponse> {
		return this.roles.get(id);
	}

	@Post()
	@RequirePermissions('role.create')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ operationId: 'createRole', summary: 'Create a role (audited)' })
	create(
		@Body(new ZodValidationPipe(RoleCreateRequest)) body: RoleCreateRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<RoleResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.roles.create(principal.userId, body, requestIdOf(request));
	}

	@Patch(':id')
	@RequirePermissions('role.update')
	@ApiOperation({ operationId: 'updateRole', summary: 'Edit a role; live holders are re-authorized (audited)' })
	async update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(RoleUpdateRequest)) body: RoleUpdateRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<RoleResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		const { role } = await this.roles.update(principal.userId, id, body, requestIdOf(request));
		return role;
	}

	@Delete(':id')
	@RequirePermissions('role.destroy')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'deleteRole', summary: 'Delete a role; live holders are re-authorized (audited)' })
	async remove(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<void> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		await this.roles.remove(principal.userId, id, requestIdOf(request));
	}
}

const requestIdOf = (request: FastifyRequest): string | null => (typeof request.id === 'string' ? request.id : null);
