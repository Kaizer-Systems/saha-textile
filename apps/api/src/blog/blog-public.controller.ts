import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicBlogLocaleQuery, PublicBlogQuery, Slug } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BlogPublicService } from './blog-public.service';

const SHORT_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** The shop's blog: live posts, categories and tags in the language asked for. */
@ApiTags(API_TAGS.blog)
@Public()
@Controller('catalog/blog')
export class BlogPublicController {
	constructor(private readonly blog: BlogPublicService) {}

	@Get('posts')
	@Header('Cache-Control', SHORT_CACHE)
	@ApiOperation({ operationId: 'listBlogPosts', summary: 'Live posts, sticky first then newest, one page at a time' })
	list(@Query(new ZodValidationPipe(PublicBlogQuery)) query: PublicBlogQuery) {
		return this.blog.list(query);
	}

	@Get('posts/:slug')
	@Header('Cache-Control', SHORT_CACHE)
	@ApiOperation({ operationId: 'getBlogPost', summary: 'One live post by its address' })
	post(
		@Param('slug', new ZodValidationPipe(Slug)) slug: string,
		@Query(new ZodValidationPipe(PublicBlogLocaleQuery)) query: PublicBlogLocaleQuery,
	) {
		return this.blog.post(slug, query.locale);
	}

	@Get('categories')
	@Header('Cache-Control', SHORT_CACHE)
	@ApiOperation({ operationId: 'listBlogCategories', summary: 'Live blog categories that hold a live post' })
	categories(@Query(new ZodValidationPipe(PublicBlogLocaleQuery)) query: PublicBlogLocaleQuery) {
		return this.blog.terms('category', query.locale);
	}

	@Get('tags')
	@Header('Cache-Control', SHORT_CACHE)
	@ApiOperation({ operationId: 'listBlogTags', summary: 'Live blog tags that hold a live post' })
	tags(@Query(new ZodValidationPipe(PublicBlogLocaleQuery)) query: PublicBlogLocaleQuery) {
		return this.blog.terms('tag', query.locale);
	}
}
