import type { BlogCategory, BlogPost, BlogTag, GoLiveGap } from '@saha-textile/contracts';

import { articleText } from './sanitize-html';

const filled = (value: string | undefined): boolean => !!value && value.trim().length > 0;

/** Every language missing from a required text. */
function required(field: string, values: Readonly<Record<string, string>> | undefined, locales: readonly string[]) {
	return locales.filter((locale) => !filled(values?.[locale])).map((locale) => ({ field, locale }));
}

/** An optional text needs every language once English has it. */
function followsEnglish(
	field: string,
	values: Readonly<Record<string, string>> | undefined,
	locales: readonly string[],
) {
	return filled(values?.['en']) ? required(field, values, locales) : [];
}

export interface BlogGoLiveInput {
	post: BlogPost;
	locales: readonly string[];
	/** The cover's own alt text per language, or null when the cover is missing from the library. */
	coverAlt: Readonly<Record<string, string>> | null;
	/** True when the cover has finished processing into the blog sizes. */
	coverReady: boolean;
	/** The post's categories and tags as stored, to check each one is live. */
	categories: readonly Pick<BlogCategory, 'id' | 'status'>[];
	tags: readonly Pick<BlogTag, 'id' | 'status'>[];
}

/**
 * Everything that stops a post going live, the same rule from the form and the list: a title and
 * an article in every language, any summary, byline or search text written in English also
 * written in the others, a processed cover with alt text in every language, and at least one
 * live category. Tags are optional, but each one chosen must be live.
 */
export function blogGoLiveGaps({
	post,
	locales,
	coverAlt,
	coverReady,
	categories,
	tags,
}: BlogGoLiveInput): GoLiveGap[] {
	const content = Object.fromEntries(
		Object.entries(post.content).map(([locale, html]) => [locale, articleText(html)]),
	);
	const gaps: GoLiveGap[] = [
		...required('title', post.title, locales),
		...required('content', content, locales),
		...followsEnglish('excerpt', post.excerpt, locales),
		...followsEnglish('author', post.author, locales),
		...followsEnglish('meta_title', post.seoTitle, locales),
		...followsEnglish('meta_description', post.seoDescription, locales),
	];
	if (!post.coverAssetId || !coverAlt) gaps.push({ field: 'cover', locale: null });
	else {
		if (!coverReady) gaps.push({ field: 'image_sizes', locale: null });
		gaps.push(...required('image_alt', coverAlt, locales));
	}
	const live = new Set(categories.filter((row) => row.status === 'live').map((row) => row.id));
	if (!post.categoryIds.some((id) => live.has(id))) gaps.push({ field: 'category', locale: null });
	for (const id of post.categoryIds) if (!live.has(id)) gaps.push({ field: `blog_category:${id}`, locale: null });
	const liveTags = new Set(tags.filter((row) => row.status === 'live').map((row) => row.id));
	for (const id of post.tagIds) if (!liveTags.has(id)) gaps.push({ field: `blog_tag:${id}`, locale: null });
	return gaps;
}

/** A blog category or tag goes live with a name in every language. */
export function blogTermGaps(term: Pick<BlogCategory, 'name'>, locales: readonly string[]): GoLiveGap[] {
	return required('name', term.name, locales);
}

/** An address from an English title: lower case, hyphens, at most 80 characters. */
export function blogSlugFrom(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/g, '');
}

const READING_WORDS_PER_MINUTE = 200;

/** Whole minutes to read an article, never less than one. */
export function readingMinutes(html: string): number {
	const words = articleText(html).split(' ').filter(Boolean).length;
	return Math.max(1, Math.round(words / READING_WORDS_PER_MINUTE));
}

/** The summary a card shows: the excerpt, or the article's opening cut at a word. */
export function blogExcerpt(excerpt: string | undefined, html: string, limit = 200): string {
	if (filled(excerpt)) return (excerpt as string).trim();
	const text = articleText(html);
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const space = cut.lastIndexOf(' ');
	return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** Whether a post shows on the shop at `now`: live, and its publish date has come. */
export function blogPostVisible(post: Pick<BlogPost, 'status' | 'publishedAt'>, now: string): boolean {
	return post.status === 'live' && !!post.publishedAt && post.publishedAt <= now;
}

/** The order the list and the home rail use: sticky first, then newest. */
export function compareBlogPosts(
	a: Pick<BlogPost, 'sticky' | 'publishedAt' | 'id'>,
	b: Pick<BlogPost, 'sticky' | 'publishedAt' | 'id'>,
): number {
	if (a.sticky !== b.sticky) return a.sticky ? -1 : 1;
	const byDate = (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
	return byDate || a.id.localeCompare(b.id);
}
