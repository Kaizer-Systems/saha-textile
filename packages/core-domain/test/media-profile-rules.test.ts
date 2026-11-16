import type { MediaProfile } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	SEEDED_MEDIA_PROFILES,
	applyProfileUpdate,
	newProfile,
	planVersion,
	profileDeleteRefusal,
	profileKeyFromName,
} from '../src/index';

/** Settings › Image profiles (media step 2c): adding, editing and deleting profiles. */
const seed = (key: string): MediaProfile => SEEDED_MEDIA_PROFILES.find((row) => row.key === key) as MediaProfile;
const write = {
	name: 'Saree 2:3',
	shape: { width: 2, height: 3 },
	widths: { x: [1200, 400, 400] },
	quality: 80,
	minSize: null,
	fills: ['white' as const],
	maxBytes: 1024,
	accepts: ['image/jpeg'],
	enabled: true,
};

describe('profile keys', () => {
	it('are made from the name, kept unique, and always valid', () => {
		expect(profileKeyFromName('Saree 2:3', new Set())).toBe('saree_2x3');
		expect(profileKeyFromName('Saree 2:3', new Set(['saree_2x3', 'saree_2x3_2']))).toBe('saree_2x3_3');
		expect(profileKeyFromName('4K hero', new Set())).toBe('p_4k_hero');
		expect(profileKeyFromName('বাংলা', new Set())).toBe('profile');
		expect(profileKeyFromName('x', new Set())).toBe('profile_x');
		expect(profileKeyFromName('A'.repeat(80), new Set())).toHaveLength(34);
	});
});

describe('adding and editing', () => {
	it('gives a new profile one family of its own, sizes sorted once each', () => {
		const made = newProfile(write, 'saree_2x3');
		expect(made).toEqual({
			profile: expect.objectContaining({
				roles: ['saree_2x3'],
				widths: { saree_2x3: [400, 1200] },
				builtIn: false,
				version: 1,
			}),
		});
		expect(newProfile({ ...write, shape: null }, 'k')).toEqual({ refusal: 'keep_shape_fills' });
		expect(newProfile({ ...write, fills: ['brand'] }, 'k')).toEqual({ refusal: 'fill_for_icons_only' });
	});

	it('a new profile’s files are planned from its own sizes, kept whole', () => {
		const made = newProfile({ ...write, fills: [], shape: null }, 'own');
		if (!('profile' in made)) throw new Error('refused');
		const plan = planVersion({
			profile: made.profile,
			fill: 'as_is',
			roles: [],
			source: { width: 1000, height: 1500 },
			maxDisplayWidth: null,
		});
		expect(plan.files.map((file) => [file.role, file.spec.width, file.spec.fit, file.spec.quality])).toEqual([
			['own', 400, 'inside', 80],
		]);
		expect(plan.skipped).toEqual([{ role: 'own', width: 1200 }]);
	});

	it('keeps a built-in name, offers Brand colour to icons only, and counts only real changes', () => {
		expect(applyProfileUpdate(seed('product_3x4'), { name: 'Saree 3:4' })).toEqual({ refusal: 'built_in_name' });
		expect(applyProfileUpdate(seed('product_3x4'), { name: 'Product 3:4' })).toMatchObject({ changed: false });
		expect(applyProfileUpdate(seed('browser_icon_1x1'), { fills: ['brand'] })).toMatchObject({
			changed: true,
			profile: { version: 1 },
		});
		// Accepting another type changes nothing a version's files are made with: saved, version unchanged (16 Nov).
		expect(applyProfileUpdate(seed('product_3x4'), { accepts: ['image/jpeg', 'image/tiff'] })).toMatchObject({
			changed: true,
			profile: { version: 1, accepts: ['image/jpeg', 'image/tiff'] },
		});
		expect(applyProfileUpdate(seed('hero_21x9'), { maxBytes: 26 * 1024 * 1024 })).toEqual({ refusal: 'too_large' });
		const edited = applyProfileUpdate(seed('product_3x4'), { widths: { zoom: [2400, 2000] } });
		expect(edited).toMatchObject({
			changed: true,
			profile: { version: 2, widths: { zoom: [2000, 2400], thumb: [150, 300] } },
		});
	});

	it('never deletes a built-in profile or one photos use', () => {
		expect(profileDeleteRefusal(seed('logo_keep_shape'), 0)).toBe('built_in');
		expect(profileDeleteRefusal(seed('hero_16x9'), 12)).toBe('in_use');
		expect(profileDeleteRefusal(seed('hero_16x9'), 0)).toBeNull();
	});
});
