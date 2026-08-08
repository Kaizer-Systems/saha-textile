import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddCartLineRequest, CreateCartRequest, UpdateCartLineRequest } from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Public } from '../auth/session.guard';
import { cookieNames, sessionCookieOptions } from '../common/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CartService, toPublicCart } from './cart.service';
import { API_TAGS } from '../openapi-tags';

const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;

@ApiTags(API_TAGS.cart)
@Controller('cart')
/**
 * Guest add-to-cart is an owner lock, so create/read/mutate stay reachable without an
 * account. Ownership is still enforced: authenticated carts bind to Principal; guest
 * carts require the httpOnly `st_guest` proof whose hash is stored server-side.
 */
@Public()
export class CartController {
	constructor(
		private readonly cart: CartService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	private actor(
		request: FastifyRequest,
		principal: AuthenticatedPrincipal | undefined,
	): { principal?: AuthenticatedPrincipal; guestToken: string | null; allowReadRoles: readonly string[] } {
		const names = cookieNames(this.config);
		const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies ?? {};
		return {
			principal,
			guestToken: cookies[names.guest] ?? null,
			allowReadRoles: ['staff', 'admin'],
		};
	}

	@Post()
	@ApiOperation({ operationId: 'createCart', summary: 'Create a new (guest or user) cart' })
	async create(
		@Body(new ZodValidationPipe(CreateCartRequest)) body: CreateCartRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		const { cart, guestTokenRaw } = await this.cart.createCart({
			principal,
			currency: body.currency,
		});
		if (guestTokenRaw) {
			const names = cookieNames(this.config);
			void reply.setCookie(names.guest, guestTokenRaw, sessionCookieOptions(this.config, GUEST_TTL_SECONDS));
		}
		return toPublicCart(cart);
	}

	@Get(':id')
	@ApiOperation({ operationId: 'getCart', summary: 'Get a cart by id' })
	async get(
		@Param('id') id: string,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const cart = await this.cart.getCart(id, this.actor(request, principal));
		return toPublicCart(cart);
	}

	@Post(':id/lines')
	@ApiOperation({ operationId: 'addCartLine', summary: 'Add a line to a cart' })
	async addLine(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AddCartLineRequest)) body: AddCartLineRequest,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const cart = await this.cart.addLine(id, body, this.actor(request, principal));
		return toPublicCart(cart);
	}

	@Patch(':id/lines/:lineId')
	@ApiOperation({ operationId: 'updateCartLine', summary: 'Update the quantity of a cart line' })
	async updateLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(UpdateCartLineRequest)) body: UpdateCartLineRequest,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const cart = await this.cart.updateLineQuantity(id, lineId, body.quantity, this.actor(request, principal));
		return toPublicCart(cart);
	}

	@Delete(':id/lines/:lineId')
	@ApiOperation({ operationId: 'removeCartLine', summary: 'Remove a line from a cart' })
	async removeLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const cart = await this.cart.removeLine(id, lineId, this.actor(request, principal));
		return toPublicCart(cart);
	}
}
