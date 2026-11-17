import type { PreviewAdminMessage, PreviewShopMessage } from '@saha-textile/contracts';

/** Who sent a preview message (the contract's PREVIEW_MESSAGE_SOURCE; preview-messages.spec.ts keeps them equal). */
export const PREVIEW_MESSAGE_SOURCE = { shop: 'st-preview', admin: 'pb-admin' } as const;

const SECTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * A message from the preview frame, or undefined for anything else (brief C41: the sender's window and origin are
 * checked by the caller, the shape here; ids only). Mirrors the contract's `PreviewShopMessage`.
 */
export function shopMessage(data: unknown): PreviewShopMessage | undefined {
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
	const message = data as Record<string, unknown>;
	if (message['source'] !== PREVIEW_MESSAGE_SOURCE.shop) return undefined;
	const keys = Object.keys(message).sort().join();
	if (message['type'] === 'ready' && keys === 'source,type')
		return { source: PREVIEW_MESSAGE_SOURCE.shop, type: 'ready' };
	const id = message['sectionId'];
	if (
		message['type'] === 'select' &&
		keys === 'sectionId,source,type' &&
		typeof id === 'string' &&
		SECTION_ID.test(id)
	) {
		return { source: PREVIEW_MESSAGE_SOURCE.shop, type: 'select', sectionId: id };
	}
	return undefined;
}

/** The builder asks the frame to outline a section (null clears it). */
export const outlineMessage = (sectionId: string | null): PreviewAdminMessage => ({
	source: PREVIEW_MESSAGE_SOURCE.admin,
	type: 'outline',
	sectionId: sectionId !== null && SECTION_ID.test(sectionId) ? sectionId : null,
});
