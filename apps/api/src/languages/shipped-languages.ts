import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ShippedLanguage } from '@saha-textile/contracts';
import { shippedLanguages } from '@saha-textile/core-domain';
import { isLocaleCode } from '@saha-textile/core-domain/languages';

/**
 * What this release ships for each language (step 0d, "release first, then add"): the menu and
 * button files of both apps, and the shop's four legal pages. The API's build writes it next to
 * `main.js` from the same commit the apps are built from (`write-language-manifest.ts`); on a
 * developer's Mac, where the build output is rebuilt on every save, it is read from the repository.
 */
export interface LanguageManifest {
	/** Admin menu and button files: language → keys missing against English. */
	admin: Record<string, number>;
	/** The shop's files, the same way. */
	shop: Record<string, number>;
	/** English keys in each app's file: what a language without a file still has to write. */
	adminKeys: number;
	shopKeys: number;
	/** The shop's legal pages and the languages each exists in. */
	pages: Record<string, string[]>;
}

export const MANIFEST_FILE = 'shipped-languages.json';
const ADMIN_FILES = 'apps/admin/public/assets/i18n';
const SHOP_FILES = 'apps/storefront/public/assets/i18n';
const SHOP_PAGES = 'apps/storefront/public/assets/data/pages';

/** The repository root above a path, found by its workspace file; null inside a built image. */
export function repositoryRoot(from: string): string | null {
	let at = from;
	for (;;) {
		if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
		const parent = dirname(at);
		if (parent === at) return null;
		at = parent;
	}
}

const flatKeys = (value: unknown, prefix = ''): string[] =>
	value && typeof value === 'object' && !Array.isArray(value)
		? Object.entries(value).flatMap(([key, inner]) => flatKeys(inner, prefix ? `${prefix}.${key}` : key))
		: [prefix];

/** One app's files: `<code>.json` only, each counted against English. */
function readFiles(directory: string): { missing: Record<string, number>; keys: number } {
	if (!existsSync(directory)) return { missing: {}, keys: 0 };
	const codes = readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.slice(0, -'.json'.length))
		.filter(isLocaleCode);
	const keys = (code: string) => new Set(flatKeys(JSON.parse(readFileSync(join(directory, `${code}.json`), 'utf8'))));
	const english = codes.includes('en') ? keys('en') : new Set<string>();
	const missing = Object.fromEntries(
		codes.map((code) => {
			const own = keys(code);
			return [code, [...english].filter((key) => !own.has(key)).length];
		}),
	);
	return { missing, keys: english.size };
}

/** Legal pages: `<slug>.json` is English, `<slug>.<code>.json` another language. */
function readPages(directory: string): Record<string, string[]> {
	if (!existsSync(directory)) return {};
	const pages: Record<string, string[]> = {};
	for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
		const parts = name.slice(0, -'.json'.length).split('.');
		const code = parts.length > 1 ? (parts.pop() as string) : 'en';
		if (!isLocaleCode(code)) continue;
		const slug = parts.join('.');
		(pages[slug] ??= []).push(code);
	}
	return pages;
}

/** The manifest from a repository checkout. */
export function manifestFromRepository(root: string): LanguageManifest {
	const admin = readFiles(join(root, ADMIN_FILES));
	const shop = readFiles(join(root, SHOP_FILES));
	return {
		admin: admin.missing,
		shop: shop.missing,
		adminKeys: admin.keys,
		shopKeys: shop.keys,
		pages: readPages(join(root, SHOP_PAGES)),
	};
}

/** The manifest this process runs with: the built file, else the repository, else nothing shipped. */
export function loadLanguageManifest(builtDirectory: string = join(__dirname, '..')): LanguageManifest {
	const built = join(builtDirectory, MANIFEST_FILE);
	if (existsSync(built)) return JSON.parse(readFileSync(built, 'utf8')) as LanguageManifest;
	const root = repositoryRoot(builtDirectory);
	return root
		? manifestFromRepository(root)
		: { admin: { en: 0 }, shop: { en: 0 }, adminKeys: 0, shopKeys: 0, pages: {} };
}

/** The languages this release can offer, from a manifest. */
export function shippedFrom(manifest: LanguageManifest): ShippedLanguage[] {
	return shippedLanguages(manifest.admin, manifest.shop);
}

/** Legal pages a language still lacks (each page English has). */
export function missingPages(manifest: LanguageManifest, code: string): number {
	return Object.values(manifest.pages).filter((codes) => codes.includes('en') && !codes.includes(code)).length;
}

/** Shop menu and button text a language lacks: every English key when its file is not shipped. */
export function missingShopText(manifest: LanguageManifest, code: string): number {
	return manifest.shop[code] ?? manifest.shopKeys;
}

/** The admin's, the same way. */
export function missingAdminText(manifest: LanguageManifest, code: string): number {
	return manifest.admin[code] ?? manifest.adminKeys;
}
