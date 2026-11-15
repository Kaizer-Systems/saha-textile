import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	type AdminShopEventListQuery,
	type AdminShopEventListResponse,
	type AuditLog,
	ShopEvent,
	type ShopEventCreate,
	type ShopEventProblem,
	type ShopEventPreviewLink,
	type ShopEventPublishResult,
	type ShopEventReview,
	type ShopEventWrite,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type ShopEventRepository,
	sanitizeArticleHtml,
	shopEventPublishProblems,
	shopEventSaveProblems,
} from '@saha-textile/core-domain';

import { LanguageStore } from '../languages/language-store';
import { AUDIT_LOG_REPOSITORY, SHOP_EVENT_REPOSITORY, LANGUAGE_COVERAGE_REPOSITORY } from '../infra/tokens';
import { EventCatalog } from './event-catalog';
import { EventClock } from './event-clock';
import { EventMessenger } from './event-messenger';
import type { LanguageCoverageRepository } from '@saha-textile/core-domain';
import { missingFilter } from '../languages/missing-filter';

/** How long an admin's popup preview link works. */
const PREVIEW_MINUTES = 30;

/** Trimmed text per language, empty languages dropped. */
const clean = (values: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values)
			.map(([locale, value]) => [locale, value.trim()] as const)
			.filter(([, value]) => value.length > 0),
	);

/** Problems travel as field issues, the one part of an error body the API filter passes on. */
const refusal = (problems: readonly ShopEventProblem[]): BadRequestException =>
	new BadRequestException({
		message: 'event_refused',
		issues: problems.map((problem) => ({
			path: [problem.code, problem.target],
			message: problem.detail || problem.code,
			code: problem.code,
		})),
	});

/**
 * The admin side of launch and sale events: drafts, Review, Publish, and the changes allowed
 * once an event is published. Every write is audited.
 */
@Injectable()
export class EventsAdminService {
	constructor(
		@Inject(SHOP_EVENT_REPOSITORY) private readonly events: ShopEventRepository,
		private readonly languages: LanguageStore,
		private readonly catalog: EventCatalog,
		private readonly clock: EventClock,
		private readonly messenger: EventMessenger,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional() @Inject(LANGUAGE_COVERAGE_REPOSITORY) private readonly coverage: LanguageCoverageRepository | null = null,
	) {}

	async list(query: AdminShopEventListQuery): Promise<AdminShopEventListResponse> {
		const { missing, ...filter } = query;
		return this.events.list({ ...filter, ...(await missingFilter(this.coverage, 'events', missing)) });
	}

	async detail(id: string): Promise<ShopEvent> {
		const event = await this.events.findById(id);
		if (!event) throw new NotFoundException('Event not found');
		return event;
	}

	private fields(body: ShopEventWrite) {
		return {
			name: body.name.trim(),
			title: clean(body.title),
			// The rich editor's markup, cut down to the blog's allowlist like an article.
			message: Object.fromEntries(
				Object.entries(clean(body.message))
					.map(([locale, html]) => [locale, sanitizeArticleHtml(html)] as const)
					.filter(([, html]) => html.length > 0),
			),
			startsAt: body.startsAt,
			endsAt: body.endsAt,
			linkHref: body.linkHref,
			showCountdown: body.showCountdown,
			showPopup: body.showPopup,
			popupAssetIds: body.popupAssetIds,
			popupImageSide: body.popupImageSide,
			nowLiveDays: body.nowLiveDays,
			launch: body.launch,
			sale: body.sale,
		};
	}

	async create(body: ShopEventCreate, actor: string | null): Promise<ShopEvent> {
		const problems = shopEventSaveProblems(body.type, body);
		if (problems.length) throw refusal(problems);
		const event = ShopEvent.parse({
			id: `evt_${randomUUID()}`,
			type: body.type,
			status: 'draft',
			...this.fields(body),
			...(body.type === 'launch' ? { endsAt: null } : { launch: undefined }),
		});
		const saved = await this.events.save(event);
		await this.record(actor, `event.${saved.type}.create`, saved.id, { name: saved.name });
		return saved;
	}

	/**
	 * Draft and scheduled events change freely; a scheduled one must still pass Publish's checks.
	 * A running sale may move its end, change its rules and hold products back. A launch that
	 * has started, an ended sale and a cancelled event are read-only.
	 */
	async update(id: string, body: ShopEventWrite, actor: string | null): Promise<ShopEvent> {
		const current = await this.detail(id);
		const problems = shopEventSaveProblems(current.type, body);
		if (problems.length) throw refusal(problems);
		let next: ShopEvent;
		if (current.status === 'draft' || current.status === 'scheduled') {
			next = ShopEvent.parse({
				...current,
				...this.fields(body),
				...(current.type === 'launch' ? { endsAt: null } : {}),
			});
			if (current.status === 'scheduled') {
				const blocking = (await this.publishProblems({ ...next, status: 'draft' })).filter(
					(problem) => problem.code !== 'not_draft',
				);
				if (blocking.length) throw refusal(blocking);
			}
		} else if (current.status === 'live' && current.type === 'sale') {
			if (!body.endsAt || Date.parse(body.endsAt) <= Date.now()) {
				throw refusal([{ code: 'end_before_start', target: 'endsAt', locale: null, gaps: [], detail: '' }]);
			}
			next = ShopEvent.parse({
				...current,
				endsAt: body.endsAt,
				sale: body.sale,
				showCountdown: body.showCountdown,
				showPopup: body.showPopup,
				popupAssetIds: body.popupAssetIds,
				popupImageSide: body.popupImageSide,
			});
		} else {
			throw new BadRequestException('This event can no longer be changed');
		}
		const saved = await this.events.save(next);
		await this.record(actor, `event.${saved.type}.save`, saved.id, { status: saved.status });
		if (saved.status !== 'draft') await this.clock.poke();
		return saved;
	}

	/** Drafts only. A published event is cancelled instead, so its record stays. */
	async remove(id: string, actor: string | null): Promise<void> {
		const event = await this.detail(id);
		if (event.status !== 'draft') throw new BadRequestException('Only a draft can be deleted; cancel it instead');
		await this.events.remove(id);
		await this.record(actor, `event.${event.type}.delete`, id, { name: event.name });
	}

	private async publishProblems(event: ShopEvent): Promise<ShopEventProblem[]> {
		const problems = [
			...shopEventPublishProblems(event, this.languages.shop(), new Date()),
			...(await this.catalog.unknownItems(event)),
		];
		if (event.type === 'launch') {
			for (const item of await this.catalog.launchItems(event)) {
				if (!item.held && item.gaps.length) {
					problems.push({
						code: 'not_ready',
						target: item.productId,
						locale: null,
						gaps: item.gaps,
						detail: item.title,
					});
				}
			}
		} else {
			const prices = await this.catalog.salePrices(event);
			problems.push(...(await this.catalog.overlaps(event, [...new Set(prices.map((row) => row.productId))])));
		}
		return problems;
	}

	/** The Review tab: items, final prices, problems, and how many the message reaches. */
	async review(id: string): Promise<ShopEventReview> {
		const event = await this.detail(id);
		const [items, prices, recipients] = await Promise.all([
			event.type === 'launch' ? this.catalog.launchItems(event) : Promise.resolve([]),
			event.type === 'sale' ? this.catalog.salePrices(event) : Promise.resolve([]),
			this.messenger.count(),
		]);
		const problems = event.status === 'draft' ? await this.publishProblems(event) : [];
		return { items, prices, problems, recipients };
	}

	/** Publish arms the event: the shop counts down and the message goes out. A draft never runs. */
	async publish(id: string, actor: string | null): Promise<ShopEventPublishResult> {
		const event = await this.detail(id);
		const problems = await this.publishProblems(event);
		if (problems.length) return { published: false, problems, event, recipients: 0 };
		const now = new Date().toISOString();
		const won = await this.events.transition(id, 'draft', { status: 'scheduled', publishedAt: now });
		if (!won) return { published: false, problems: [this.notDraft()], event, recipients: 0 };
		await this.clock.poke();
		// The message is sent once, on the first Publish. Unpublish and Publish again doesn't resend.
		let recipients = 0;
		if (!won.messageSentAt) {
			recipients = await this.messenger.announce(won);
			await this.events.save({ ...won, messageSentAt: new Date().toISOString() });
		}
		await this.record(actor, `event.${won.type}.publish`, id, { recipients });
		return { published: true, problems: [], event: await this.detail(id), recipients };
	}

	private notDraft(): ShopEventProblem {
		return { code: 'not_draft', target: '', locale: null, gaps: [], detail: '' };
	}

	/** Back to draft before the start: the countdown goes. The message is not sent again. */
	async unpublish(id: string, actor: string | null): Promise<ShopEvent> {
		const event = await this.detail(id);
		const won = await this.events.transition(id, 'scheduled', { status: 'draft', publishedAt: null });
		if (!won) throw new BadRequestException('Only an event that has not started can be unpublished');
		await this.clock.poke();
		await this.record(actor, `event.${event.type}.unpublish`, id, {});
		return won;
	}

	/**
	 * Cancel for good. A running sale's prices go back at once. A launch that ran keeps its
	 * items on the shop: taking them off is done per item.
	 */
	async cancel(id: string, actor: string | null): Promise<ShopEvent> {
		const event = await this.detail(id);
		if (event.status !== 'scheduled' && event.status !== 'live') {
			throw new BadRequestException('Only a published event can be cancelled');
		}
		if (event.type === 'sale') {
			await this.clock.end(event, new Date(), event.status, true);
		} else {
			await this.events.transition(id, event.status, {
				status: 'cancelled',
				cancelledAt: new Date().toISOString(),
			});
			await this.clock.poke();
		}
		await this.record(actor, `event.${event.type}.cancel`, id, { from: event.status });
		return this.detail(id);
	}

	/** Ends a running sale now: prices go back and the record is written. */
	async endNow(id: string, actor: string | null): Promise<ShopEvent> {
		const event = await this.detail(id);
		if (event.type !== 'sale' || event.status !== 'live')
			throw new BadRequestException('Only a running sale can end now');
		const now = new Date();
		const shortened = await this.events.save({ ...event, endsAt: now.toISOString() });
		await this.clock.end(shortened, now);
		await this.record(actor, 'event.sale.end-now', id, {});
		return this.detail(id);
	}

	/** A 30-minute link the shop opens the popup with, published or not. Only its hash is kept. */
	async previewLink(id: string): Promise<ShopEventPreviewLink> {
		await this.detail(id);
		const token = randomBytes(32).toString('base64url');
		const expiresAt = new Date(Date.now() + PREVIEW_MINUTES * 60_000).toISOString();
		await this.events.setPreview(id, createHash('sha256').update(token).digest('hex'), expiresAt);
		return { token, expiresAt };
	}

	categoryProducts(categoryId: string) {
		return this.catalog.categoryProducts(categoryId);
	}

	async sendTest(id: string, email: string | null): Promise<{ sent: boolean }> {
		if (!email) throw new BadRequestException('Your account has no email to send a test to');
		await this.messenger.test(await this.detail(id), email);
		return { sent: true };
	}

	private async record(actor: string | null, action: string, entityId: string, metadata: Record<string, unknown>) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'shop_event',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
