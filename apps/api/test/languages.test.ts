import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
	ActiveLocaleConfig,
	type AuditLog,
	type LanguageRecord,
	PRIMARY_LOCALE,
	WRITTEN_LANGUAGE_AREAS,
	type WrittenLanguageArea,
} from '@saha-textile/contracts';
import type { LanguageCoverageRepository, LanguageRepository } from '@saha-textile/core-domain';
import { PRIMARY_LOCALE as SHARED_PRIMARY } from '@saha-textile/core-domain/languages';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY, PUBLIC_ROUTE_KEY } from '../src/auth/session.guard';
import { isPublicRead } from '../src/common/public-read';
import { LanguageStore } from '../src/languages/language-store';
import { AdminLanguagesController, LanguagesController } from '../src/languages/languages.controller';
import { LanguagesService } from '../src/languages/languages.service';
import {
	type LanguageManifest,
	loadLanguageManifest,
	manifestFromRepository,
	missingAdminText,
	missingPages,
	missingShopText,
	repositoryRoot,
	shippedFrom,
} from '../src/languages/shipped-languages';

/** A release shipping English, বাংলা and हिन्दी in both apps, তামিল in the shop only. */
const MANIFEST: LanguageManifest = {
	admin: { en: 0, bn: 0, hi: 0 },
	shop: { en: 0, bn: 0, hi: 0, ta: 0 },
	adminKeys: 900,
	shopKeys: 500,
	pages: {
		'privacy-policy': ['en', 'bn', 'hi'],
		'shipping-policy': ['en', 'bn', 'hi'],
		'refund-returns': ['en', 'bn', 'hi'],
		'terms-conditions': ['en', 'bn', 'hi'],
	},
};

class MemoryLanguages implements LanguageRepository {
	rows = new Map<string, LanguageRecord>();
	async list() {
		return [...this.rows.values()];
	}
	async find(code: string) {
		return this.rows.get(code) ?? null;
	}
	async save(record: LanguageRecord) {
		this.rows.set(record.code, record);
		return record;
	}
	async seedIfEmpty(records: readonly LanguageRecord[]) {
		if (this.rows.size) return false;
		for (const record of records) this.rows.set(record.code, record);
		return true;
	}
}

const zero = (): Record<WrittenLanguageArea, number> =>
	Object.fromEntries(WRITTEN_LANGUAGE_AREAS.map((area) => [area, 0])) as Record<WrittenLanguageArea, number>;

function harness(missing: Partial<Record<WrittenLanguageArea, number>> = {}) {
	const repo = new MemoryLanguages();
	const store = new LanguageStore(repo, { locales: ['en', 'bn'] });
	const audit: AuditLog[] = [];
	const coverage = {
		missing: vi.fn(async () => ({ ...zero(), ...missing })),
		missingIds: vi.fn(async () => ['prd_1']),
		itemsWithText: vi.fn(async () => 12),
		erase: vi.fn(async () => 12),
	} satisfies LanguageCoverageRepository;
	const catalog = { sitemapPaths: vi.fn(async () => ['/bn/', '/bn/product/a', '/en/product/a', '/bnx/odd']) };
	const blog = { sitemapPaths: vi.fn(async () => ['/bn/blog/post']) };
	const service = new LanguagesService(
		repo,
		coverage,
		{ append: async (entry: AuditLog) => void audit.push(entry) } as never,
		store,
		catalog as never,
		blog as never,
	).useManifest(MANIFEST);
	return { repo, store, audit, coverage, service, admin: new AdminLanguagesController(service) };
}

const principal = { userId: 'adm_owner', sessionId: 's', audience: 'admin', role: 'admin', permissions: [] } as never;
const request = { id: 'req_1' } as never;

/** The refusal code a domain refusal carries. */
async function refusal(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BadRequestException);
		const body = (error as BadRequestException).getResponse() as { issues?: { code: string }[] };
		return body.issues?.[0]?.code ?? 'no code';
	}
	throw new Error('expected a refusal');
}

describe('GET /storefront/languages', () => {
	it('answers the shop’s languages, the admin’s and the 301s, in the shared shape', async () => {
		const { store, service } = harness();
		await store.refresh();
		const answer = new LanguagesController(service).list();
		expect(answer).toEqual({ default: 'en', active: ['en', 'bn'], admin: ['en', 'bn'], redirect: [] });
		expect(ActiveLocaleConfig.parse(answer)).toEqual(answer);
	});

	it('uses the same English as the browser-safe language rules', () => {
		expect(SHARED_PRIMARY).toBe(PRIMARY_LOCALE);
	});

	it('starts from ACTIVE_LOCALES, English first and once, before the first read', () => {
		expect(LanguageStore.fixed(['bn', 'en', 'bn']).shop()).toEqual(['en', 'bn']);
		expect(LanguageStore.fixed(['bn']).content()).toEqual(['en', 'bn']);
	});

	it('is public, cacheable for a minute, and outside the shared rate limit', () => {
		const handler = LanguagesController.prototype.list;
		expect(new Reflector().get(PUBLIC_ROUTE_KEY, handler)).toBe(true);
		expect(Reflect.getMetadata('__headers__', handler)).toEqual([
			{ name: 'Cache-Control', value: 'public, max-age=60' },
		]);
		expect(isPublicRead('GET', '/storefront/languages')).toBe(true);
		expect(isPublicRead('POST', '/storefront/languages')).toBe(false);
	});
});

describe('the stored list', () => {
	it('seeds an empty list once from ACTIVE_LOCALES and keeps English on whatever is stored', async () => {
		const { repo, store } = harness();
		await store.refresh();
		expect([...repo.rows.keys()]).toEqual(['en', 'bn']);
		repo.rows.set('en', { ...repo.rows.get('en')!, admin: false, shop: 'off' });
		await store.refresh();
		expect(store.shop()).toEqual(['en', 'bn']);
		expect(store.admin()).toEqual(['en', 'bn']);
	});

	it('keeps the last list when a read fails', async () => {
		const { repo, store } = harness();
		await store.refresh();
		vi.spyOn(repo, 'list').mockRejectedValueOnce(new Error('down'));
		await expect(store.refresh()).rejects.toThrow('down');
		expect(store.shop()).toEqual(['en', 'bn']);
	});
});

describe('Settings › Languages', () => {
	it('lets every signed-in admin read the working list; everything else needs language.manage', () => {
		const reflector = new Reflector();
		expect(reflector.get(PERMISSIONS_KEY, AdminLanguagesController.prototype.list)).toBeUndefined();
		for (const name of ['settings', 'reminders', 'todo', 'add', 'admin', 'shop', 'remove', 'keep', 'erase'] as const) {
			expect(reflector.get(PERMISSIONS_KEY, AdminLanguagesController.prototype[name]), name).toEqual([
				'language.manage',
			]);
		}
	});

	it('adds only a language both apps ship, as a draft forms show and the shop does not', async () => {
		const { admin, store, audit, service } = harness();
		await store.refresh();
		expect(await refusal(admin.add({ code: 'ta' }, principal, request))).toBe('not_in_release');
		expect(await refusal(admin.add({ code: 'fr' }, principal, request))).toBe('not_in_release');
		expect(await refusal(admin.add({ code: 'bn' }, principal, request))).toBe('already_added');

		const page = await admin.add({ code: 'hi' }, principal, request);
		expect(page.rows.map((row) => [row.code, row.shop, row.admin])).toEqual([
			['en', 'on', true],
			['bn', 'on', true],
			['hi', 'draft', false],
		]);
		expect(page.shipped.find((row) => row.code === 'ta')).toMatchObject({ inBoth: false });
		expect(service.workingList().languages.map((row) => row.code)).toEqual(['en', 'bn', 'hi']);
		expect(service.publicList().active).toEqual(['en', 'bn']);
		expect(store.content()).toEqual(['en', 'bn', 'hi']);
		expect(audit.at(-1)).toMatchObject({
			action: 'language.add',
			entityType: 'language',
			entityId: 'hi',
			actorUserId: 'adm_owner',
			requestId: 'req_1',
		});
	});

	it('switches the admin on only with its file complete, and lists it for the header', async () => {
		const { admin, store, service } = harness();
		await store.refresh();
		await admin.add({ code: 'hi' }, principal, request);
		service.useManifest({ ...MANIFEST, admin: { ...MANIFEST.admin, hi: 3 } });
		expect(await refusal(admin.admin('hi', { on: true }, principal, request))).toBe('admin_text_incomplete');
		service.useManifest(MANIFEST);
		await admin.admin('hi', { on: true }, principal, request);
		expect(service.publicList().admin).toEqual(['en', 'bn', 'hi']);
		expect(service.publicList().active).toEqual(['en', 'bn']);
	});

	it('refuses the shop switch while anything is left, then shows it; off sends its addresses to English', async () => {
		const left = harness({ products: 2, photos: 1 });
		await left.store.refresh();
		await left.admin.add({ code: 'hi' }, principal, request);
		expect(await left.admin.todo('hi')).toMatchObject({ total: 3 });
		expect(await refusal(left.admin.shop('hi', { on: true }, principal, request))).toBe('todo_left');

		const { admin, store, service, audit } = harness();
		await store.refresh();
		await admin.add({ code: 'hi' }, principal, request);
		await admin.shop('hi', { on: true }, principal, request);
		expect(service.publicList()).toMatchObject({ active: ['en', 'bn', 'hi'], redirect: [] });
		await admin.shop('bn', { on: false }, principal, request);
		expect(service.publicList()).toMatchObject({ active: ['en', 'hi'], redirect: ['bn'] });
		expect(audit.at(-1)).toMatchObject({
			action: 'language.shop.switch',
			diffs: [{ field: 'shop', before: 'on', after: 'off' }],
		});
	});

	it('counts the admin’s own words apart: they never stop the shop', async () => {
		const { service } = harness();
		service.useManifest({ ...MANIFEST, admin: { en: 0 }, pages: { 'privacy-policy': ['en'] } });
		const todo = await service.todo('hi');
		expect(todo.lines.find((line) => line.area === 'admin_text')).toEqual({
			area: 'admin_text',
			count: 900,
			blocksShop: false,
		});
		expect(todo.lines.find((line) => line.area === 'pages')?.count).toBe(1);
		expect(todo.total).toBe(1);
		expect((await service.todo('en')).total).toBe(0);
	});

	it('never changes English, and answers 404 for a language never added', async () => {
		const { admin, store } = harness();
		await store.refresh();
		expect(await refusal(admin.shop('en', { on: false }, principal, request))).toBe('english_fixed');
		expect(await refusal(admin.remove('en', principal, request))).toBe('english_fixed');
		await expect(admin.shop('hi', { on: true }, principal, request)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('deletes only once the shop is off; keeps the text; reminds after 30 days; erases after the name', async () => {
		const { admin, store, service, coverage, audit, repo } = harness();
		await store.refresh();
		expect(await refusal(admin.remove('bn', principal, request))).toBe('shop_on');
		await admin.shop('bn', { on: false }, principal, request);
		const page = await admin.remove('bn', principal, request);
		expect(page.rows.at(-1)).toMatchObject({ code: 'bn', admin: false, itemsWithText: 12 });
		expect(service.workingList().languages.map((row) => row.code)).toEqual(['en']);
		expect(service.publicList()).toMatchObject({ active: ['en'], admin: ['en'], redirect: ['bn'] });
		expect(coverage.erase).not.toHaveBeenCalled();

		expect((await service.reminders()).reminders).toEqual([]);
		const deleted = repo.rows.get('bn')!;
		repo.rows.set('bn', { ...deleted, deletedAt: '2026-01-01T00:00:00.000Z' });
		await store.refresh();
		expect((await service.reminders()).reminders).toEqual([
			{ code: 'bn', deletedAt: '2026-01-01T00:00:00.000Z', itemsWithText: 12 },
		]);
		await admin.keep('bn', principal, request);
		expect((await service.reminders()).reminders).toEqual([]);

		expect(await refusal(admin.erase('bn', { confirm: 'Bangla' }, principal, request))).toBe('name_mismatch');
		const erased = await admin.erase('bn', { confirm: 'বাংলা' }, principal, request);
		expect(coverage.erase).toHaveBeenCalledWith('bn');
		expect(erased.rows.at(-1)).toMatchObject({ code: 'bn', itemsWithText: 0 });
		expect(audit.at(-1)).toMatchObject({ action: 'language.erase', severity: 'warn', metadata: { erasedItems: 12 } });
		expect(await refusal(admin.erase('bn', { confirm: 'বাংলা' }, principal, request))).toBe('already_erased');

		// Adding it again starts a draft; its addresses keep answering 301 until the shop shows it.
		await admin.add({ code: 'bn' }, principal, request);
		expect(service.publicList()).toMatchObject({ active: ['en'], redirect: ['bn'] });
		expect(service.workingList().languages.map((row) => [row.code, row.shop])).toEqual([
			['en', 'on'],
			['bn', 'draft'],
		]);
	});

	it('counts each language’s sitemap addresses before the shop switch goes off', async () => {
		const { service, store } = harness();
		await store.refresh();
		const rows = (await service.settings()).rows;
		expect(rows.find((row) => row.code === 'bn')?.addresses).toBe(3);
		expect(rows.find((row) => row.code === 'en')).toMatchObject({ todo: 0, itemsWithText: 0, addresses: 1 });
	});

	it('hands a list page the ids missing one language', async () => {
		const { service, coverage } = harness();
		expect(await service.missingIds('products', 'hi')).toEqual(['prd_1']);
		expect(coverage.missingIds).toHaveBeenCalledWith('products', 'hi');
	});
});

describe('what this release ships', () => {
	const root = repositoryRoot(resolve(__dirname));

	it('reads both apps’ files and the shop’s legal pages from this checkout', () => {
		expect(root).toBeTruthy();
		const manifest = manifestFromRepository(root!);
		expect(manifest.admin).toMatchObject({ en: 0, bn: 0 });
		expect(manifest.shop).toMatchObject({ en: 0, bn: 0 });
		expect(manifest.adminKeys).toBeGreaterThan(500);
		expect(Object.keys(manifest.pages).sort()).toEqual([
			'privacy-policy',
			'refund-returns',
			'shipping-policy',
			'terms-conditions',
		]);
		expect(missingPages(manifest, 'bn')).toBe(0);
		expect(missingPages(manifest, 'hi')).toBe(4);
		expect(missingShopText(manifest, 'hi')).toBe(manifest.shopKeys);
		expect(missingAdminText(manifest, 'bn')).toBe(0);
		expect(shippedFrom(manifest).map((row) => row.code)).toEqual(expect.arrayContaining(['en', 'bn']));
	});

	it('prefers the file the build wrote, then the checkout', () => {
		const built = mkdtempSync(join(tmpdir(), 'saha-textile-manifest-'));
		writeFileSync(join(built, 'shipped-languages.json'), JSON.stringify(MANIFEST));
		expect(loadLanguageManifest(built)).toEqual(MANIFEST);
		expect(loadLanguageManifest(join(root!, 'apps', 'api', 'src')).admin).toMatchObject({ en: 0, bn: 0 });
	});
});
