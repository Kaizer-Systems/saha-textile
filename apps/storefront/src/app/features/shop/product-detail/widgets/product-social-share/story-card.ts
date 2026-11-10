/**
 * Writes the name, facts and shop into the tall Status/Story card's empty band (share brief J1,
 * owner choice 10 November). The image pipeline draws the card with the band left empty; the
 * shopper's phone fills it at the tap, so the words are always the product's current ones and in
 * the page's language.
 */

/** core-domain `STORY_LAYOUT.band`, as fractions of the card's height. Keep the two in step. */
export const STORY_BAND = { top: 0.078, height: 0.203 } as const;

export interface StoryWords {
	name: string;
	facts: string;
	shop: string;
}

export interface StoryLine {
	text: string;
	x: number;
	/** Baseline. */
	y: number;
	size: number;
	bold: boolean;
	color: string;
}

type Measure = (text: string, size: number, bold: boolean) => number;

/** At most `max` lines no wider than `width`; a longer text ends its last line with "…". */
export function wrap(text: string, width: number, max: number, fits: (line: string) => boolean): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if (fits(next) || !line) {
			line = next;
			continue;
		}
		lines.push(line);
		line = word;
	}
	if (line) lines.push(line);
	if (lines.length <= max) return lines;
	const kept = lines.slice(0, max);
	let last = `${kept[max - 1]} ${lines.slice(max).join(' ')}`;
	while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
	kept[max - 1] = `${last}…`;
	return kept;
}

/**
 * Where each line goes on a `width`×`height` card: the name in bold (two lines at most), the facts,
 * then the shop, shrinking together until they fit the band.
 */
export function layoutStoryWords(words: StoryWords, width: number, height: number, measure: Measure): StoryLine[] {
	const side = width * 0.055;
	const room = width - side * 2;
	const top = height * STORY_BAND.top;
	const band = height * STORY_BAND.height;
	for (let scale = 1; ; scale *= 0.9) {
		const nameSize = width * 0.0685 * scale;
		const small = width * 0.041 * scale;
		const blocks: Array<Omit<StoryLine, 'x' | 'y'>> = [
			...wrap(words.name, room, 2, (line) => measure(line, nameSize, true) <= room).map((text) => ({
				text,
				size: nameSize,
				bold: true,
				color: '#ffffff',
			})),
			...(words.facts ? wrap(words.facts, room, 1, (line) => measure(line, small, false) <= room) : []).map(
				(text) => ({ text, size: small, bold: false, color: '#e8e8e8' }),
			),
			...wrap(words.shop, room, 1, (line) => measure(line, small, true) <= room).map((text) => ({
				text,
				size: small,
				bold: true,
				color: '#9cc7e8',
			})),
		];
		const gap = small * 0.7;
		const total = blocks.reduce((sum, block) => sum + block.size * 1.2, 0) + gap * (blocks.length - 1);
		if (total <= band * 0.84 || scale < 0.5) {
			let y = top + (band - total) / 2;
			return blocks.map((block) => {
				y += block.size;
				const line = { ...block, x: side, y };
				y += block.size * 0.2 + gap;
				return line;
			});
		}
	}
}

/** The card with its words, as a JPEG. Where the browser cannot draw, the plain card is shared. */
export async function writeStoryWords(card: Blob, words: StoryWords, fontFamily: string): Promise<Blob> {
	try {
		await document.fonts?.ready;
		const picture = await createImageBitmap(card);
		const canvas = document.createElement('canvas');
		canvas.width = picture.width;
		canvas.height = picture.height;
		const context = canvas.getContext('2d');
		if (!context) return card;
		context.drawImage(picture, 0, 0);
		const font = (size: number, bold: boolean) => `${bold ? '700' : '400'} ${Math.round(size)}px ${fontFamily}`;
		const measure: Measure = (text, size, bold) => {
			context.font = font(size, bold);
			return context.measureText(text).width;
		};
		for (const line of layoutStoryWords(words, canvas.width, canvas.height, measure)) {
			context.font = font(line.size, line.bold);
			context.fillStyle = line.color;
			context.fillText(line.text, line.x, line.y);
		}
		return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? card), 'image/jpeg', 0.9));
	} catch {
		return card;
	}
}
