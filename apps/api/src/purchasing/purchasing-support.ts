import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	type AuditLog,
	type InventorySettings,
	type MediaAsset,
	type PermissionCode,
	type PurchaseStep,
	ShopDetails,
	homeGstStateOf,
} from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type InventorySettingsRepository,
	type MediaAssetRepository,
	type RoleRepository,
	type ShopDetailsRepository,
	StaleVersionError,
	type StoragePort,
	type TransactionContext,
	type TransactionManagerPort,
	istDay,
	resolveImage,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	INVENTORY_SETTINGS_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	ROLE_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
	STORAGE_PORT,
	TRANSACTION_MANAGER,
} from '../infra/tokens';

/** The permission each purchase-entry step needs; a step role must hold it too. */
export const STEP_PERMISSION: Readonly<Record<PurchaseStep, PermissionCode>> = {
	draft: 'purchase.create',
	check: 'purchase.check',
	post: 'purchase.post',
	payment: 'purchase.payment',
};

const STEP_WORDS: Readonly<Record<PurchaseStep, string>> = {
	draft: 'make or change a draft',
	check: 'check goods',
	post: 'post to stock',
	payment: 'record a payment',
};

/**
 * A refusal the admin can show next to the thing it is about. `code` is translated on the
 * screen; `detail` is the English sentence (also what tests and the audit trail read).
 */
export function refuse(code: string, detail: string, target: string | null = null): BadRequestException {
	return new BadRequestException({
		message: code,
		issues: [{ path: target ? [code, target] : [code], message: detail, code }],
	});
}

/** Several refusals at once (a goods check with three lines wrong). */
export function refuseAll(problems: ReadonlyArray<{ code: string; detail: string; lineId?: string | null }>) {
	return new BadRequestException({
		message: problems[0]?.code ?? 'refused',
		issues: problems.map((problem) => ({
			path: problem.lineId ? [problem.code, problem.lineId] : [problem.code],
			message: problem.detail,
			code: problem.code,
		})),
	});
}

export const missing = (what: string) => new NotFoundException(`${what} not found`);

/** Whether the person may see cost, stock value and margin (P8). The API leaves them out otherwise. */
export const canSeeCost = (principal: AuthenticatedPrincipal | undefined): boolean =>
	Boolean(principal?.permissions.includes('stock.cost'));

export const holds = (principal: AuthenticatedPrincipal | undefined, code: string): boolean =>
	Boolean(principal?.permissions.includes(code));

export const actorOf = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;

/** "4:02 pm on 17 Nov" in India time, for "changed by Rina at …". */
export function shortWhen(at: string): string {
	const date = new Date(at);
	if (Number.isNaN(date.getTime())) return '';
	const time = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
	const day = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
	return `${time.toLowerCase()} on ${day}`;
}

export interface AuditInput {
	actor: string | null;
	/** Dot-namespaced, e.g. `purchase.entry.post`. */
	action: string;
	entityType: string;
	entityId: string;
	/** The sentence the Activity tab shows and the CA reads (brief: permissions and audit). */
	text: string;
	/** Anything a screen links to or filters by (numbers, ids, counts). */
	facts?: Record<string, unknown>;
}

/**
 * What every purchases-and-stock service shares: India's date, the settings, people's names,
 * thumbnails, audit sentences and the transaction wrapper.
 */
@Injectable()
export class PurchasingSupport {
	private readonly nameCache = new Map<string, { name: string; at: number }>();

	constructor(
		@Inject(INVENTORY_SETTINGS_REPOSITORY) private readonly settingsRepository: InventorySettingsRepository,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: AdminUserRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly media: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: AdminUserRoleAssignmentRepository,
		@Optional()
		@Inject(SHOP_DETAILS_REPOSITORY)
		private readonly shop: ShopDetailsRepository | null = null,
	) {}

	/**
	 * P1: when the super admin narrows a step to one role, only holders of that role (and the
	 * super admin) may do it. A role deleted after it was chosen closes the step until the super
	 * admin picks another: failing open would hand the step back to everyone silently.
	 */
	async stepRoleProblem(actor: string | null, step: PurchaseStep): Promise<{ code: string; detail: string } | null> {
		const settings = await this.settings();
		const roleId = settings.stepRules[`${step}RoleId`];
		if (!roleId) return null;
		if (actor) {
			const user = await this.admins.findById(actor).catch(() => null);
			if (user?.role === 'admin') return null;
			const held = await this.assignments.listActiveForUser(actor);
			if (held.some((assignment) => assignment.roleId === roleId)) return null;
		}
		const role = await this.roles.findById(roleId);
		return {
			code: 'step_role',
			detail: role
				? `Only people with the role ${role.label} may ${STEP_WORDS[step]} (Settings › Purchases and stock).`
				: `The role chosen to ${STEP_WORDS[step]} no longer exists. The super admin must choose again in Settings › Purchases and stock.`,
		};
	}

	/** Role names for the step rules, for the settings page. */
	async roleLabels(ids: ReadonlyArray<string | null>): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		for (const id of new Set(ids.filter((value): value is string => Boolean(value)))) {
			const role = await this.roles.findById(id);
			if (role) out[id] = role.label;
		}
		return out;
	}

	findRole(id: string) {
		return this.roles.findById(id);
	}

	/** Today in India, `YYYY-MM-DD`: bill dates, due dates and the financial year all use it. */
	today(): string {
		return istDay(new Date());
	}

	settings(): Promise<InventorySettings> {
		return this.settingsRepository.get();
	}

	/**
	 * Settings › Shop details (R3-1). Until they are first saved, the name, GSTIN and address
	 * kept in the purchases settings during the build (never on a screen) still print.
	 */
	async shopDetails(): Promise<ShopDetails> {
		const saved = await this.shop?.get();
		if (saved) return saved;
		const business = (await this.settings()).business;
		return ShopDetails.parse({
			legalName: business.legalName,
			gstin: business.gstin,
			address: business.addressLines.filter(Boolean).join('\n'),
		});
	}

	/** The State purchase tax is worked out from: the shop GSTIN's, or West Bengal (19) until one is saved. */
	async homeState(): Promise<string> {
		return homeGstStateOf(await this.shopDetails());
	}

	inTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
		return this.transactions.withTransaction(work);
	}

	/** The names people know each other by; unknown ids read "Someone". */
	async names(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
		const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
		const out = new Map<string, string>();
		const now = Date.now();
		await Promise.all(
			wanted.map(async (id) => {
				const cached = this.nameCache.get(id);
				if (cached && now - cached.at < 5 * 60_000) {
					out.set(id, cached.name);
					return;
				}
				const user = await this.admins.findById(id).catch(() => null);
				const name = user?.displayName?.trim() || user?.username || user?.email?.split('@')[0] || 'Someone';
				this.nameCache.set(id, { name, at: now });
				out.set(id, name);
			}),
		);
		return out;
	}

	async nameOf(id: string | null): Promise<string> {
		if (!id) return 'Someone';
		return (await this.names([id])).get(id) ?? 'Someone';
	}

	/** Card-size thumbnails by photo id, for item columns. */
	async thumbnails(assetIds: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
		const wanted = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
		if (wanted.length === 0) return new Map();
		const assets = await this.media.findManyByIds(wanted);
		return new Map(
			assets.flatMap((asset) => {
				const url = this.thumbnail(asset);
				return url ? [[asset.id, url] as const] : [];
			}),
		);
	}

	private thumbnail(asset: MediaAsset): string | null {
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles: ['card'],
		});
		return resolved?.roles['card']?.[0]?.url ?? null;
	}

	/** A file's name and link (bill copies, payment proof). */
	async attachment(assetId: string | null): Promise<{ assetId: string; name: string; url: string | null } | null> {
		if (!assetId) return null;
		const [asset] = await this.media.findManyByIds([assetId]);
		if (!asset) return null;
		return {
			assetId,
			name: asset.displayName ?? `${asset.slug}`,
			url: asset.originalStorageKey ? this.storage.getUrl(asset.originalStorageKey) : this.thumbnail(asset),
		};
	}

	/**
	 * One audit row, in the retention tier the books need (purchases and stock are financial
	 * records). Written inside the caller's transaction when it has one, so a rolled-back post
	 * leaves no sentence claiming it happened.
	 */
	async record(input: AuditInput, context?: TransactionContext): Promise<void> {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: input.actor,
			targetUserId: null,
			audience: 'admin',
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: { text: input.text, ...(input.facts ?? {}) },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.auditLog.append(entry, context);
	}

	/** A document's Activity tab: its audit sentences, oldest first, with who wrote them. */
	async activity(entityType: string, entityIds: readonly string[]) {
		const rows = (
			await Promise.all(
				entityIds.map((entityId) => this.auditLog.list({ entityType, entityId, page: 1, pageSize: 200 })),
			)
		).flatMap((page) => page.items);
		rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const names = await this.names(rows.map((row) => row.actorUserId));
		return rows.map((row) => ({
			id: row.id,
			at: row.createdAt,
			actorName: row.actorUserId ? (names.get(row.actorUserId) ?? 'Someone') : 'System',
			action: row.action,
			text: typeof row.metadata['text'] === 'string' ? row.metadata['text'] : row.action,
		}));
	}

	/** A save refused because someone else saved first: "changed by Rina at 4:02 pm, reload to see it". */
	async staleConflict(error: StaleVersionError): Promise<ConflictException> {
		const name = await this.nameOf(error.current.updatedBy);
		const when = shortWhen(error.current.updatedAt);
		return new ConflictException({
			message: 'stale_version',
			issues: [
				{
					path: ['stale_version'],
					message: `Changed by ${name}${when ? ` at ${when}` : ''}. Reload to see it.`,
					code: 'stale_version',
				},
			],
		});
	}

	/** Runs a versioned save and turns a stale version into the conflict the form shows. */
	async guardStale<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof StaleVersionError) throw await this.staleConflict(error);
			throw error;
		}
	}
}
