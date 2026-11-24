import { Body, Controller, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetDisposal, FixedAssetEdit, FixedAssetWrite, YearMonth } from '@saha-textile/contracts';
import { ASSET_CATEGORIES, RESIDUAL_PERCENT } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AssetsService } from './assets.service';

/** Fixed assets and their monthly depreciation (accounts brief R1–R4). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/assets')
export class AssetsController {
	constructor(private readonly assets: AssetsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'assetsList', summary: 'The fixed asset register (R1)' })
	list() {
		return this.assets.list();
	}

	@Get('categories')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'assetsCategories', summary: 'Kinds of asset with their presets (R2)' })
	categories() {
		return { categories: ASSET_CATEGORIES, residualPercent: RESIDUAL_PERCENT };
	}

	@Get('depreciation/:month')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'assetsDepreciationPreview', summary: 'A month’s depreciation (R3)' })
	preview(@Param('month', new ZodValidationPipe(YearMonth)) month: string) {
		return this.assets.preview(month);
	}

	@Post('depreciation/:month')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'assetsDepreciationPost', summary: 'Post a month’s depreciation once (R3)' })
	post(
		@Param('month', new ZodValidationPipe(YearMonth)) month: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.assets.post(month, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'assetsGet', summary: 'A fixed asset (R4)' })
	get(@Param('id') id: string) {
		return this.assets.get(id);
	}

	@Post()
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'assetsCreate', summary: 'Add a fixed asset (R2)' })
	create(
		@Body(new ZodValidationPipe(FixedAssetWrite)) body: FixedAssetWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.assets.create(body, principal);
	}

	@Put(':id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'assetsUpdate', summary: 'Change a fixed asset (R4)' })
	update(@Param('id') id: string, @Body(new ZodValidationPipe(FixedAssetEdit)) body: FixedAssetEdit) {
		return this.assets.update(id, body);
	}

	@Post(':id/dispose')
	@HttpCode(200)
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'assetsDispose', summary: 'Dispose of a fixed asset (R4)' })
	dispose(@Param('id') id: string, @Body(new ZodValidationPipe(AssetDisposal)) body: AssetDisposal) {
		return this.assets.dispose(id, body);
	}
}
