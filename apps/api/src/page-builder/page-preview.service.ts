import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	PREVIEW_CODE_SECONDS,
	PREVIEW_SESSION_SECONDS,
	type PreviewCodeResponse,
	type PreviewExchangeResponse,
	type StorefrontPageLayout,
} from '@saha-textile/contracts';
import type { PageLayoutRepository, PreviewTokenRepository } from '@saha-textile/core-domain';

import { PAGE_LAYOUT_REPOSITORY, PREVIEW_TOKEN_REPOSITORY } from '../infra/tokens';
import { PageBuilderService } from './page-builder.service';

/** Only hashes are stored: a leaked database row never opens a preview. */
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * Preview (Page Builder step 6, FX-5). The builder asks for a one-time code that works for a minute; the shop's
 * server swaps it for a session kept in a cookie limited to /__preview, which lasts an hour; the draft is then drawn
 * by the shop's own code. No pass ever travels in an address that history, logs or the Referer header keep.
 */
@Injectable()
export class PagePreviewService {
	constructor(
		@Inject(PREVIEW_TOKEN_REPOSITORY) private readonly tokens: PreviewTokenRepository,
		@Inject(PAGE_LAYOUT_REPOSITORY) private readonly layouts: PageLayoutRepository,
		private readonly builder: PageBuilderService,
	) {}

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
