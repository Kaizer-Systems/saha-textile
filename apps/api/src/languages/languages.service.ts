import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	type ActiveLocaleConfig,
	type AuditLog,
	type LanguageListResponse,
	type LanguageRecord,
	type LanguageRefusal,
	type LanguageReminderResponse,
	type LanguageSettingsResponse,
	type LanguageSettingsRow,
	type LanguageTodoResponse,
	PRIMARY_LOCALE,
	type WrittenLanguageArea,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type LanguageChange,
	type LanguageCoverageRepository,
	type LanguageRepository,
	decideLanguageChange,
	languageReminderDue,
	languageTodo,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import { BlogPublicService } from '../blog/blog-public.service';
import { CatalogPublicService } from '../catalog/catalog-public.service';
import { AUDIT_LOG_REPOSITORY, LANGUAGE_COVERAGE_REPOSITORY, LANGUAGE_REPOSITORY } from '../infra/tokens';
import { LanguageStore } from './language-store';
import {
	type LanguageManifest,
	loadLanguageManifest,
	missingAdminText,
	missingShopText,
	shippedFrom,
} from './shipped-languages';

/** English fallbacks; the admin page shows its own translated sentence for each code. */
const REFUSALS: Readonly<Record<LanguageRefusal, string>> = {
	english_fixed: 'English is always on and cannot be changed',
	unknown_language: 'Unknown language',
	already_added: 'This language is already added',
	not_in_release: 'This language’s menu and button text has not come with a release yet',
	admin_text_incomplete: 'The admin’s menu and button text for this language is not complete',
	todo_left: 'Text is still missing in this language',
	shop_on: 'Switch the shop off for this language first',
	not_deleted: 'Only a deleted language can be erased or kept',
	name_mismatch: 'Type the language’s name exactly as shown',
	already_erased: 'This language’s text is already erased',
};

const ACTIONS: Readonly<Record<LanguageChange['kind'], string>> = {
	add: 'language.add',
	admin: 'language.admin.switch',
	shop: 'language.shop.switch',
	delete: 'language.delete',
	erase: 'language.erase',
	keep: 'language.reminder.keep',
};

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15). The rules live in core
 * (`decideLanguageChange`); this service brings the facts they need (what the release ships, what is
 * still empty), saves the row, refreshes the in-memory list every reader uses, and records each
 * change in the audit trail. A refused change answers 400 with the rule's code as a domain refusal.
 */
@Injectable()
export class LanguagesService {
	private manifest: LanguageManifest | null = null;

	constructor(
		@Inject(LANGUAGE_REPOSITORY) private readonly languages: LanguageRepository,
		@Inject(LANGUAGE_COVERAGE_REPOSITORY) private readonly coverage: LanguageCoverageRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly store: LanguageStore,
		// Named outright: a `| null` type is recorded as Object, which Nest cannot resolve.
		@Optional() @Inject(CatalogPublicService) private readonly catalog: CatalogPublicService | null = null,
		@Optional() @Inject(BlogPublicService) private readonly blog: BlogPublicService | null = null,
	) {}

	/** Tests hand in a release's files instead of reading this checkout's. */
	useManifest(manifest: LanguageManifest): this {
		this.manifest = manifest;
		return this;
	}

	/** What this release ships, read once per process (it cannot change while the process runs). */
	private shipped(): LanguageManifest {
		this.manifest ??= loadLanguageManifest();
		return this.manifest;
	}

	/** `GET /storefront/languages`: what the shop shows, the admin's own languages, and the 301s. */
	publicList(): ActiveLocaleConfig {
		return {
			default: PRIMARY_LOCALE,
			active: this.store.shop(),
			admin: this.store.admin(),
			redirect: this.store.redirect(),
		};
	}

	/** `GET /admin/languages`: every language not deleted, for forms and the header menu. */
	workingList(): LanguageListResponse {
		return {
			default: PRIMARY_LOCALE,
			languages: this.store
				.records()
				.filter((row) => !row.deletedAt)
				.map(({ code, admin, shop }) => ({ code, admin, shop })),
		};
	}

	/** One language's to-do list: files from the release, then everything written in the admin. */
	async todo(code: string): Promise<LanguageTodoResponse> {
		if (code === PRIMARY_LOCALE) return { code, ...languageTodo({}) };
		const manifest = this.shipped();
		const written = await this.coverage.missing(code);
		const { lines, total } = languageTodo({
			...written,
			shop_text: missingShopText(manifest, code),
			admin_text: missingAdminText(manifest, code),
			// The four legal pages are written in Admin › Pages and counted from the database (Legal Pages brief).
		});
		return { code, lines, total };
	}

	/** The ids of the items one list page shows for "missing in this language". */
	missingIds(area: WrittenLanguageArea, code: string): Promise<string[]> {
		return this.coverage.missingIds(area, code);
	}

	async settings(now = new Date()): Promise<LanguageSettingsResponse> {
		await this.store.refresh();
		const manifest = this.shipped();
		const shipped = shippedFrom(manifest);
		const sitemap = await this.sitemapPaths();
		const rows: LanguageSettingsRow[] = [];
		for (const record of this.ordered(this.store.records())) {
			const english = record.code === PRIMARY_LOCALE;
			const erased = !!record.erasedAt;
			rows.push({
				...record,
				todo: english || record.deletedAt ? 0 : (await this.todo(record.code)).total,
				itemsWithText: english || erased ? 0 : await this.coverage.itemsWithText(record.code),
				adminFileComplete: shipped.find((row) => row.code === record.code)?.adminComplete ?? false,
				reminderDue: languageReminderDue(record, now),
				addresses: sitemap.filter((path) => path === `/${record.code}` || path.startsWith(`/${record.code}/`))
					.length,
			});
		}
		return { default: PRIMARY_LOCALE, rows, shipped };
	}

	/** Deleted languages whose stored text the bell reminds the owner about. */
	async reminders(now = new Date()): Promise<LanguageReminderResponse> {
		const due = this.store.records().filter((record) => languageReminderDue(record, now));
		const reminders = [];
		for (const record of due) {
			reminders.push({
				code: record.code,
				deletedAt: record.deletedAt as string,
				itemsWithText: await this.coverage.itemsWithText(record.code),
			});
		}
		return { reminders };
	}

	async change(actorUserId: string, change: LanguageChange, requestId: string | null): Promise<LanguageSettingsResponse> {
		await this.store.refresh();
		const current = await this.languages.find(change.code);
		const shipped = shippedFrom(this.shipped()).find((row) => row.code === change.code) ?? null;
		// The to-do total is asked for only when it can decide something.
		const todo = change.kind === 'shop' && change.on ? (await this.todo(change.code)).total : 0;
		const now = new Date().toISOString();
		const decision = decideLanguageChange(current, change, { shipped, todo }, actorUserId, now);
		if (!decision.ok) {
			if (decision.reason === 'unknown_language') throw new NotFoundException(REFUSALS.unknown_language);
			throw domainRefusal(decision.reason, REFUSALS[decision.reason]);
		}
		let erasedItems = 0;
		if (decision.changed) {
			// Erase removes the text before the row says so: a failure part-way leaves it erasable again.
			if (change.kind === 'erase') erasedItems = await this.coverage.erase(change.code);
			await this.languages.save(decision.next);
			await this.audit.append(this.entry(actorUserId, change, current, decision.next, erasedItems, requestId));
			await this.store.refresh();
		}
		return this.settings();
	}

	/** English first, then the order languages were added; deleted ones last. */
	private ordered(records: readonly LanguageRecord[]): LanguageRecord[] {
		return [...records].sort(
			(a, b) =>
				Number(b.code === PRIMARY_LOCALE) - Number(a.code === PRIMARY_LOCALE) ||
				Number(!!a.deletedAt) - Number(!!b.deletedAt) ||
				(a.addedAt ?? '').localeCompare(b.addedAt ?? '') ||
				a.code.localeCompare(b.code),
		);
	}

	private async sitemapPaths(): Promise<string[]> {
		const [catalog, posts] = await Promise.all([
			this.catalog?.sitemapPaths() ?? Promise.resolve([]),
			this.blog?.sitemapPaths() ?? Promise.resolve([]),
		]);
		return [...catalog, ...posts];
	}

	private entry(
		actorUserId: string,
		change: LanguageChange,
		before: LanguageRecord | null,
		after: LanguageRecord,
		erasedItems: number,
		requestId: string | null,
	): AuditLog {
		const fields = ['admin', 'shop', 'deletedAt', 'remindedAt', 'erasedAt'] as const;
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action: ACTIONS[change.kind],
			entityType: 'language',
			entityId: change.code,
			severity: change.kind === 'erase' || change.kind === 'delete' ? 'warn' : 'info',
			retentionTier: 'catalog_admin',
			diffs: fields
				.filter((field) => before?.[field] !== after[field])
				.map((field) => ({ field, before: before?.[field] ?? null, after: after[field] })),
			// What was removed is counted, never copied: the text itself is gone.
			metadata: change.kind === 'erase' ? { erasedItems } : {},
			requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}
