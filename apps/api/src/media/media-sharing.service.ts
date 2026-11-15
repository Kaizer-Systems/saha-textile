import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AuditLog,
	MediaAsset,
	ShareLink,
	ShareLinkCreate,
	ShareLinkUpdate,
	ShareLinkView,
	ShareLinksResponse,
	ShareOpenAnswer,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type AuthPort,
	type MediaAssetRepository,
	SHARE_HANDOVER_SECONDS,
	type ShareLinkRepository,
	type StoragePort,
	shareCreateRefusal,
	shareExpiresAt,
	shareLinkState,
	shareOpenState,
	websitePicture,
} from '@saha-textile/core-domain';

import { AuthService } from '../auth/auth.service';
import {
	AUDIT_LOG_REPOSITORY,
	AUTH_PORT,
	MEDIA_ASSET_REPOSITORY,
	SHARE_LINK_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { fileName } from './media-library.service';
import { mediaRefusal } from './media-refusal';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 22 characters from 62 is about 131 bits: never guessed, never repeated. */
const CODE_LENGTH = 22;
const CODE_SHAPE = /^[A-Za-z0-9]{16,64}$/;

/** A random code with no bias: bytes past the last whole multiple of 62 are drawn again. */
export function newShareCode(): string {
	let code = '';
	while (code.length < CODE_LENGTH) {
		for (const byte of randomBytes(CODE_LENGTH * 2)) {
			if (byte < 248 && code.length < CODE_LENGTH) code += ALPHABET[byte % 62];
		}
	}
	return code;
}

/** Codes are kept only as this hash, so a copy of the database opens nothing. */
export const shareCodeHash = (code: string): string => createHash('sha256').update(code).digest('hex');

const REFUSALS: Readonly<Record<string, string>> = {
	public_file: 'This file is public: share its permanent address instead.',
	password_for_admins: 'A link for admins only takes no password; admins open it signed in.',
	file_in_trash: 'Files in Trash cannot be shared.',
	date_in_past: 'Choose a date in the future.',
	link_stopped: 'A stopped link stays stopped. Make a new link instead.',
};
const refuse = (code: string) => mediaRefusal(HttpStatus.UNPROCESSABLE_ENTITY, code, REFUSALS[code] ?? 'Not allowed');

/**
 * Share links on the Media page (R4-5, decision 13): our own links on the shop's domain. Opening
 * one checks it here, then hands the file over straight from Spaces for five minutes, so any
 * expiry works, links can be stopped or re-dated at any time, and opens are counted.
 */
@Injectable()
export class MediaSharingService {
	constructor(
		@Inject(SHARE_LINK_REPOSITORY) private readonly links: ShareLinkRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		@Inject(AUTH_PORT) private readonly passwords: Pick<AuthPort, 'hashPassword' | 'verifyPassword'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly limits: AuthService,
	) {}

	/** The share popup (A35): the file's links, and its permanent address when it is public. */
	async list(assetId: string, now = new Date()): Promise<ShareLinksResponse> {
		const asset = await this.requireAsset(assetId);
		const links = await this.links.listForAsset(assetId);
		const picture = asset.kind === 'image' ? websitePicture(asset) : null;
		return {
			visibility: asset.visibility,
			publicUrl: picture ? this.storage.getUrl(picture.storageKey) : this.publicUrl(asset),
			publicPicture: picture ? { role: picture.role, width: picture.width } : null,
			links: links.map((link) => this.view(link, now)),
		};
	}

	/** Makes a link. The code is in this answer only; afterwards only its last four characters are. */
	async create(actor: string, assetId: string, body: ShareLinkCreate, now = new Date()): Promise<ShareLinkView> {
		const asset = await this.requireAsset(assetId);
		const refusal = shareCreateRefusal({
			kind: asset.kind,
			visibility: asset.visibility,
			trashed: !!asset.trashedAt,
			who: body.who,
			hasPassword: !!body.password,
		});
		if (refusal) throw refuse(refusal);
		const expires = shareExpiresAt(body.expiry, now, body.expiresAt);
		if (!expires.ok) throw refuse(expires.reason);

		const code = newShareCode();
		const link: ShareLink = {
			id: `shl_${randomUUID()}`,
			assetId,
			codeHash: shareCodeHash(code),
			codeEnd: code.slice(-4),
			who: body.who,
			expiresAt: expires.expiresAt,
			passwordHash: body.password ? await this.passwords.hashPassword(body.password) : null,
			stoppedAt: null,
			stoppedBecause: null,
			opens: 0,
			lastOpenedAt: null,
			createdBy: actor,
			createdAt: now.toISOString(),
		};
		await this.links.create(link);
		await this.record(actor, 'media.share.create', assetId, {
			linkId: link.id,
			who: link.who,
			expiresAt: link.expiresAt,
			password: !!link.passwordHash,
		});
		return { ...this.view(link, now), code };
	}

	/** Stops a link for good, or gives a live link a new end (B: “its date changed”). */
	async update(actor: string, linkId: string, body: ShareLinkUpdate, now = new Date()): Promise<ShareLinkView> {
		const link = await this.links.findById(linkId);
		if (!link) throw new NotFoundException('No such link');
		let next = link;
		if (body.stop) {
			if (!link.stoppedAt) next = { ...link, stoppedAt: now.toISOString(), stoppedBecause: 'stopped' };
			await this.record(actor, 'media.share.stop', link.assetId, { linkId });
		} else if (body.expiry) {
			if (link.stoppedAt) throw refuse('link_stopped');
			const expires = shareExpiresAt(body.expiry, now, body.expiresAt);
			if (!expires.ok) throw refuse(expires.reason);
			next = { ...link, expiresAt: expires.expiresAt };
			await this.record(actor, 'media.share.expiry', link.assetId, { linkId, expiresAt: expires.expiresAt });
		}
		if (next !== link) await this.links.save(next);
		return this.view(next, now);
	}

	/**
	 * Opens a link from the shop's `/s/{code}` page. Every dead end answers `expired`, so a guessed
	 * code learns nothing; tries are limited per address, wrong passwords per link and per address.
	 */
	async open(
		code: string,
		input: { password?: string; signedInAdmin: boolean; ip: string },
		now = new Date(),
	): Promise<ShareOpenAnswer> {
		this.enforce(await this.limits.consumeRateLimit('share_open', { ip: input.ip }));
		if (!CODE_SHAPE.test(code)) return { state: 'expired' };

		const link = await this.links.findByCodeHash(shareCodeHash(code));
		const asset = link ? await this.assets.findById(link.assetId) : null;
		const fileAvailable =
			!!asset &&
			!asset.trashedAt &&
			!asset.deletedAt &&
			!!asset.originalStorageKey &&
			asset.processing.state !== 'awaiting_upload';

		let passwordOk: boolean | null = null;
		const asksPassword =
			!!link?.passwordHash && link.who === 'anyone' && fileAvailable && shareLinkState(link, now) === 'active';
		if (asksPassword && input.password !== undefined && link?.passwordHash) {
			const scopes = { identifier: link.id, ip: input.ip };
			this.enforce(await this.limits.checkRateLimit('share_password', scopes));
			passwordOk = await this.passwords.verifyPassword(input.password, link.passwordHash);
			if (!passwordOk) await this.limits.recordRateLimitFailure('share_password', scopes);
		}

		const state = shareOpenState({ link, fileAvailable, now, signedInAdmin: input.signedInAdmin, passwordOk });
		if (state === 'open' && link && asset?.originalStorageKey) {
			await this.links.countOpen(link.id, now.toISOString());
			const name = fileName(asset);
			const url = await this.storage.createSignedDownloadUrl({
				key: asset.originalStorageKey,
				expiresInSeconds: SHARE_HANDOVER_SECONDS,
				fileName: name,
			});
			return { state: 'open', url, fileName: name };
		}
		if (state === 'password') return { state: 'password', wrong: passwordOk === false };
		if (state === 'admins_only') return { state: 'admins_only' };
		return { state: 'expired' };
	}

	private view(link: ShareLink, now: Date): ShareLinkView {
		const { codeHash: _codeHash, passwordHash, ...rest } = link;
		return { ...rest, hasPassword: !!passwordHash, state: shareLinkState(link, now) };
	}

	private publicUrl(asset: MediaAsset): string | null {
		return asset.kind === 'file' && asset.visibility === 'public' && asset.originalStorageKey
			? this.storage.getUrl(asset.originalStorageKey)
			: null;
	}

	private async requireAsset(id: string): Promise<MediaAsset> {
		const asset = await this.assets.findById(id);
		if (!asset || asset.deletedAt) throw new NotFoundException('No such file');
		return asset;
	}

	private enforce(decision: { allowed: boolean }): void {
		if (!decision.allowed) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
	}

	private async record(
		actor: string,
		action: string,
		assetId: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'media',
			entityId: assetId,
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
