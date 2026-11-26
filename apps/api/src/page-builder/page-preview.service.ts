import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	PREVIEW_CODE_SECONDS,
	PREVIEW_SESSION_SECONDS,
	type PreviewCodeResponse,
	type PreviewExchangeResponse,
	type StorefrontPageLayout,
} from '@saha-textile/contracts';
import type { PageLayoutRepository, PreviewTokenRepository, ProductRepository } from '@saha-textile/core-domain';

import { PAGE_LAYOUT_REPOSITORY, PREVIEW_TOKEN_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';
import { PageBuilderService } from './page-builder.service';

/** Only hashes are stored: a leaked database row never opens a preview. */
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * Preview (Page Builder step 6, FX-5). The builder asks for a one-time code that works for a minute; the shop's
 * server swaps it for a session kept in a cookie limited to /__preview, which lasts an hour; the draft is then drawn
 * by the shop's own code. No pass ever travels in an address that history, logs or the Referer header keep.
 */
/**
 * Bundle builder preview codes (bundle builder brief, 2026-11-22), held in memory for their one minute: Page Builder
 * codes live on their layout's record, and a bundle has none. A restart only means the builder asks for a new code.
 */
const bundleCodes = new Map<string, { productId: string; expiresAt: number }>();

@Injectable()
export class PagePreviewService {
	constructor(
		@Inject(PREVIEW_TOKEN_REPOSITORY) private readonly tokens: PreviewTokenRepository,
		@Inject(PAGE_LAYOUT_REPOSITORY) private readonly layouts: PageLayoutRepository,
		private readonly builder: PageBuilderService,
		@Optional() @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository | null = null,
	) {}

	/**
	 * The bundle builder's live preview (bundle builder brief, approved 2026-11-22): the same private, framed address,
	 * `/{locale}/__preview/bundle`, whose set block is drawn from what the builder sends it. The session names the
	 * bundle (`bundle:<productId>`) so it opens nothing else.
	 */
	async bundleCode(actor: string | null, productId: string, now = new Date()): Promise<PreviewCodeResponse> {
		const product = await this.products?.findById(productId, 'admin');
		if (!product || product.type !== 'bundle') throw new NotFoundException('No such bundle');
		const code = newToken();
		const expiresAt = new Date(now.getTime() + PREVIEW_CODE_SECONDS * 1000).toISOString();
		this.sweep(now);
		bundleCodes.set(tokenHash(code), { productId: product.id, expiresAt: Date.parse(expiresAt) });
		return { code, expiresAt };
	}

	/** Drops expired bundle preview codes, so the map never grows. */
	private sweep(now: Date): void {
		for (const [hash, entry] of bundleCodes) if (entry.expiresAt <= now.getTime()) bundleCodes.delete(hash);
	}

	async code(
		actor: string | null,
		layoutId: string,
		revisionId: string | null = null,
		now = new Date(),
	): Promise<PreviewCodeResponse> {
		if (!(await this.layouts.layout(layoutId))) throw new NotFoundException('No such layout');
		// History's Look (E3): only a revision of this layout.
		if (revisionId && (await this.layouts.revision(revisionId))?.layoutId !== layoutId) {
			throw new NotFoundException('No such revision');
		}
		const code = newToken();
		const expiresAt = new Date(now.getTime() + PREVIEW_CODE_SECONDS * 1000).toISOString();
		await this.tokens.createCode({ codeHash: tokenHash(code), layoutId, revisionId, by: actor, expiresAt });
		return { code, expiresAt };
	}

	/** The shop's server swaps a code for a session; a used, expired or unknown code is a plain 404. */
	async exchange(code: string, now = new Date()): Promise<PreviewExchangeResponse> {
		// A bundle preview code (bundle builder): used once, within its minute. The shop's frame needs no draft from
		// the server (the builder posts it), so the session token only unlocks the private address.
		const bundle = bundleCodes.get(tokenHash(code));
		if (bundle) {
			bundleCodes.delete(tokenHash(code));
			if (bundle.expiresAt <= now.getTime()) throw new NotFoundException('No such preview');
			const expiresAt = new Date(now.getTime() + PREVIEW_SESSION_SECONDS * 1000).toISOString();
			return { token: newToken(), pageType: 'bundle', expiresAt };
		}
		const used = await this.tokens.useCode(tokenHash(code), now.toISOString());
		const layout = used ? await this.layouts.layout(used.layoutId) : null;
		if (!layout) throw new NotFoundException('No such preview');
		const token = newToken();
		const expiresAt = new Date(now.getTime() + PREVIEW_SESSION_SECONDS * 1000).toISOString();
		await this.tokens.createSession({
			tokenHash: tokenHash(token),
			layoutId: layout.id,
			revisionId: used?.revisionId ?? null,
			expiresAt,
		});
		return { token, pageType: layout.pageType, expiresAt };
	}

	/** The layout's draft (or last live revision) as the shop would draw it now, in one language. */
	async layout(token: string, locale: string, now = new Date()): Promise<StorefrontPageLayout> {
		const session = await this.tokens.findSession(tokenHash(token), now.toISOString());
		const layout = session ? await this.layouts.layout(session.layoutId) : null;
		if (!layout) throw new NotFoundException('No such preview');
		const revision = await this.layouts.revision(
			session?.revisionId ?? layout.draftRevisionId ?? layout.lastLiveRevisionId ?? '',
		);
		const shop = await this.builder.shopLayout(layout.pageType, locale, now);
		return this.builder.drawn(layout.pageType, revision, [], locale, now, shop.settings ?? null);
	}
}
