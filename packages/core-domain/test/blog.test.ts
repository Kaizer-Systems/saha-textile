import type { BlogPost } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	articleText,
	blogExcerpt,
	blogGoLiveGaps,
	blogPostVisible,
	blogSlugFrom,
	blogTermGaps,
	compareBlogPosts,
	readingMinutes,
	sanitizeArticleHtml,
} from '../src/index';

const LOCALES = ['en', 'bn'];

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
	id: 'blg_1',
	slug: 'how-to-spot-real-banarasi',
	title: { en: 'How to spot a real Banarasi', bn: 'আসল বেনারসি চেনার উপায়' },
	excerpt: {},
	content: { en: '<p>Seven checks.</p>', bn: '<p>সাতটি পরীক্ষা।</p>' },
	coverAssetId: 'med_1',
	shareImageAssetId: null,
	categoryIds: ['bcat_guides'],
	tagIds: [],
	featured: false,
	sticky: false,
	author: {},
	publishedAt: null,
	seoTitle: {},
	seoDescription: {},
	status: 'draft',
	...overrides,
});

const ready = {
	locales: LOCALES,
	coverAlt: { en: 'A red Banarasi', bn: 'লাল বেনারসি' },
	coverReady: true,
	categories: [{ id: 'bcat_guides', status: 'live' as const }],
	tags: [{ id: 'btag_wedding', status: 'live' as const }],
};

describe('blogGoLiveGaps', () => {
	it('lets a complete post go live', () => {
		expect(blogGoLiveGaps({ post: post({ tagIds: ['btag_wedding'] }), ...ready })).toEqual([]);
	});

	it('names each missing language of the title and the article', () => {
		const gaps = blogGoLiveGaps({
			post: post({ title: { en: 'Title' }, content: { en: '<p>Text</p>', bn: '<p> </p>' } }),
			...ready,
		});
		expect(gaps).toEqual([
			{ field: 'title', locale: 'bn' },
			{ field: 'content', locale: 'bn' },
		]);
	});

	it('asks for the other language of an optional text only once English has it', () => {
		const gaps = blogGoLiveGaps({ post: post({ excerpt: { en: 'Short' }, seoTitle: {} }), ...ready });
		expect(gaps).toEqual([{ field: 'excerpt', locale: 'bn' }]);
	});

	it('needs a processed cover with alt text in every language', () => {
		expect(blogGoLiveGaps({ post: post({ coverAssetId: null }), ...ready })).toEqual([
			{ field: 'cover', locale: null },
		]);
		expect(blogGoLiveGaps({ post: post(), ...ready, coverAlt: { en: 'Red' }, coverReady: false })).toEqual([
			{ field: 'image_sizes', locale: null },
			{ field: 'image_alt', locale: 'bn' },
		]);
	});

	it('needs a live category and live tags', () => {
		const gaps = blogGoLiveGaps({
			post: post({ tagIds: ['btag_draft'] }),
			...ready,
			categories: [{ id: 'bcat_guides', status: 'draft' }],
		});
		expect(gaps).toEqual([
			{ field: 'category', locale: null },
			{ field: 'blog_category:bcat_guides', locale: null },
			{ field: 'blog_tag:btag_draft', locale: null },
		]);
	});
});

describe('blog terms and helpers', () => {
	it('needs a category name in every language', () => {
		expect(blogTermGaps({ name: { en: 'Saree guides' } }, LOCALES)).toEqual([{ field: 'name', locale: 'bn' }]);
	});

	it('makes an address from an English title', () => {
		expect(blogSlugFrom('How to Spot a Real Banarasi Saree: Seven Checks Before You Buy')).toBe(
			'how-to-spot-a-real-banarasi-saree-seven-checks-before-you-buy',
		);
		expect(blogSlugFrom('Dhakai Jamdani or Tangail?')).toBe('dhakai-jamdani-or-tangail');
		expect(blogSlugFrom('a'.repeat(100))).toHaveLength(80);
	});

	it('counts reading time at 200 words a minute, at least one', () => {
		expect(readingMinutes('<p>one two</p>')).toBe(1);
		expect(readingMinutes(`<p>${'word '.repeat(1300)}</p>`)).toBe(7);
	});

	it('uses the excerpt, else the opening of the article cut at a word', () => {
		expect(blogExcerpt('Given', '<p>Body</p>')).toBe('Given');
		expect(blogExcerpt('', '<p>Short body</p>')).toBe('Short body');
		const long = blogExcerpt('', `<p>${'silk '.repeat(80)}</p>`, 50);
		expect(long.endsWith('…')).toBe(true);
		expect(long.length).toBeLessThanOrEqual(51);
	});

	it('shows a post once live and its date has come', () => {
		const now = '2026-11-08T10:00:00.000Z';
		expect(blogPostVisible({ status: 'live', publishedAt: '2026-11-01T00:00:00.000Z' }, now)).toBe(true);
		expect(blogPostVisible({ status: 'live', publishedAt: '2026-12-01T00:00:00.000Z' }, now)).toBe(false);
		expect(blogPostVisible({ status: 'draft', publishedAt: '2026-11-01T00:00:00.000Z' }, now)).toBe(false);
		expect(blogPostVisible({ status: 'live', publishedAt: null }, now)).toBe(false);
	});

	it('orders sticky posts first, then newest', () => {
		const rows = [
			{ id: 'a', sticky: false, publishedAt: '2026-11-03' },
			{ id: 'b', sticky: true, publishedAt: '2026-11-01' },
			{ id: 'c', sticky: false, publishedAt: '2026-11-05' },
		];
		expect([...rows].sort(compareBlogPosts).map((row) => row.id)).toEqual(['b', 'c', 'a']);
	});
});

describe('sanitizeArticleHtml', () => {
	it('keeps the editor markup an article needs', () => {
		const html =
			'<h2>Turn it over</h2><p>The <strong>back</strong> of a <em>handloom</em> weave.</p><ul><li>One</li></ul><blockquote>Note</blockquote>';
		expect(sanitizeArticleHtml(html)).toBe(html);
	});

	it('keeps shop links and marks outside links', () => {
		expect(sanitizeArticleHtml('<a href="/en/collections/banarasi">Banarasi</a>')).toBe(
			'<a href="/en/collections/banarasi">Banarasi</a>',
		);
		expect(sanitizeArticleHtml('<a href="https://silkmarkindia.com" target="_blank">Silk Mark</a>')).toBe(
			'<a href="https://silkmarkindia.com" rel="noopener">Silk Mark</a>',
		);
	});

	it('drops scripts, handlers and unsafe addresses', () => {
		expect(sanitizeArticleHtml('<p onclick="x()">Hi<script>alert(1)</script></p>')).toBe('<p>Hi</p>');
		expect(sanitizeArticleHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(sanitizeArticleHtml('<a href="jav&#x09;ascript:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(sanitizeArticleHtml('<a href="//evil.example">x</a>')).toBe('<a>x</a>');
		expect(sanitizeArticleHtml('<img src="http://plain.example/a.jpg" onerror="x()">')).toBe('');
		expect(sanitizeArticleHtml('<img src="https://cdn.example/a.webp" alt="Silk" onerror="x()">')).toBe(
			'<img src="https://cdn.example/a.webp" alt="Silk">',
		);
		expect(sanitizeArticleHtml('<iframe src="https://x"></iframe><style>p{}</style>ok')).toBe('ok');
		expect(sanitizeArticleHtml('<svg><script>alert(1)</script></svg>after')).toBe('after');
	});

	it('escapes stray brackets and keeps entities', () => {
		expect(sanitizeArticleHtml('<p>2 < 3 & 4 &gt; 1 &amp; done</p>')).toBe(
			'<p>2 &lt; 3 &amp; 4 &gt; 1 &amp; done</p>',
		);
		expect(sanitizeArticleHtml('<p>"quoted" <!-- note --></p>')).toBe('<p>"quoted" </p>');
		expect(sanitizeArticleHtml('<constructor>x</constructor><p title="a">y</p>')).toBe('x<p>y</p>');
	});

	it('turns an h1 into an h2, so the page keeps one main heading', () => {
		expect(sanitizeArticleHtml('<h1>Title</h1>')).toBe('<h2>Title</h2>');
	});

	it('reads the words of an article', () => {
		expect(articleText('<p>Pure&nbsp;silk</p><p>and &amp; zari</p>')).toBe('Pure silk and & zari');
	});
});
