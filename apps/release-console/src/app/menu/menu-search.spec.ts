import { describe, expect, it } from 'vitest';

import { CONSOLE_MENU } from './console-menu.data';
import { placeOf, searchMenu } from './menu-search';

describe('menu search', () => {
	it('finds a screen by the start of its name first', () => {
		const hits = searchMenu(CONSOLE_MENU, 'trac');
		expect(hits[0]?.label).toBe('Traces');
		expect(hits[0]?.path).toBe('Watch › Performance');
	});

	it('finds a screen by another word for it', () => {
		const hit = searchMenu(CONSOLE_MENU, 'pm2').find((h) => h.screen === 'processes');
		expect(hit?.via).toBe('pm2');
	});

	it('finds tabs inside screens and shows where they live', () => {
		const hit = searchMenu(CONSOLE_MENU, 'service map').find((h) => h.kind === 'tab');
		expect(hit?.path).toContain('Traces');
	});

	it('returns nothing for an empty or unknown query', () => {
		expect(searchMenu(CONSOLE_MENU, '  ')).toEqual([]);
		expect(searchMenu(CONSOLE_MENU, 'zzzqqq')).toEqual([]);
	});

	it('places every menu item and keeps the approved provider groups', () => {
		const place = placeOf(CONSOLE_MENU);
		expect(place.get('droplets')).toEqual(['DigitalOcean', 'Compute']);
		expect(place.get('cforgs')?.[0]).toBe('Cloudflare');
		expect(CONSOLE_MENU.screens['cforgs']?.off).toBe(true);
		expect(CONSOLE_MENU.screens['doaccount']?.part).toContain('Partly here');
	});
});
