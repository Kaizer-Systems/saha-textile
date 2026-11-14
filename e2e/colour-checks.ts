/**
 * The light/dark guards shared by the shop (`dark-mode.spec.ts`) and the admin
 * (`dark-mode.admin.spec.ts`). Both functions run inside the page through `page.evaluate`, so each
 * is self-contained: Playwright serialises the function's source, not its closure.
 */

export interface LowContrast {
	text: string;
	ratio: number;
	color: string;
	background: string;
	/** A short path to the element, so one fix can be found for many screens. */
	where: string;
}

export interface ContrastOptions {
	/**
	 * Blend see-through layers (tinted alerts, washes, glass overlays) onto the first solid colour
	 * below them, and see-through text onto its background, as the eye sees them. Off: only solid
	 * backgrounds count, the shop's original rule.
	 */
	blend: boolean;
	/** Skip text covered by another layer, such as page text under a popup's backdrop. */
	skipCovered: boolean;
	/** Text inside these is not judged (for example, text over photographs). */
	skip: string;
}

/**
 * Every visible piece of text that falls below WCAG AA against what is behind it: 4.5 : 1, or 3 : 1
 * for large text, against every stop of a gradient. Text over a picture, hidden or disabled text
 * (WCAG exempts it) and decorative rating stars are left out: a colour check cannot judge them.
 */
export function lowContrast(options: ContrastOptions): LowContrast[] {
	type Rgba = [number, number, number, number];
	// Reads rgb()/rgba() and color(srgb r g b), which is what color-mix() computes to.
	const rgbOf = (colour: string): Rgba | null => {
		const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(colour);
		if (srgb) {
			return [
				Number(srgb[1]) * 255,
				Number(srgb[2]) * 255,
				Number(srgb[3]) * 255,
				srgb[4] === undefined ? 1 : Number(srgb[4]),
			];
		}
		const parts = colour.match(/[\d.]+/g);
		if (!parts) return null;
		const [r = 0, g = 0, b = 0, a = 1] = parts.map(Number);
		return [r, g, b, a];
	};
	const luminance = ([r, g, b]: Rgba): number =>
		[r, g, b]
			.map((channel) => {
				const value = channel / 255;
				return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			})
			.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
	/** A see-through colour over a solid one, as it looks. */
	const blend = (top: Rgba, under: Rgba): Rgba =>
		top[3] >= 1
			? top
			: [
					top[0] * top[3] + under[0] * (1 - top[3]),
					top[1] * top[3] + under[1] * (1 - top[3]),
					top[2] * top[3] + under[2] * (1 - top[3]),
					1,
				];
	const flatten = (layers: Rgba[], base: Rgba): Rgba =>
		options.blend ? layers.reduceRight((under, layer) => blend(layer, under), base) : base;
	// The colours behind an element: its first solid background, or every stop of a gradient.
	const backgroundsOf = (element: Element): Rgba[] | 'picture' => {
		const layers: Rgba[] = [];
		for (let node: Element | null = element; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.backgroundImage !== 'none') {
				if (!style.backgroundImage.includes('gradient')) return 'picture';
				const stops = (style.backgroundImage.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) ?? [])
					.map(rgbOf)
					.filter((stop): stop is Rgba => !!stop && stop[3] > 0.9);
				if (stops.length) return stops.map((stop) => flatten(layers, stop));
			}
			const solid = rgbOf(style.backgroundColor);
			if (solid && solid[3] > 0.9) return [flatten(layers, solid)];
			if (solid && solid[3] > 0.04) layers.push(solid);
		}
		const page = rgbOf(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
		return [flatten(layers, page)];
	};
	const overPicture = (element: Element): boolean => {
		const box = element.getBoundingClientRect();
		if (box.bottom < 0 || box.top > innerHeight) return false;
		return document
			.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			.some((under) => under instanceof HTMLImageElement || under instanceof HTMLVideoElement);
	};
	const covered = (element: Element): boolean => {
		const box = element.getBoundingClientRect();
		const x = Math.min(Math.max(box.left + Math.min(box.width, 40) / 2, 0), innerWidth - 1);
		const y = Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1);
		const top = document.elementFromPoint(x, y);
		return !!top && !(element.contains(top) || top.contains(element));
	};
	const where = (element: Element): string => {
		const parts: string[] = [];
		for (let node: Element | null = element; node && node !== document.body && parts.length < 4;) {
			const classes = [...node.classList]
				.filter(
					(name) => !/^(d-|ms-|me-|mt-|mb-|p-|px-|py-|gap-|col-|row|align-|justify-|flex-|w-|h-)/.test(name),
				)
				.slice(0, 2)
				.join('.');
			parts.unshift(node.tagName.toLowerCase() + (classes ? `.${classes}` : ''));
			node = node.parentElement;
		}
		return parts.join(' > ');
	};
	const found: LowContrast[] = [];
	const seen = new Set<Element>();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		const element = node.parentElement;
		const text = node.textContent ?? '';
		if (!element || seen.has(element) || !text.trim()) continue;
		seen.add(element);
		const box = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || Number(style.opacity) < 0.3) continue;
		if (parseFloat(style.fontSize) < 1) continue;
		if (
			element.closest(
				'[aria-hidden="true"], .d-none, script, style, noscript, svg, img, picture, [disabled], .disabled',
			)
		)
			continue;
		if ((options.skip && element.closest(options.skip)) || /^[★☆\s]+$/.test(text)) continue;
		if (options.skipCovered && covered(element)) continue;
		const backgrounds = backgroundsOf(element);
		if (backgrounds === 'picture' || overPicture(element)) continue;
		const colour = rgbOf(style.color);
		if (!colour) continue;
		const ratio = Math.min(
			...backgrounds.map((background) => {
				const foreground = luminance(options.blend ? blend(colour, background) : colour);
				const behind = luminance(background);
				return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
			}),
		);
		const size = parseFloat(style.fontSize);
		const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
		if (ratio < (large ? 3 : 4.5)) {
			found.push({
				text: text.trim().slice(0, 40),
				ratio: Math.round(ratio * 100) / 100,
				color: style.color,
				background: backgrounds
					.map((background) => `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`)
					.join(' → '),
				where: where(element),
			});
		}
	}
	return found;
}

/**
 * The box and type of every visible element on the first screen, keyed by its place in the page.
 * Dark mode may only change colours, so light and dark must give the same map.
 */
export function firstScreen(skip: string): Record<string, string> {
	const out: Record<string, string> = {};
	const path = (element: Element): string => {
		const parts: string[] = [];
		for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
			let index = 1;
			for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
			parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
		}
		return parts.join('>');
	};
	for (const element of document.body.querySelectorAll('*')) {
		if (element.closest(`script, style, noscript, svg, ${skip}`)) continue;
		const box = element.getBoundingClientRect();
		if (box.width < 1 || box.height < 1 || box.top > innerHeight) continue;
		const style = getComputedStyle(element);
		out[path(element)] =
			`${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}|` +
			`${style.fontSize}|${style.fontWeight}|${style.padding}|${style.margin}`;
	}
	return out;
}
