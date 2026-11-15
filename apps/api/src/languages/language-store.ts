import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { LanguageRecord } from '@saha-textile/contracts';
import {
	type LanguageRepository,
	type LanguageSets,
	languageSets,
	seedLanguages,
	setLocalePrefixTest,
	withEnglishFixed,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';

/** How often every API process and the worker re-read the list (a change elsewhere shows within this). */
export const LANGUAGE_REFRESH_MS = 30_000;
const SEED_TIME = '1970-01-01T00:00:00.000Z';

/**
 * The stored languages (Settings › Languages), read once and kept in memory, so every reader asks
 * synchronously: `shop()` for what the shop shows (Go Live, sitemaps, search, messages), `content()`
 * for what forms show (drafts included), `admin()` for the admin's own words, and `redirect()` for
 * languages whose addresses answer 301.
 *
 * Until the first read, and if the list is ever empty, the languages come from `ACTIVE_LOCALES`,
 * which seeds an empty list once. From then on the database decides; `ACTIVE_LOCALES` is only the
 * first-run seed.
 *
 * Bound in the persistence module by a factory (its repository and `ACTIVE_LOCALES`), and injected
 * everywhere else by this class.
 */
export class LanguageStore implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(LanguageStore.name);
	private stored: LanguageRecord[];
	private current: LanguageSets;
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private readonly repository: LanguageRepository | null,
		private readonly config: Pick<AppConfig, 'locales'>,
	) {
		this.stored = seedLanguages(config.locales, SEED_TIME);
		this.current = languageSets(this.stored);
		// Saved redirects strip a language prefix before comparing addresses: every language whose
		// addresses the shop serves or once served.
		setLocalePrefixTest((segment) => this.current.shop.includes(segment) || this.current.redirect.includes(segment));
	}

	/** A store fixed to some languages, all on in both apps: tests and one-off scripts. */
	static fixed(locales: readonly string[]): LanguageStore {
		return new LanguageStore(null, { locales: [...locales] });
	}

	/** The languages the shop shows, English first. */
	shop(): string[] {
		return this.current.shop;
	}

	/** Every language that is not deleted: forms show each one, drafts included. */
	content(): string[] {
		return this.current.content;
	}

	/** The languages staff may turn the admin into. */
	admin(): string[] {
		return this.current.admin;
	}

	/** Languages the shop showed once and does not show now. */
	redirect(): string[] {
		return this.current.redirect;
	}

	/** Every stored row, deleted ones included, English first. */
	records(): LanguageRecord[] {
		return this.stored;
	}

	/** Reads the list again now: after a change here, and every 30 seconds for changes made elsewhere. */
	async refresh(): Promise<void> {
		if (!this.repository) return;
		const now = new Date().toISOString();
		await this.repository.seedIfEmpty(seedLanguages(this.config.locales, now));
		this.apply(withEnglishFixed(await this.repository.list(), now));
	}

	/** Uses rows already read (a change just saved), without another read. */
	apply(records: readonly LanguageRecord[]): void {
		this.stored = [...records];
		this.current = languageSets(this.stored);
	}

	onApplicationBootstrap(): void {
		if (!this.repository || process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1') return;
		this.start();
	}

	/** First read now, then every 30 seconds; a failed read keeps the last list. */
	start(): void {
		const read = () =>
			this.refresh().catch((error: unknown) =>
				this.logger.warn(`Could not read the languages (${(error as Error).message}); keeping the last list.`),
			);
		void read();
		this.timer ??= setInterval(() => void read(), LANGUAGE_REFRESH_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
