import { Reflector } from '@nestjs/core';
import { MediaAsset, MediaProfile } from '@saha-textile/contracts';
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
	countPhotosByProfile: vi.fn(async () => ({ product_3x4: 612, banner_keep_shape: 13 })),
});

describe('MediaProfilesService', () => {
	afterEach(() => {
		delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
	});

	it('lists every profile with how many photos hold a version of it (0 when none)', async () => {
		const service = new MediaProfilesService(repository());
		const list = await service.list();
		expect(list).toHaveLength(12);
		expect(list.find((row) => row.profile.key === 'product_3x4')?.photos).toBe(612);
		expect(list.find((row) => row.profile.key === 'banner_keep_shape')?.photos).toBe(13);
		expect(list.find((row) => row.profile.key === 'hero_21x9')?.photos).toBe(0);
	});

	it('puts back built-in profiles on start, and only those', async () => {
		const rows = repository();
		await new MediaProfilesService(rows).onApplicationBootstrap();
		const keys = (rows.insertMissing.mock.calls[0]?.[0] ?? []).map((row) => row.key);
		expect(keys).toHaveLength(8);
		expect(keys).not.toContain('hero_16x9');
	});

	it('starts even when the database is not there, and skips the check for the documentation build', async () => {
		const failing = { ...repository(), insertMissing: vi.fn(async () => Promise.reject(new Error('no Mongo'))) };
		await expect(new MediaProfilesService(failing).onApplicationBootstrap()).resolves.toBeUndefined();
		process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
		const skipped = repository();
		await new MediaProfilesService(skipped).onApplicationBootstrap();
		expect(skipped.insertMissing).not.toHaveBeenCalled();
	});
});

describe('AdminMediaProfilesController', () => {
	it('hands the list to the service, behind the media view permission', async () => {
		const service = { list: vi.fn(async () => 'profiles') };
		const controller = new AdminMediaProfilesController(service as never);
		expect(await controller.list()).toBe('profiles');
		const reflector = new Reflector();
		expect(reflector.get(PERMISSIONS_KEY, AdminMediaProfilesController.prototype.list)).toEqual([
			'attachment.index',
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
