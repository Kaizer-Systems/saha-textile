import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminBlogListQuery,
	BlogCategoryWrite,
	BlogPostWrite,
	BlogStatusWrite,
	BlogTagWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BlogAdminService } from './blog-admin.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/**
 * Blog writes for the admin. Posts use the `blog.*` permissions; blog categories and tags use
 * `category.*` and `tag.*`, the same codes the admin's category and tag screens check.
 */
@ApiTags(API_TAGS.blog)
@Audience('admin')
@Controller('admin/blog')
export class AdminBlogController {
	constructor(private readonly blog: BlogAdminService) {}

	@Get('posts')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('blog.index')
	@ApiOperation({ operationId: 'listAdminBlogPosts', summary: 'Every post, any status' })
	list(@Query(new ZodValidationPipe(AdminBlogListQuery)) query: AdminBlogListQuery) {
		return this.blog.list(query);
	}

	@Get('posts/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('blog.index')
	@ApiOperation({ operationId: 'getAdminBlogPost', summary: 'One post with every language, for the form' })
	detail(@Param('id') id: string) {
		return this.blog.detail(id);
	}

	@Post('posts')
	@HttpCode(200)
	@RequirePermissions('blog.create')
	@ApiOperation({ operationId: 'createBlogPost', summary: 'Add a post; it starts as a draft' })
	create(
		@Body(new ZodValidationPipe(BlogPostWrite)) body: BlogPostWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.create(body, actor(principal));
	}

	@Post('posts/:id/go-live')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('blog.edit')
	@ApiOperation({ operationId: 'goLiveBlogPost', summary: 'Publish a post, or list what stops it' })
	goLive(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.blog.goLive(id, actor(principal));
	}

	@Post('posts/:id/status')
	@HttpCode(200)
	@RequirePermissions('blog.edit')
	@ApiOperation({ operationId: 'setBlogPostStatus', summary: "The list's switch: Go Live, or take the post down" })
	async status(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BlogStatusWrite)) body: BlogStatusWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		if (body.status === 'live') return this.blog.goLive(id, actor(principal));
		await this.blog.takeDown(id, actor(principal));
		return { live: false, gaps: [] };
	}

	@Post('posts/:id')
	@HttpCode(200)
	@RequirePermissions('blog.edit')
	@ApiOperation({ operationId: 'updateBlogPost', summary: 'Save the post form' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BlogPostWrite)) body: BlogPostWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.update(id, body, actor(principal));
	}

	@Delete('posts/:id')
	@HttpCode(204)
	@RequirePermissions('blog.destroy')
	@ApiOperation({ operationId: 'deleteBlogPost', summary: 'Delete a post; a published one leaves its address gone' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.blog.remove(id, actor(principal));
	}

	@Get('categories')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('category.index')
	@ApiOperation({ operationId: 'listAdminBlogCategories', summary: 'Every blog category' })
	categories() {
		return this.blog.listTerms('category');
	}

	@Post('categories')
	@HttpCode(200)
	@RequirePermissions('category.create')
	@ApiOperation({ operationId: 'createBlogCategory', summary: 'Add a blog category' })
	createCategory(
		@Body(new ZodValidationPipe(BlogCategoryWrite)) body: BlogCategoryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.saveTerm('category', null, body, actor(principal));
	}

	@Post('categories/:id')
	@HttpCode(200)
	@RequirePermissions('category.edit')
	@ApiOperation({ operationId: 'updateBlogCategory', summary: 'Save a blog category' })
	updateCategory(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BlogCategoryWrite)) body: BlogCategoryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.saveTerm('category', id, body, actor(principal));
	}

	@Delete('categories/:id')
	@HttpCode(204)
	@RequirePermissions('category.destroy')
	@ApiOperation({ operationId: 'deleteBlogCategory', summary: 'Delete a blog category and take it off every post' })
	removeCategory(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.blog.removeTerm('category', id, actor(principal));
	}

	@Get('tags')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('tag.index')
	@ApiOperation({ operationId: 'listAdminBlogTags', summary: 'Every blog tag' })
	tags() {
		return this.blog.listTerms('tag');
	}

	@Post('tags')
	@HttpCode(200)
	@RequirePermissions('tag.create')
	@ApiOperation({ operationId: 'createBlogTag', summary: 'Add a blog tag' })
	createTag(
		@Body(new ZodValidationPipe(BlogTagWrite)) body: BlogTagWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.saveTerm('tag', null, body, actor(principal));
	}

	@Post('tags/:id')
	@HttpCode(200)
	@RequirePermissions('tag.edit')
	@ApiOperation({ operationId: 'updateBlogTag', summary: 'Save a blog tag' })
	updateTag(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BlogTagWrite)) body: BlogTagWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.blog.saveTerm('tag', id, body, actor(principal));
	}

	@Delete('tags/:id')
	@HttpCode(204)
	@RequirePermissions('tag.destroy')
	@ApiOperation({ operationId: 'deleteBlogTag', summary: 'Delete a blog tag and take it off every post' })
	removeTag(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.blog.removeTerm('tag', id, actor(principal));
	}
}
