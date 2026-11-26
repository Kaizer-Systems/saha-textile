import { Body, Controller, Get, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ShareOpenAnswer, ShareOpenRequest } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MediaSharingService } from './media-sharing.service';

/**
 * Opening a Media share link: the shop's `/s/{code}` page asks here, then sends the browser to the
 * five-minute Spaces address it gets back. Public, never cached, hidden from search engines.
 *
 * `@Audience('admin')` makes the API read the admin session cookie when one comes with the GET,
 * so links for admins only open for a signed-in admin. A password goes in the POST, which the
 * shop sends without cookies: admins-only links take no password, so it never needs them.
 */
@ApiTags(API_TAGS.media)
@Public()
@Audience('admin')
@Controller('share')
export class ShareController {
	constructor(private readonly sharing: MediaSharingService) {}

	@Get(':code')
	@Header('Cache-Control', 'no-store')
	@Header('X-Robots-Tag', 'noindex, nofollow')
	@Header('Referrer-Policy', 'no-referrer')
	@ApiOperation({
		operationId: 'openShareLink',
		summary: 'Check a share link: open, password, admins only or expired',
	})
	open(
		@Param('code') code: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<ShareOpenAnswer> {
		return this.sharing.open(code, { signedInAdmin: principal?.audience === 'admin', ip: request.ip });
	}

	@Post(':code')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@Header('X-Robots-Tag', 'noindex, nofollow')
	@Header('Referrer-Policy', 'no-referrer')
	@ApiOperation({ operationId: 'openShareLinkWithPassword', summary: 'Open a password link' })
	openWithPassword(
		@Param('code') code: string,
		@Body(new ZodValidationPipe(ShareOpenRequest)) body: ShareOpenRequest,
		@Req() request: FastifyRequest,
	): Promise<ShareOpenAnswer> {
		return this.sharing.open(code, { password: body.password ?? '', signedInAdmin: false, ip: request.ip });
	}
}
