import type { MediaAsset, MediaProfile, MediaVersion } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	processMediaAsset,
	renderPhoto,
	type ImageCodecPort,
} from '../src/index';

const NOW = new Date('2026-11-20T10:00:00.000Z');

const own = (key: string, widths: number[], over: Partial<MediaProfile> = {}): MediaProfile =>
	({
		key,
		name: key,
		builtIn: false,
		shape: null,
		roles: [key],
		widths: { [key]: widths },
		quality: 80,
		fills: [],
		minSize: null,
		maxBytes: 25_000_000,
		accepts: ['image/jpeg'],
		mainPhotoOnly: false,
		enabled: true,
		version: 1,
		...over,
	}) as MediaProfile;
const making = (id: string): MediaVersion => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return {
		id,
		profileKey,
		profileVersion: 1,
		fill: fill as MediaVersion['fill'],
		state: 'making',
		error: null,
		createdAt: NOW.toISOString(),
	};
};
const asset = (over: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id: 'med_p',
		kind: 'image',
		purpose: 'product',
		slug: 'red',
		originalStorageKey: 'media/med_p/original.jpg',
		originalFormat: 'image/jpeg',
		originalByteSize: 1000,
		width: 1000,
		height: 1000,
		derivatives: [],
		versions: [],
		visibility: 'private',
		dominantColor: null,
		thumbHash: null,
		servesAsPrimary: false,
		maxDisplayWidth: null,
		focal: null,
		...over,
	}) as MediaAsset;

const PROFILES = [
	own('own_big', [5000]),
	own('own_warn', [100], { minSize: { edge: 'short', px: 2000, mode: 'warn' } } as never),
	own('own_first', [777]),
	own('own_second', [701, 702]),
	...SEEDED_MEDIA_PROFILES,
];

function deps(over: Record<string, unknown> = {}, render?: ImageCodecPort['render']) {
	return {
		assets: {},
		roles: { list: async () => [...SEEDED_MEDIA_ROLES] },
		profiles: { list: async () => PROFILES },
		storage: { upload: vi.fn(async () => undefined), getUrl: (key: string) => `https://cdn.example/${key}` },
		codec: {
			probe: vi.fn(),
			placeholder: async () => ({ thumbHash: 'T', dominantColor: '#123456' }),
			render:
				render ??
				(async (_bytes: Uint8Array, spec: { width: number; height: number | null }) => ({
					bytes: new Uint8Array(4),
					width: spec.width,
					height: spec.height ?? spec.width,
					sha256: 'abcdabcd',
				})),
		},
		queue: { enqueue: vi.fn() },
		now: () => NOW,
		...over,
	};
}
const probe = (width = 1000, height = 1000) => ({ width, height, format: 'jpeg', hasAlpha: false }) as never;
const run = (d: ReturnType<typeof deps>, versions: MediaVersion[], source = asset(), size = probe()) =>
	renderPhoto(d as never, source, new Uint8Array(10), size, versions, new Set());

describe('rendering a photo’s versions: the remaining cases', () => {
	it('asks for the brand colour only when a version is filled with it, with or without a colour source', async () => {
		const brandColour = vi.fn(async () => '#417394');
		const brandLogo = vi.fn(async () => new Uint8Array(1));
		await run(
			deps({ brandColour, brandLogo }),
			[making('browser_icon_1x1.brand')],
			asset({ width: 1000, height: 800 }),
			probe(1000, 800),
		);
		expect(brandColour).toHaveBeenCalledTimes(1);
		await expect(
			run(deps(), [making('browser_icon_1x1.brand')], asset({ width: 1000, height: 800 }), probe(1000, 800)),
		).resolves.toBeDefined();
	});

	it('fails a version of an unknown profile, and one too small for any of its sizes', async () => {
		const rendered = await run(deps(), [making('gone_profile.as_is'), making('own_big.as_is')]);
		expect(rendered.made.map((version) => [version.id, version.state, version.error])).toEqual([
			['gone_profile.as_is', 'failed', 'profile_unknown'],
			['own_big.as_is', 'failed', 'too_small'],
		]);
	});

	it('notes a photo below a profile’s recommended size', async () => {
		const rendered = await run(deps(), [making('own_warn.as_is')]);
		expect(rendered.warnings.has('below_recommended_size')).toBe(true);
	});

	it('sends half-made files away without addresses for a private photo, and nothing when none was made', async () => {
		const render: ImageCodecPort['render'] = async (_bytes, spec) => {
			if (spec.width === 777 || spec.width === 702) throw new Error('render failed');
			return {
				bytes: new Uint8Array(4),
				width: spec.width,
				height: spec.height ?? spec.width,
				sha256: 'abcdabcd',
			};
		};
		const d = deps({}, render);
		const rendered = await run(d, [making('own_first.as_is'), making('own_second.as_is')]);
		expect(rendered.made.map((version) => version.error)).toEqual(['render_failed', 'render_failed']);
		expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
		expect(d.queue.enqueue).toHaveBeenCalledWith({
			type: 'delete-objects',
			keys: [expect.stringContaining('701w')],
			urls: [],
		});
	});
});

describe('processing a photo with versions: a failure', () => {
	it('marks it failed field by field when its original can’t be read, and lets the error through', async () => {
		const settleVersions = vi.fn();
		const d = {
			...deps(),
			assets: {
				claimForProcessing: async () => asset({ versions: [making('own_warn.as_is')] }),
				settleVersions,
				update: vi.fn(),
			},
			storage: {
				download: async () => Promise.reject(new Error('gone')),
				upload: vi.fn(),
				getUrl: (key: string) => key,
			},
		};
		await expect(processMediaAsset(d as never, { assetId: 'med_p', reprocess: true })).rejects.toThrow('gone');
		expect(settleVersions).toHaveBeenCalledWith(
			expect.objectContaining({
				set: { processing: expect.objectContaining({ state: 'failed', error: 'gone' }) },
			}),
		);
	});
});

describe('rendering a main photo’s pictures made once per photo, with the Brand Kit strip', () => {
	const tall = asset({ servesAsPrimary: true, width: 3000, height: 4000 });
	// The link preview carries the strip; here the tall card does too, so the logo is asked for twice.
	const stripRoles = SEEDED_MEDIA_ROLES.map((role) => (role.key === 'story' ? { ...role, brandStrip: true } : role));
	const specs: Array<{ width: number; stripLogo?: Uint8Array }> = [];
	const render = (async (_bytes: Uint8Array, spec: { width: number; height: number | null }) => {
		specs.push(spec);
		return { bytes: new Uint8Array(4), width: spec.width, height: spec.height ?? spec.width, sha256: 'abcdabcd' };
	}) as ImageCodecPort['render'];
	const draw = (d: ReturnType<typeof deps>) =>
		renderPhoto(d as never, tall, new Uint8Array(10), probe(3000, 4000), [], new Set());

	it('reads the logo once for every strip, and draws plain pictures without a logo source', async () => {
		const brandLogo = vi.fn(async () => new Uint8Array([9]));
		await draw(deps({ brandLogo, roles: { list: async () => stripRoles } }, render));
		expect(brandLogo).toHaveBeenCalledOnce();
		expect(specs.filter((spec) => spec.stripLogo).length).toBe(2);
		specs.length = 0;
		await draw(deps({ roles: { list: async () => stripRoles } }, render));
		expect(specs.length).toBeGreaterThan(0);
		expect(specs.some((spec) => spec.stripLogo)).toBe(false);
	});
});
