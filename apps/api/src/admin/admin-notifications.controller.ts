import { Body, Controller, Get, Patch, Put, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	NotificationChannelSettingsListResponse,
	NotificationChannelToggleRequest,
	type NotificationProviderStatus,
	NotificationTemplateListResponse,
	NotificationTemplateUpsertRequest,
	NotificationUsageListResponse,
	type NotificationChannelSettings,
	type NotificationTemplate,
} from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminNotificationsService } from './admin-notifications.service';

const requestIdOf = (request: FastifyRequest): string | null => (typeof request.id === 'string' ? request.id : null);

/**
 * Admin notification Settings — kill-switches, usage, templates.
 *
 * No Authkey read/write routes: secrets stay in API env (owner lock option A).
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/notifications')
export class AdminNotificationsController {
	constructor(private readonly notifications: AdminNotificationsService) {}

	@Get('provider')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'getNotificationProviderStatus',
		summary: 'Non-secret MSG91/console provider status (Authkey never returned)',
	})
	provider(): NotificationProviderStatus {
		return this.notifications.providerStatus();
	}

	@Get('channels')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'listNotificationChannels',
		summary: 'List channel × category kill-switches and plan limits',
	})
	async listChannels(): Promise<NotificationChannelSettingsListResponse> {
		return { items: await this.notifications.listChannels() };
	}

	@Patch('channels')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'toggleNotificationChannel',
		summary: 'Update a channel × category kill-switch / plan limit (audited)',
	})
	toggle(
		@Body(new ZodValidationPipe(NotificationChannelToggleRequest)) body: NotificationChannelToggleRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<NotificationChannelSettings> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.notifications.toggle(principal.userId, body, requestIdOf(request));
	}

	@Get('usage')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'listNotificationUsage',
		summary: 'Usage vs plan per channel × category',
	})
	async usage(): Promise<NotificationUsageListResponse> {
		return { items: await this.notifications.usage() };
	}

	@Get('templates')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'listNotificationTemplates',
		summary: 'List notification templates (provider ids only; no secrets)',
	})
	async listTemplates(): Promise<NotificationTemplateListResponse> {
		return { items: await this.notifications.listTemplates() };
	}

	@Put('templates')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'upsertNotificationTemplate',
		summary: 'Upsert template metadata and MSG91 Flow/WhatsApp ids (audited)',
	})
	upsertTemplate(
		@Body(new ZodValidationPipe(NotificationTemplateUpsertRequest)) body: NotificationTemplateUpsertRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<NotificationTemplate> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.notifications.upsertTemplate(principal.userId, body, requestIdOf(request));
	}
}
