import { describe, expect, it } from 'vitest';

import { legalPageGaps, legalPageText, legalPageToSave } from '../src/legal/legal-pages';

describe('legal pages (Legal Pages brief, approved 15 Nov)', () => {
	it('needs Title and Content in every language listed; markup alone is empty', () => {
		expect(
			legalPageGaps(
				{
					title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
					content: { en: '<p>We keep…</p>', bn: '<p><br></p>' },
				},
				['en', 'bn'],
			),
		).toEqual({ en: [], bn: ['content'] });
		expect(legalPageGaps({ title: {}, content: {} }, ['en'])).toEqual({ en: ['title', 'content'] });
	});

	it('cleans the content like a blog post, trims, drops empty languages, and counts the version up', () => {
		const saved = legalPageToSave({
			slug: 'privacy-policy',
			write: {
				title: { en: '  Privacy Policy ', bn: ' ' },
				content: { en: '<p>Kept</p><script>alert(1)</script>' },
				metaTitle: {},
				metaDescription: { en: 'What we keep' },
				metaImageAssetId: null,
			},
			current: { version: 3 } as never,
			actor: 'adm_1',
			now: new Date('2026-11-16T10:00:00.000Z'),
		});
		expect(saved).toMatchObject({
			slug: 'privacy-policy',
			title: { en: 'Privacy Policy' },
			metaDescription: { en: 'What we keep' },
			version: 4,
			updatedAt: '2026-11-16T10:00:00.000Z',
			updatedBy: 'adm_1',
		});
		expect(saved.content['en']).toContain('<p>Kept</p>');
		expect(saved.content['en']).not.toContain('script');
		expect(legalPageText({ en: 'English' }, 'bn')).toBe('English');
	});
});
