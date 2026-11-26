import { Body, Controller, Get, Header, Put, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type CommunicationSettingsResponse, CommunicationSwitchWrite } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CommunicationsService } from './communications.service';

const requestIdOf = (request: FastifyRequest): string | null => (typeof request.id === 'string' ? request.id : null);

/**
 * Settings › Communications. Super admin for now, through the Settings codes: reading needs
 * `setting.index`, every change `setting.edit`, the same as Stores and Notification settings.
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/communications')
export class CommunicationsController {
	constructor(private readonly communications: CommunicationsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'getCommunicationSettings',
		summary: 'Every approved message with its email, SMS and WhatsApp switches',
	})
	view(): Promise<CommunicationSettingsResponse> {
		return this.communications.view();
	}

	@Put()
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'setCommunicationSwitch',
		summary: 'Switch one message on or off for one channel (password for a cell with a warning; audited)',
	})
	change(
		@Body(new ZodValidationPipe(CommunicationSwitchWrite)) body: CommunicationSwitchWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<CommunicationSettingsResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.communications.change(principal.userId, body, requestIdOf(request));
	}
}
