import {
	Body,
	Controller,
	Delete,
	Get,
	Inject,
	Param,
	Patch,
	Post,
	Req,
	Res,
	UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddCartLineRequest, UpdateCartLineRequest } from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Public } from '../auth/session.guard';
import { CatalogLocaleInterceptor } from '../catalog/catalog-locale';
import { CatalogRateLimit } from '../catalog/catalog-rate-limit';
import { cookieNames, sessionCookieOptions } from '../common/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { API_TAGS } from '../openapi-tags';
import { CartLinesService, type CartOwner } from './cart-lines.service';
import { CartService, toPublicCart } from './cart.service';

const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;

@ApiTags(API_TAGS.cart)
@Controller('cart')
/**
 * Guest add-to-cart is an owner lock, so these routes stay reachable without an account. The
 * cart is found from the session or the httpOnly `st_guest` cookie, never from an id the browser
 * sends, so one shopper cannot name another's cart.
 */
@Public()
@UseInterceptors(CatalogLocaleInterceptor)
export class CartController {
	constructor(
		private readonly cart: CartService,
		private readonly lines: CartLinesService,
		private readonly limits: CatalogRateLimit,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	private guestToken(request: FastifyRequest): string | null {
		const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies ?? {};
		return cookies[cookieNames(this.config).guest] ?? null;
	}

	private owner(request: FastifyRequest, principal: AuthenticatedPrincipal | undefined): CartOwner {
		return { principal, guestToken: this.guestToken(request) };
	}

	/** Every change restarts the guest cookie's 30 days, matching the cart's own expiry. */
	private keepGuest(reply: FastifyReply, token: string | null): void {
		if (!token) return;
		const name = cookieNames(this.config).guest;
		void reply.setCookie(name, token, sessionCookieOptions(this.config, GUEST_TTL_SECONDS));
	}

	@Get('current')
	@ApiOperation({ operationId: 'getCurrentCart', summary: "The shopper's cart, priced from the live catalogue" })
	current(@Req() request: FastifyRequest, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.lines.current(this.owner(request, principal));
	}

	@Post('current/lines')
	@ApiOperation({ operationId: 'addCartLine', summary: 'Add a line, starting a cart when there is none' })
	async addLine(
		@Body(new ZodValidationPipe(AddCartLineRequest)) body: AddCartLineRequest,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		await this.limits.enforce('cart_write', { ip: request.ip });
		const owner = this.owner(request, principal);
		const { view, guestTokenRaw } = await this.lines.add(body, owner);
		this.keepGuest(reply, guestTokenRaw ?? owner.guestToken ?? null);
		return view;
	}

	@Patch('current/lines/:lineId')
	@ApiOperation({ operationId: 'updateCartLine', summary: 'Change a line quantity or its choices' })
	async updateLine(
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(UpdateCartLineRequest)) body: UpdateCartLineRequest,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		await this.limits.enforce('cart_write', { ip: request.ip });
		const owner = this.owner(request, principal);
		const view = await this.lines.update(lineId, body, owner);
		this.keepGuest(reply, owner.guestToken ?? null);
		return view;
	}

	@Delete('current/lines/:lineId')
	@ApiOperation({ operationId: 'removeCartLine', summary: 'Remove a line' })
	async removeLine(
		@Param('lineId') lineId: string,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		await this.limits.enforce('cart_write', { ip: request.ip });
		const owner = this.owner(request, principal);
		const view = await this.lines.remove(lineId, owner);
		this.keepGuest(reply, owner.guestToken ?? null);
		return view;
	}

	@Get(':id')
	@ApiOperation({ operationId: 'getCart', summary: 'Read a cart by id, for its owner or support staff' })
	async get(
		@Param('id') id: string,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const cart = await this.cart.getCart(id, {
			principal,
			guestToken: this.guestToken(request),
			allowReadPermissions: ['cart.index'],
		});
		return toPublicCart(cart);
	}
}
