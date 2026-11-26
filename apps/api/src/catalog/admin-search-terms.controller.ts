import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminSearchTermListQuery,
	SearchTermStatusWrite,
	SearchTermWrite,
	StorefrontSearchSettings,
	StorefrontShareSettings,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { SearchTermsService } from './search-terms.service';
import { ShareSettingsService } from './share-settings.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/** Products › Search words. */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/search-terms')
export class AdminSearchTermsController {
	constructor(private readonly terms: SearchTermsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('search_term.index')
	@ApiOperation({ operationId: 'listSearchTerms', summary: 'Every search word, any status' })
	list(@Query(new ZodValidationPipe(AdminSearchTermListQuery)) query: AdminSearchTermListQuery) {
		return this.terms.list(query);
	}

	@Post('status')
	@HttpCode(200)
	@RequirePermissions('search_term.edit')
	@ApiOperation({ operationId: 'setSearchTermStatus', summary: 'Bulk Go Live or Take off shop' })
	status(
		@Body(new ZodValidationPipe(SearchTermStatusWrite)) body: SearchTermStatusWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.terms.setStatus(body.ids, body.status, actor(principal));
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('search_term.index')
	@ApiOperation({ operationId: 'getSearchTerm', summary: 'One search word with its tagged products, for the form' })
	detail(@Param('id') id: string) {
		return this.terms.detail(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('search_term.create')
	@ApiOperation({ operationId: 'createSearchTerm', summary: 'Add a search word' })
	create(
		@Body(new ZodValidationPipe(SearchTermWrite)) body: SearchTermWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.terms.save(null, body, actor(principal));
	}

	@Post(':id')
	@HttpCode(200)
	@RequirePermissions('search_term.edit')
	@ApiOperation({ operationId: 'updateSearchTerm', summary: 'Save a search word' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SearchTermWrite)) body: SearchTermWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.terms.save(id, body, actor(principal));
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('search_term.destroy')
	@ApiOperation({ operationId: 'deleteSearchTerm', summary: 'Delete a search word' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.terms.remove(id, actor(principal));
	}
}

/** Store front › Storefront settings. One route per group; Search is the first. */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/storefront-settings')
export class AdminStorefrontSettingsController {
	constructor(
		private readonly terms: SearchTermsService,
		private readonly share: ShareSettingsService,
	) {}

	@Get('search')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'getStorefrontSearchSettings', summary: 'Which categories show first in search' })
	search() {
		return this.terms.getSearchSettings();
	}

	@Put('search')
	@HttpCode(200)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'saveStorefrontSearchSettings',
		summary: 'Save Search; the shop is re-indexed in the background',
	})
	saveSearch(
		@Body(new ZodValidationPipe(StorefrontSearchSettings)) body: StorefrontSearchSettings,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.terms.saveSearchSettings(body, actor(principal));
	}

	@Get('share')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'getStorefrontShareSettings', summary: "The share menu's shop-wide choices" })
	sharing() {
		return this.share.get();
	}

	@Put('share')
	@HttpCode(200)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'saveStorefrontShareSettings', summary: 'Save Sharing' })
	saveSharing(
		@Body(new ZodValidationPipe(StorefrontShareSettings)) body: StorefrontShareSettings,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.share.save(body, actor(principal));
	}
}
