import { describe, expect, it } from 'vitest';

import { STORY_BAND, layoutStoryWords, wrap, writeStoryWords } from './story-card';

/** Every letter as wide as half its size, bold a little wider: enough to test the layout. */
const measure = (text: string, size: number, bold: boolean) => text.length * size * (bold ? 0.55 : 0.5);

describe('wrap', () => {
	const upTo = (chars: number) => (line: string) => line.length <= chars;

	it('breaks between words and ends a long text with an ellipsis', () => {
		expect(wrap('Katan Banarasi Saree', 14, 2, upTo(14))).toEqual(['Katan Banarasi', 'Saree']);
		expect(wrap('one two three four five', 9, 2, upTo(9))).toEqual(['one two', 'three fo…']);
		expect(wrap('', 9, 1, upTo(9))).toEqual([]);
	});

	it('keeps a single word that is wider than the line rather than dropping it', () => {
		expect(wrap('Extraordinarily', 5, 1, upTo(5))).toEqual(['Extraordinarily']);
	});
});

describe('layoutStoryWords', () => {
	const words = {
		name: 'Katan Banarasi Saree',
		facts: 'Katan silk · Handwoven · Wedding',
		shop: 'Saha Textile · sahatextile.com',
	};

	it('puts the bold name, the facts and the shop inside the band, in that order', () => {
		const lines = layoutStoryWords(words, 1080, 1920, measure);
		expect(lines.map((line) => [line.text, line.bold])).toEqual([
			['Katan Banarasi Saree', true],
			['Katan silk · Handwoven · Wedding', false],
			['Saha Textile · sahatextile.com', true],
		]);
		const top = 1920 * STORY_BAND.top;
		const bottom = top + 1920 * STORY_BAND.height;
		expect(lines.every((line) => line.y - line.size > top && line.y < bottom)).toBe(true);
		expect(lines.every((line, index) => index === 0 || line.y > (lines[index - 1]?.y ?? 0))).toBe(true);
	});

	it('shrinks a long name to fit, at most two lines, and leaves out missing facts', () => {
		const long = {
			...words,
			name: 'Handwoven Pure Katan Silk Banarasi Saree with Meenakari Jangla Border',
			facts: '',
		};
		const lines = layoutStoryWords(long, 1080, 1920, measure);
		const names = lines.filter((line) => line.size === lines[0]?.size && line.bold && line.color === '#ffffff');
		expect(names.length).toBeLessThanOrEqual(2);
		expect(lines).toHaveLength(names.length + 1);
		expect(lines[0]?.size).toBeLessThanOrEqual(1080 * 0.0685);
		const bottom = 1920 * (STORY_BAND.top + STORY_BAND.height);
		expect(lines.every((line) => line.y < bottom)).toBe(true);
	});
});

describe('writeStoryWords', () => {
	it('shares the plain card where the browser cannot draw', async () => {
		const card = new Blob(['x'], { type: 'image/jpeg' });
		expect(await writeStoryWords(card, { name: 'A', facts: '', shop: 'B' }, 'sans-serif')).toBe(card);
	});
});
