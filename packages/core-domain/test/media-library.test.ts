import { describe, expect, it } from 'vitest';

import {
	GIB,
	STORAGE_PLAN_BYTES,
	TRASH_DAYS,
	ancestorsUnder,
	cleanMediaName,
	decideStorage,
	folderMoveRefusal,
	freeName,
	mediaCategory,
	onDemand,
	renameKeepingExtension,
	downloadName,
	waitsForImageProfiles,
	restoreTarget,
	shareCreateRefusal,
	shareExpiresAt,
	shareLinkState,
	shareOpenState,
	splitExtension,
	storageColour,
	trashDaysLeft,
	trashPurgeDue,
	websitePicture,
} from '../src/media/library';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('names', () => {
	it('cleans what people type and refuses what would read as a path', () => {
		expect(cleanMediaName('  Product   photos ')).toEqual({ ok: true, name: 'Product photos' });
		expect(cleanMediaName('বিয়ের শাড়ি 🎉')).toEqual({ ok: true, name: 'বিয়ের শাড়ি 🎉' });
		expect(cleanMediaName('   ')).toEqual({ ok: false, reason: 'empty' });
		expect(cleanMediaName('a/b')).toEqual({ ok: false, reason: 'bad_character' });
		expect(cleanMediaName('a\\b')).toEqual({ ok: false, reason: 'bad_character' });
		expect(cleanMediaName('..')).toEqual({ ok: false, reason: 'reserved' });
		expect(cleanMediaName('x'.repeat(121))).toEqual({ ok: false, reason: 'too_long' });
		expect(cleanMediaName('x'.repeat(120)).ok).toBe(true);
	});

	it('splits the extension, keeping a leading dot in the name', () => {
		expect(splitExtension('red.front.jpg')).toEqual({ stem: 'red.front', extension: '.jpg' });
		expect(splitExtension('.env')).toEqual({ stem: '.env', extension: '' });
		expect(splitExtension('README')).toEqual({ stem: 'README', extension: '' });
	});

	it('finds the first free name: (1), then (2) when (1) is taken', () => {
		expect(freeName('red.jpg', ['blue.jpg'])).toBe('red.jpg');
		expect(freeName('red.jpg', ['RED.jpg'])).toBe('red (1).jpg');
		expect(freeName('red.jpg', ['red.jpg', 'red (1).jpg'])).toBe('red (2).jpg');
		expect(freeName('red (1).jpg', ['red (1).jpg'])).toBe('red (2).jpg');
		expect(freeName('Folder', ['folder'])).toBe('Folder (1)');
	});

	it('keeps the extension on rename', () => {
		expect(renameKeepingExtension('red.jpg', 'red-front')).toBe('red-front.jpg');
		expect(renameKeepingExtension('red.jpg', 'red-front.JPG')).toBe('red-front.jpg');
		expect(renameKeepingExtension('notes', 'notes 2')).toBe('notes 2');
		// A download is saved with an extension, taken from the stored file when the name has none.
		expect(downloadName('3-bengali-bridal-saree', 'media/med_1/original.JPG')).toBe('3-bengali-bridal-saree.jpg');
		expect(downloadName('size chart.pdf', 'media/med_2/original.pdf')).toBe('size chart.pdf');
		expect(downloadName('notes', 'media/med_3/original')).toBe('notes');
	});
});

describe('photos wait for image profiles', () => {
	it('holds back photos the worker processes, and lets camera RAW and every other file through', () => {
		expect(waitsForImageProfiles('image/jpeg', 'red.jpg')).toBe(true);
		expect(waitsForImageProfiles('IMAGE/PNG', 'logo.PNG')).toBe(true);
		expect(waitsForImageProfiles('image/heic', 'IMG_0412.HEIC')).toBe(true);
		expect(waitsForImageProfiles('image/x-canon-cr3', 'DSC0412.CR3')).toBe(false);
		expect(waitsForImageProfiles('image/x-nikon-nef', 'raw-dsc0099.nef')).toBe(false);
		expect(waitsForImageProfiles('application/pdf', 'chart.pdf')).toBe(false);
		expect(waitsForImageProfiles('video/mp4', 'shoot.mp4')).toBe(false);
	});
});

describe('folders and Trash', () => {
	const folder = { id: 'f1' };
	it('never moves a folder into itself or below itself, nor into Trash', () => {
		expect(folderMoveRefusal(folder, { id: 'f1', ancestors: [], trashedAt: null })).toBe('into_itself');
		expect(folderMoveRefusal(folder, { id: 'f3', ancestors: ['f1', 'f2'], trashedAt: null })).toBe('into_itself');
		expect(folderMoveRefusal(folder, { id: 'f9', ancestors: [], trashedAt: NOW.toISOString() })).toBe(
			'target_in_trash',
		);
		expect(folderMoveRefusal(folder, { id: 'f9', ancestors: ['f8'], trashedAt: null })).toBeNull();
		expect(folderMoveRefusal(folder, null)).toBeNull();
		expect(ancestorsUnder({ id: 'f9', ancestors: ['f8'] })).toEqual(['f8', 'f9']);
		expect(ancestorsUnder(null)).toEqual([]);
	});

	it(`counts ${TRASH_DAYS} days in Trash, then purges`, () => {
		expect(trashDaysLeft(daysAgo(0), NOW)).toBe(30);
		expect(trashDaysLeft(daysAgo(29.5), NOW)).toBe(1);
		expect(trashDaysLeft(daysAgo(45), NOW)).toBe(0);
		expect(trashPurgeDue(daysAgo(29), NOW)).toBe(false);
		expect(trashPurgeDue(daysAgo(30), NOW)).toBe(true);
		expect(trashPurgeDue(null, NOW)).toBe(false);
	});

	it('restores to the old folder, brings a trashed folder back, or uses My files', () => {
		const live = { id: 'f1', trashedAt: null };
		const trashed = { id: 'f1', trashedAt: daysAgo(1) };
		expect(restoreTarget('f1', live, 'restore_folder')).toEqual({ folderId: 'f1', restoreFolder: false });
		expect(restoreTarget('f1', trashed, 'restore_folder')).toEqual({ folderId: 'f1', restoreFolder: true });
		expect(restoreTarget('f1', trashed, 'my_files')).toEqual({ folderId: null, restoreFolder: false });
		expect(restoreTarget('f1', null, 'restore_folder')).toEqual({ folderId: null, restoreFolder: false });
		expect(restoreTarget(null, live, 'restore_folder')).toEqual({ folderId: null, restoreFolder: false });
	});
});

describe('categories', () => {
	it('sorts files the way the Media page lists them', () => {
		expect(mediaCategory('image/jpeg', 'red.jpg')).toBe('images');
		expect(mediaCategory('video/mp4', 'reel.mp4')).toBe('videos');
		expect(mediaCategory('application/pdf', 'catalogue.pdf')).toBe('documents');
		expect(mediaCategory('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'stock.xlsx')).toBe(
			'documents',
		);
		expect(mediaCategory('text/csv', 'orders.csv')).toBe('documents');
		expect(mediaCategory('application/zip', 'photos.zip')).toBe('archives');
		expect(mediaCategory('application/octet-stream', 'saha-textile-backup-2026-11-14.archive')).toBe('backups');
		expect(mediaCategory('application/gzip', 'mongo-backup.gz')).toBe('backups');
		expect(mediaCategory('application/octet-stream', 'IMG_0001.CR3')).toBe('other');
	});
});

describe('share links', () => {
	it('stops after the chosen time, on a future date, or never', () => {
		expect(shareExpiresAt('1h', NOW)).toEqual({ ok: true, expiresAt: '2026-11-15T11:00:00.000Z' });
		expect(shareExpiresAt('30d', NOW)).toEqual({ ok: true, expiresAt: '2026-12-15T10:00:00.000Z' });
		expect(shareExpiresAt('never', NOW)).toEqual({ ok: true, expiresAt: null });
		expect(shareExpiresAt('date', NOW, '2027-01-01T00:00:00.000Z')).toEqual({
			ok: true,
			expiresAt: '2027-01-01T00:00:00.000Z',
		});
		expect(shareExpiresAt('date', NOW, '2026-11-01T00:00:00.000Z')).toEqual({ ok: false, reason: 'date_in_past' });
		expect(shareExpiresAt('date', NOW)).toEqual({ ok: false, reason: 'date_in_past' });
	});

	it('is stopped before it is expired, and active otherwise', () => {
		expect(shareLinkState({ stoppedAt: daysAgo(1), expiresAt: null }, NOW)).toBe('stopped');
		expect(shareLinkState({ stoppedAt: null, expiresAt: daysAgo(1) }, NOW)).toBe('expired');
		expect(shareLinkState({ stoppedAt: null, expiresAt: null }, NOW)).toBe('active');
	});
});

describe('the website picture in the share popup', () => {
	const size = (role: string, width: number) => ({ role, width, storageKey: `media/x/${role}-${width}.webp` });
	it('names the widest size of the page role a photo has, and nothing for private files', () => {
		const derivatives = [
			size('thumb', 150),
			size('gallery', 800),
			size('gallery', 1600),
			size('zoom', 2000),
			size('share', 1200),
		];
		expect(websitePicture({ visibility: 'public', derivatives } as never)).toEqual({
			role: 'gallery',
			width: 1600,
			storageKey: 'media/x/gallery-1600.webp',
		});
		expect(
			websitePicture({ visibility: 'public', derivatives: [size('banner', 1920), size('card', 400)] } as never)
				?.role,
		).toBe('banner');
		expect(websitePicture({ visibility: 'private', derivatives } as never)).toBeNull();
		expect(websitePicture({ visibility: 'public', derivatives: [size('share', 1200)] } as never)).toBeNull();
	});
});

describe('share links: making and opening', () => {
	const base = {
		kind: 'file' as const,
		visibility: 'private' as const,
		trashed: false,
		who: 'anyone' as const,
		hasPassword: false,
	};

	it('makes links for private files and photo originals, not for public files or Trash', () => {
		expect(shareCreateRefusal(base)).toBeNull();
		expect(shareCreateRefusal({ ...base, kind: 'image', visibility: 'public' })).toBeNull();
		expect(shareCreateRefusal({ ...base, visibility: 'public' })).toBe('public_file');
		expect(shareCreateRefusal({ ...base, trashed: true })).toBe('file_in_trash');
		expect(shareCreateRefusal({ ...base, who: 'admins', hasPassword: true })).toBe('password_for_admins');
		expect(shareCreateRefusal({ ...base, who: 'admins' })).toBeNull();
	});

	const link = { stoppedAt: null, expiresAt: null, who: 'anyone' as const, passwordHash: null };
	const open = (over: Partial<Parameters<typeof shareOpenState>[0]> = {}) =>
		shareOpenState({ link, fileAvailable: true, now: NOW, signedInAdmin: false, passwordOk: null, ...over });

	it('opens an active link and reads every dead end as expired', () => {
		expect(open()).toBe('open');
		expect(open({ link: null })).toBe('expired');
		expect(open({ fileAvailable: false })).toBe('expired');
		expect(open({ link: { ...link, stoppedAt: daysAgo(1) } })).toBe('expired');
		expect(open({ link: { ...link, expiresAt: daysAgo(1) } })).toBe('expired');
	});

	it('asks for the password until it is right, and admins-only links for a signed-in admin', () => {
		const locked = { ...link, passwordHash: 'hash' };
		expect(open({ link: locked })).toBe('password');
		expect(open({ link: locked, passwordOk: false })).toBe('password');
		expect(open({ link: locked, passwordOk: true })).toBe('open');
		const admins = { ...link, who: 'admins' as const };
		expect(open({ link: admins })).toBe('admins_only');
		expect(open({ link: admins, signedInAdmin: true })).toBe('open');
		// A stopped admins-only link stays stopped for admins too.
		expect(open({ link: { ...admins, stoppedAt: daysAgo(0) }, signedInAdmin: true })).toBe('expired');
	});
});

describe('storage', () => {
	it('colours the bar green, yellow from 60% and red from 85%', () => {
		expect([59.9, 60, 84.9, 85, 120].map(storageColour)).toEqual(['green', 'yellow', 'yellow', 'red', 'red']);
	});

	it('counts on-demand storage in GiB, like the bill', () => {
		expect(onDemand(STORAGE_PLAN_BYTES)).toEqual({ bytes: 0, monthlyUsd: 0 });
		expect(onDemand(STORAGE_PLAN_BYTES + 10 * GIB)).toEqual({ bytes: 10 * GIB, monthlyUsd: 0.2 });
	});

	it('goes within the plan, asks a super admin past it, and refuses others unless allowed', () => {
		const base = {
			usedBytes: 249 * GIB,
			reservedBytes: 0,
			superAdmin: false,
			othersMayUseOnDemand: false,
			approved: false,
		};
		expect(decideStorage({ ...base, addBytes: GIB })).toBe('go');
		expect(decideStorage({ ...base, addBytes: 2 * GIB })).toBe('refused');
		expect(decideStorage({ ...base, addBytes: 2 * GIB, superAdmin: true })).toBe('ask');
		expect(decideStorage({ ...base, addBytes: 2 * GIB, superAdmin: true, approved: true })).toBe('go');
		expect(decideStorage({ ...base, addBytes: 2 * GIB, othersMayUseOnDemand: true })).toBe('ask');
		// Two uploads at once: what the other admin has running counts too.
		expect(decideStorage({ ...base, addBytes: GIB, reservedBytes: GIB })).toBe('refused');
	});
});
