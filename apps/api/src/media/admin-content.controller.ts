import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BrandSettings,
	type ContentBlock,
	ContentBlockInput,
	ContentBlockListQuery,
	type HomeHeroLayout,
	StorefrontHomeSettings,
	type YouTubeSettings,
	YouTubeSettingsUpdate,
	YouTubeValidateRequest,
	type YouTubeValidateResponse,
} from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BrandService } from './brand.service';
import { ContentBlocksService } from './content-blocks.service';
import { YouTubeService } from './youtube.service';

/** Banners, the home hero layout, and YouTube settings (admin). */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin')
export class AdminContentController {
	constructor(
		private readonly blocks: ContentBlocksService,
		private readonly youtube: YouTubeService,
		private readonly brand: BrandService,
	) {}

	@Get('settings/brand')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getBrandKit', summary: 'The Brand Kit settings' })
	brandKit(): Promise<BrandSettings> {
		return this.brand.settingsValue();
	}

	@Put('settings/brand')
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'saveBrandKit', summary: 'Set the shop name, logo and seal' })
	saveBrandKit(@Body(new ZodValidationPipe(BrandSettings)) body: BrandSettings): Promise<BrandSettings> {
		return this.brand.save(body);
	}

	@Get('content-blocks')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'listContentBlocks', summary: 'Banners by owner and position' })
	list(@Query(new ZodValidationPipe(ContentBlockListQuery)) query: ContentBlockListQuery): Promise<ContentBlock[]> {
		return this.blocks.list(query);
	}

	@Put('content-blocks')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'saveContentBlock', summary: 'Create or replace the banner at its position and slot' })
	save(@Body(new ZodValidationPipe(ContentBlockInput)) body: ContentBlockInput): Promise<ContentBlock> {
		return this.blocks.upsert(body);
	}

	@Delete('content-blocks/:key')
	@HttpCode(204)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'deleteContentBlock', summary: 'Remove a banner' })
	remove(@Param('key') key: string): Promise<void> {
		return this.blocks.remove(key);
	}

	@Get('settings/home-hero')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'getHomeHeroLayout', summary: 'The selected home hero layout' })
	async heroLayout(): Promise<StorefrontHomeSettings> {
		return { heroLayout: await this.blocks.heroLayout() };
	}

	@Put('settings/home-hero')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'setHomeHeroLayout', summary: 'Select the home hero layout' })
	async setHeroLayout(
		@Body(new ZodValidationPipe(StorefrontHomeSettings)) body: StorefrontHomeSettings,
	): Promise<{ heroLayout: HomeHeroLayout }> {
		return { heroLayout: await this.blocks.setHeroLayout(body.heroLayout) };
	}

	@Post('youtube/validate')
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'validateYouTubeVideo',
		summary: 'Normalise a pasted YouTube link and confirm the video',
	})
	validate(
		@Body(new ZodValidationPipe(YouTubeValidateRequest)) body: YouTubeValidateRequest,
	): Promise<YouTubeValidateResponse> {
		return this.youtube.validate(body.input);
	}

	@Get('youtube/settings')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getYouTubeSettings', summary: 'YouTube rail settings' })
	settings(): Promise<YouTubeSettings> {
		return this.youtube.getSettings();
	}

	@Put('youtube/settings')
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'updateYouTubeSettings', summary: 'Edit the rail: handle, display count, placements' })
	updateSettings(
		@Body(new ZodValidationPipe(YouTubeSettingsUpdate)) body: YouTubeSettingsUpdate,
	): Promise<YouTubeSettings> {
		return this.youtube.updateSettings(body);
	}
}
