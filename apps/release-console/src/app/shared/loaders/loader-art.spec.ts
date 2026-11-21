import { describe, expect, it } from 'vitest';

import { LOADERS, LOADER_OF_PAGE, LOADER_OF_SCREEN, loaderArt } from './loader-art';
import { CONSOLE_MENU } from '../../menu/console-menu.data';

describe('the console loaders (brief N5kmX6DLJv1ECitVUPFHJ8, approved 21 Nov 2026)', () => {
	it('has the 29 approved drawings, each with a distinct id', () => {
		expect(LOADERS).toHaveLength(29);
		expect(new Set(LOADERS.map((l) => l.id)).size).toBe(29);
	});

	it('gives every screen of the approved menu a loader that exists', () => {
		const ids = new Set(LOADERS.map((l) => l.id));
		for (const key of Object.keys(CONSOLE_MENU.screens)) {
			expect(LOADER_OF_SCREEN[key], key).toBeDefined();
			expect(ids.has(LOADER_OF_SCREEN[key] ?? ''), key).toBe(true);
		}
		for (const id of Object.values(LOADER_OF_PAGE)) expect(ids.has(id), id).toBe(true);
	});

	it('uses every drawing somewhere, and each draws an SVG body', () => {
		const used = new Set([...Object.values(LOADER_OF_SCREEN), ...Object.values(LOADER_OF_PAGE)]);
		for (const l of LOADERS) {
			expect(used.has(l.id), l.id).toBe(true);
			expect(loaderArt(l.id).svg()).toMatch(/^<|\$\{/);
			expect(loaderArt(l.id).svg()).not.toMatch(/<script|on[a-z]+=/i);
		}
	});
});
