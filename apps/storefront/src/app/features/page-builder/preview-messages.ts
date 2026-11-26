/**
 * The shop's copies of the contract's preview messages (`PREVIEW_MESSAGE_SOURCE`, `PreviewShopMessage`,
 * `PreviewAdminMessage` in `@saha-textile/contracts`; the shop keeps its own types, as page-builder.types.ts does).
 * The admin's spec checks its side against the contract, and the admin e2e preview test checks the two talk.
 */
export const PREVIEW_MESSAGE_SOURCE = { shop: 'st-preview', admin: 'pb-admin' } as const;
export type PreviewShopMessage =
	{ source: 'st-preview'; type: 'ready' } | { source: 'st-preview'; type: 'select'; sectionId: string };
export interface PreviewAdminMessage {
	source: 'pb-admin';
	type: 'outline';
	sectionId: string | null;
}

/** The class the frame puts on the section the builder has chosen. */
export const CHOSEN_CLASS = 'pb-preview-chosen';

const SECTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The builder's request to outline a section, or undefined when the data is anything else (brief C41: checked by
 * shape as well as by origin; ids only). Mirrors the contract's `PreviewAdminMessage`.
 */
export function outlineRequest(data: unknown): PreviewAdminMessage | undefined {
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
	const message = data as Record<string, unknown>;
	if (Object.keys(message).sort().join() !== 'sectionId,source,type') return undefined;
	if (message['source'] !== PREVIEW_MESSAGE_SOURCE.admin || message['type'] !== 'outline') return undefined;
	const id = message['sectionId'];
	if (id !== null && (typeof id !== 'string' || !SECTION_ID.test(id))) return undefined;
	return { source: PREVIEW_MESSAGE_SOURCE.admin, type: 'outline', sectionId: id };
}

export const readyMessage = (): PreviewShopMessage => ({ source: PREVIEW_MESSAGE_SOURCE.shop, type: 'ready' });
export const selectMessage = (sectionId: string): PreviewShopMessage => ({
	source: PREVIEW_MESSAGE_SOURCE.shop,
	type: 'select',
	sectionId,
});

/**
 * Connects a preview page to the builder that frames it: a click inside a section chooses it in the builder (links and
 * forms stay put, so the frame never leaves the preview), and the builder's choice is outlined here. Only messages from
 * the parent window at the admin's origin count, and answers go to that origin only. Returns the clean-up.
 */
export function linkToBuilder(root: HTMLElement, win: Window, adminOrigin: string): () => void {
	const parent = win.parent;
	const post = (message: PreviewShopMessage) => parent.postMessage(message, adminOrigin);

	const onMessage = (event: MessageEvent) => {
		if (event.source !== parent || event.origin !== adminOrigin) return;
		const request = outlineRequest(event.data);
		if (!request) return;
		let chosen: Element | null = null;
		for (const section of Array.from(root.querySelectorAll('[data-pb-id]'))) {
			const match = section.getAttribute('data-pb-id') === request.sectionId;
			section.classList.toggle(CHOSEN_CLASS, match);
			if (match) chosen = section;
		}
		chosen?.scrollIntoView({ block: 'nearest' });
	};
	const onClick = (event: Event) => {
		const target = event.target instanceof Element ? event.target : null;
		const section = target?.closest('[data-pb-id]');
		const id = section?.getAttribute('data-pb-id');
		if (!id || !SECTION_ID.test(id)) return;
		if (target?.closest('a[href]')) event.preventDefault();
		post(selectMessage(id));
	};
	const onSubmit = (event: Event) => event.preventDefault();

	win.addEventListener('message', onMessage);
	root.addEventListener('click', onClick, true);
	root.addEventListener('submit', onSubmit, true);
	post(readyMessage());
	return () => {
		win.removeEventListener('message', onMessage);
		root.removeEventListener('click', onClick, true);
		root.removeEventListener('submit', onSubmit, true);
	};
}
