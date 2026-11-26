import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	Post,
	Req,
	UnauthorizedException,
	UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	Id,
	WishlistAddRequest,
	type WishlistIds,
	WishlistMergeRequest,
	type WishlistView,
} from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience } from '../auth/session.guard';
import { CatalogLocaleInterceptor } from '../catalog/catalog-locale';
import { CatalogRateLimit } from '../catalog/catalog-rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { WishlistService } from './wishlist.service';

/**
 * The signed-in customer's wishlist. No customer id appears in a route: the owner is the
 * session, so one shopper can never read or change another's list.
 */
@ApiTags(API_TAGS.wishlist)
@Controller('storefront/wishlist')
@Audience('storefront')
@UseInterceptors(CatalogLocaleInterceptor)
export class WishlistController {
	constructor(
		private readonly wishlist: WishlistService,
		private readonly limits: CatalogRateLimit,
	) {}

	private ownerId(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}

	@Get()
	@Header('Cache-Control', 'private, no-store')
	@ApiOperation({ operationId: 'getWishlist', summary: 'Your saved product ids, and cards for those on sale' })
	view(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<WishlistView> {
		return this.wishlist.view(this.ownerId(principal));
	}

	@Post()
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'addToWishlist', summary: 'Save a product; saving it again changes nothing' })
	async add(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(WishlistAddRequest)) body: WishlistAddRequest,
		@Req() request: FastifyRequest,
	): Promise<WishlistIds> {
		const customerId = this.ownerId(principal);
		await this.limits.enforce('wishlist_write', { ip: request.ip });
		return this.wishlist.add(customerId, body.productId);
	}

	@Post('merge')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'mergeWishlist', summary: 'Move the guest list into the account on sign-in' })
	async merge(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(WishlistMergeRequest)) body: WishlistMergeRequest,
		@Req() request: FastifyRequest,
	): Promise<WishlistIds> {
		const customerId = this.ownerId(principal);
		await this.limits.enforce('wishlist_write', { ip: request.ip });
		return this.wishlist.merge(customerId, body.productIds);
	}

	@Delete(':productId')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'removeFromWishlist', summary: 'Remove a saved product' })
	async remove(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Param('productId', new ZodValidationPipe(Id)) productId: string,
		@Req() request: FastifyRequest,
	): Promise<WishlistIds> {
		const customerId = this.ownerId(principal);
		await this.limits.enforce('wishlist_write', { ip: request.ip });
		return this.wishlist.remove(customerId, productId);
	}
}
