import { Reflector } from '@nestjs/core';
import { type AuditLog, MediaAsset, MediaProfile } from '@saha-textile/contracts';
import { SEEDED_MEDIA_PROFILES, assignExistingVersions } from '@saha-textile/core-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUDIENCE_KEY, PERMISSIONS_KEY } from '../src/auth/session.guard';
import { AdminMediaProfilesController } from '../src/media/admin-media-profiles.controller';
import { MediaProfilesService } from '../src/media/media-profiles.service';

/** Image profiles in the API (media build step 2a): the list for Settings, and built-ins put back on start. */
const repository = (rows: MediaProfile[] = [...SEEDED_MEDIA_PROFILES]) => ({
	list: vi.fn(async () => rows),
	findByKey: vi.fn(async (key: string) => rows.find((row) => row.key === key) ?? null),
	save: vi.fn(async (row: MediaProfile) => row),
	insertMissing: vi.fn(async (missing: readonly MediaProfile[]) => missing.length),
	countPhotosByProfile: vi.fn(async (): Promise<Record<string, number>> => ({
		product_3x4: 612,
		banner_keep_shape: 13,
	})),
	delete: vi.fn(async () => undefined),
});

const audit = () => ({ append: vi.fn(async (entry: AuditLog) => entry) });

const refusal = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		return ((error as { getResponse: () => { issues?: { code: string }[] } }).getResponse().issues ?? [])[0]?.code;
	}
	return null;
};

describe('MediaProfilesService', () => {
	afterEach(() => {
		delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
	});

	it('lists every profile with how many photos hold a version of it (0 when none)', async () => {
		const service = new MediaProfilesService(repository(), audit());
		const list = await service.list();
		// The twelve approved profiles and the swatch cut one (brief P11, 21 Nov 2026).
		expect(list).toHaveLength(13);
		expect(list.find((row) => row.profile.key === 'product_3x4')?.photos).toBe(612);
		expect(list.find((row) => row.profile.key === 'banner_keep_shape')?.photos).toBe(13);
		expect(list.find((row) => row.profile.key === 'hero_21x9')?.photos).toBe(0);
	});

	it('puts back built-in profiles on start, and only those', async () => {
		const rows = repository();
		await new MediaProfilesService(rows, audit()).onApplicationBootstrap();
		const keys = (rows.insertMissing.mock.calls[0]?.[0] ?? []).map((row) => row.key);
		expect(keys).toHaveLength(9);
		expect(keys).not.toContain('hero_16x9');
	});

	it('starts even when the database is not there, and skips the check for the documentation build', async () => {
		const failing = { ...repository(), insertMissing: vi.fn(async () => Promise.reject(new Error('no Mongo'))) };
		await expect(new MediaProfilesService(failing, audit()).onApplicationBootstrap()).resolves.toBeUndefined();
		process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
		const skipped = repository();
		await new MediaProfilesService(skipped, audit()).onApplicationBootstrap();
		expect(skipped.insertMissing).not.toHaveBeenCalled();
	});
});

describe('MediaProfilesService: adding, editing and deleting (F01–F03, step 2c)', () => {
	const write = {
		name: 'Saree 2:3',
		shape: { width: 2, height: 3 },
		widths: { any: [1200, 400, 800, 400] },
		quality: null,
		minSize: { edge: 'short' as const, px: 1200, mode: 'warn' as const },
		fills: ['white' as const, 'crop' as const],
		maxBytes: 20 * 1024 * 1024,
		accepts: ['image/jpeg'],
		enabled: true,
	};

	it('adds a profile with a key made from its name and one family of its own, and records it', async () => {
		const rows = repository();
		const log = audit();
		const made = await new MediaProfilesService(rows, log).create('adm_1', write);
		expect(made).toMatchObject({
			key: 'saree_2x3',
			builtIn: false,
			roles: ['saree_2x3'],
			widths: { saree_2x3: [400, 800, 1200] },
		});
		expect(rows.save).toHaveBeenCalledWith(made);
		expect(log.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'media.profile.create', entityId: 'saree_2x3' }),
		);
		// A name already taken gets a number.
		const again = await new MediaProfilesService(repository([...SEEDED_MEDIA_PROFILES, made]), audit()).create(
			'adm_1',
			write,
		);
		expect(again.key).toBe('saree_2x3_2');
	});

	it('edits apply to new versions: a real change raises the version, no change saves nothing', async () => {
		const rows = repository();
		const service = new MediaProfilesService(rows, audit());
		const edited = await service.update('adm_1', 'hero_21x9', {
			widths: { banner: [480, 1920, 960] },
			quality: 78,
		});
		expect(edited).toMatchObject({ version: 2, quality: 78, widths: { banner: [480, 960, 1920] } });
		rows.save.mockClear();
		const same = await service.update('adm_1', 'product_3x4', { enabled: true });
		expect(same.version).toBe(1);
		expect(rows.save).not.toHaveBeenCalled();
	});

	it('switches a profile off from the list, and refuses what a profile cannot be', async () => {
		const service = new MediaProfilesService(repository(), audit());
		// Switching off changes no file a version is made of: saved, and the version stays (16 Nov).
		expect(await service.update('adm_1', 'square_1x1', { enabled: false })).toMatchObject({
			enabled: false,
			version: 1,
		});
		expect(await refusal(service.update('adm_1', 'product_3x4', { name: 'Saree 3:4' }))).toBe('built_in_name');
		expect(await refusal(service.update('adm_1', 'hero_21x9', { shape: null }))).toBe('keep_shape_fills');
		expect(await refusal(service.update('adm_1', 'hero_21x9', { fills: ['brand'] }))).toBe('fill_for_icons_only');
		expect(await refusal(service.update('adm_1', 'hero_21x9', { widths: { thumb: [100] } }))).toBe(
			'unknown_family',
		);
		await expect(service.update('adm_1', 'nope', { enabled: false })).rejects.toThrow('No such image profile');
	});

	it('never deletes a built-in profile or one photos use (F03), and deletes the rest', async () => {
		const rows = { ...repository(), delete: vi.fn(async () => undefined) };
		const service = new MediaProfilesService(rows, audit());
		expect(await refusal(service.remove('adm_1', 'product_3x4'))).toBe('built_in');
		rows.countPhotosByProfile.mockResolvedValue({ hero_16x9: 12 } as never);
		expect(await refusal(service.remove('adm_1', 'hero_16x9'))).toBe('in_use');
		expect(rows.delete).not.toHaveBeenCalled();
		await service.remove('adm_1', 'hero_21x9');
		expect(rows.delete).toHaveBeenCalledWith('hero_21x9');
		expect(await service.get('product_3x4')).toMatchObject({ profile: { key: 'product_3x4' } });
	});
});

describe('AdminMediaProfilesController', () => {
	it('hands the list to the service, behind the media view permission', async () => {
		const service = { list: vi.fn(async () => 'profiles') };
		const replace = {
			refreshPreview: vi.fn(async () => 'preview'),
			refresh: vi.fn(async () => 'started'),
		};
		const controller = new AdminMediaProfilesController(service as never, replace as never);
		expect(await controller.list()).toBe('profiles');
		// Bring older versions up to date (F02, media step 3e): Settings edit, as for the profile itself.
		expect(await controller.refreshPreview('product_3x4')).toBe('preview');
		expect(await controller.refresh({ userId: 'adm_1' } as never, 'product_3x4')).toBe('started');
		expect(replace.refresh).toHaveBeenCalledWith('adm_1', 'product_3x4');
		const reflector = new Reflector();
		expect(reflector.get(PERMISSIONS_KEY, AdminMediaProfilesController.prototype.list)).toEqual([
			'attachment.index',
		]);
		expect(reflector.get(PERMISSIONS_KEY, AdminMediaProfilesController.prototype.refresh)).toEqual([
			'setting.edit',
		]);
		expect(reflector.get(AUDIENCE_KEY, AdminMediaProfilesController)).toBe('admin');
	});
});

describe('the starting profiles and named versions meet the contracts', () => {
	it('every starting profile is a valid profile', () => {
		for (const profile of SEEDED_MEDIA_PROFILES) expect(() => MediaProfile.parse(profile)).not.toThrow();
	});

	it('a photo named by the migration is a valid asset', () => {
		const stored = MediaAsset.parse({
			id: 'med_1',
			kind: 'image',
			purpose: 'brand',
			originalFormat: 'image/png',
			originalByteSize: 1000,
			width: 1200,
			height: 400,
			slug: 'shop-logo',
			derivatives: ['brand_logo', 'brand_icon', 'site_share'].map((role) => ({
				role,
				storageKey: `media/med_1/shop-logo-${role}-480w-1f3a9c2e.webp`,
				width: 480,
				height: 160,
				byteSize: 100,
				format: 'image/webp',
			})),
		});
		const named = assignExistingVersions(stored, '2026-11-16T00:00:00.000Z');
		expect(() => MediaAsset.parse({ ...stored, ...named })).not.toThrow();
		expect(named.versions.map((version) => version.id)).toEqual([
			'logo_keep_shape.as_is',
			'browser_icon_1x1.white',
		]);
	});
});
