import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminUserAuthorityResponse,
	type AdminUserListResponse,
	AdminUserListQuery,
	AdminUserStatusRequest,
	AssignRoleRequest,
} from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminUsersService } from './admin-users.service';

/**
 * Operator administration — directory, authority, and offboarding.
 *
 * Deny-by-default like `/admin/roles`, but the permissions are split more finely on purpose.
 * Granting authority and removing it are separate codes because the dangerous direction is
 * upward: `no-delegation-above-self` constrains only granting, and an operator who may
 * offboard somebody need not be one who may promote them. Reading the directory or an
 * account's authority is gated by `admin_user.index` rather than by either, since seeing who holds
 * what is not itself a privileged mutation.
 *
 * This surface administers operators only (`DEC-ACCOUNT-SEPARATION` D3).
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/users')
export class AdminUsersController {
	constructor(private readonly users: AdminUsersService) {}

	@Get()
	@RequirePermissions('admin_user.index')
	@ApiOperation({ operationId: 'listAdminUsers', summary: 'Paginated operator directory' })
	list(@Query(new ZodValidationPipe(AdminUserListQuery)) query: AdminUserListQuery): Promise<AdminUserListResponse> {
		return this.users.list(query);
	}

	@Get(':userId/authority')
	@RequirePermissions('admin_user.index')
	@ApiOperation({ operationId: 'getUserAuthority', summary: 'Roles held and the resolved permission set' })
	authority(@Param('userId') userId: string): Promise<AdminUserAuthorityResponse> {
		return this.users.authority(userId);
	}

	@Post(':userId/roles')
	@RequirePermissions('admin_user_role.assign')
	@ApiOperation({
		operationId: 'assignAdminUserRole',
		summary: 'Grant a role; refused above the actor’s own authority (audited)',
	})
	assign(
		@Param('userId') userId: string,
		@Body(new ZodValidationPipe(AssignRoleRequest)) body: AssignRoleRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<AdminUserAuthorityResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.users.assignRole(principal.userId, userId, body.roleId, requestIdOf(request));
	}

	@Delete(':userId/roles/:roleId')
	@RequirePermissions('admin_user_role.revoke')
	@ApiOperation({
		operationId: 'revokeAdminUserRole',
		summary: 'Revoke a role; refused for the last administrator (audited)',
	})
	revoke(
		@Param('userId') userId: string,
		@Param('roleId') roleId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<AdminUserAuthorityResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.users.revokeRole(principal.userId, userId, roleId, requestIdOf(request));
	}

	@Patch(':userId/status')
	@RequirePermissions('admin_user.update')
	@ApiOperation({
		operationId: 'setUserStatus',
		summary: 'Enable or disable an account; disabling revokes every session (audited)',
	})
	setStatus(
		@Param('userId') userId: string,
		@Body(new ZodValidationPipe(AdminUserStatusRequest)) body: AdminUserStatusRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<AdminUserAuthorityResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.users.setStatus(principal.userId, userId, body.status, body.reason ?? null, requestIdOf(request));
	}
}

const requestIdOf = (request: FastifyRequest): string | null => (typeof request.id === 'string' ? request.id : null);
