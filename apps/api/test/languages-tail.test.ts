import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuditLog, LanguageRecord } from '@saha-textile/contracts';
import type { LanguageRepository } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { LanguagesService } from '../src/languages/languages.service';
import {
	type LanguageManifest,
	loadLanguageManifest,
	manifestFromRepository,
	repositoryRoot,
} from '../src/languages/shipped-languages';

const MANIFEST: LanguageManifest = { admin: { en: 0, bn: 0 }, shop: { en: 0, bn: 0 }, adminKeys: 900, shopKeys: 500 };

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

async function harness() {
	const repo = new MemoryLanguages();
	const store = new LanguageStore(repo, { locales: ['en', 'bn'] });
	await store.refresh();
	const bn = (await repo.find('bn')) as LanguageRecord;
	// Two languages added before the date was kept, one of them not in this release.
	await repo.save({ ...bn, code: 'hi', admin: false, shop: 'draft', everOn: false, addedAt: null } as never);
	await repo.save({ ...bn, code: 'gu', admin: false, shop: 'draft', everOn: false, addedAt: null } as never);
	const audit: AuditLog[] = [];
	const service = new LanguagesService(
		repo,
		{
			missing: vi.fn(async () => ({})),
			missingIds: vi.fn(async () => []),
			itemsWithText: vi.fn(async () => 0),
			erase: vi.fn(async () => 0),
		} as never,
		{ append: async (entry: AuditLog) => void audit.push(entry) } as never,
		store,
	).useManifest(MANIFEST);
	return { service, audit };
}

describe('Settings › Languages: the last cases', () => {
	it('sorts undated languages first, by code, marks one the release lacks, and counts no addresses without the catalogue or blog', async () => {
		const { service } = await harness();
		const settings = await service.settings();
		expect(settings.rows.map((row) => [row.code, row.adminFileComplete, row.addresses])).toEqual([
			['en', true, 0],
			['gu', false, 0],
			['hi', false, 0],
			['bn', true, 0],
		]);
	});

	it('records nothing for a change that changes nothing', async () => {
		const { service, audit } = await harness();
		await service.change('adm_owner', { kind: 'admin', code: 'bn', on: true } as never, null);
		expect(audit).toEqual([]);
	});
});

describe('the languages a release ships: the last cases', () => {
	const root = () => {
		const at = mkdtempSync(join(tmpdir(), 'shipped-languages-'));
		writeFileSync(join(at, 'pnpm-workspace.yaml'), 'packages: []\n');
		return at;
	};

	it('finds no repository above the file system’s root', () => {
		expect(repositoryRoot('/')).toBeNull();
	});

	it('reads nested keys, counts an app with no English file as having none, and an app with no folder as empty', () => {
		const at = root();
		const admin = join(at, 'apps/admin/public/assets/i18n');
		mkdirSync(admin, { recursive: true });
		writeFileSync(join(admin, 'bn.json'), JSON.stringify({ menu: { orders: 'অর্ডার' } }));
		expect(manifestFromRepository(at)).toEqual({ admin: { bn: 0 }, shop: {}, adminKeys: 0, shopKeys: 0 });
		writeFileSync(join(admin, 'en.json'), JSON.stringify({ menu: { orders: 'Orders', stock: 'Stock' } }));
		expect(manifestFromRepository(at).admin).toEqual({ en: 0, bn: 1 });
	});

	it('ships English alone when there is neither a built list nor a repository', () => {
		const lone = mkdtempSync(join(tmpdir(), 'built-'));
		expect(loadLanguageManifest(lone)).toEqual({ admin: { en: 0 }, shop: { en: 0 }, adminKeys: 0, shopKeys: 0 });
	});
});
