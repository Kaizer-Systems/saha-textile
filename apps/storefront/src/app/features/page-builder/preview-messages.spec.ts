import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHOSEN_CLASS, linkToBuilder, outlineRequest } from './preview-messages';

const ADMIN = 'https://admin.shop.test';

describe('preview messages (Page Builder step 6, C41)', () => {
	it('accepts only the builder’s outline request, with a section id or null', () => {
		expect(outlineRequest({ source: 'pb-admin', type: 'outline', sectionId: 'product_row_2' })).toEqual({
			source: 'pb-admin',
			type: 'outline',
			sectionId: 'product_row_2',
		});
		expect(outlineRequest({ source: 'pb-admin', type: 'outline', sectionId: null })?.sectionId).toBeNull();
		for (const data of [
			null,
			'outline',
			[],
			{ source: 'st-preview', type: 'outline', sectionId: 'a' },
			{ source: 'pb-admin', type: 'select', sectionId: 'a' },
			{ source: 'pb-admin', type: 'outline' },
			{ source: 'pb-admin', type: 'outline', sectionId: 'a', html: '<b>' },
			{ source: 'pb-admin', type: 'outline', sectionId: '"]<script>' },
			{ source: 'pb-admin', type: 'outline', sectionId: 'x'.repeat(41) },
			{ source: 'pb-admin', type: 'outline', sectionId: 7 },
		]) {
			expect(outlineRequest(data)).toBeUndefined();
		}
	});

	describe('linkToBuilder', () => {
		let unlink: (() => void) | null = null;
		afterEach(() => {
			unlink?.();
			unlink = null;
			document.body.innerHTML = '';
		});

		function frame() {
			const root = document.createElement('div');
			root.innerHTML = `
				<section data-pb-id="banner_arrangement"><a href="/en/collections/sarees" id="link">Sarees</a></section>
				<section data-pb-id="newsletter"><form id="form"><button id="send">Send</button></form></section>`;
			document.body.append(root);
			const parent = { postMessage: vi.fn() };
			const listeners: ((event: MessageEvent) => void)[] = [];
			const win = {
				parent,
				addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
				removeEventListener: vi.fn(),
			} as unknown as Window;
			unlink = linkToBuilder(root, win, ADMIN);
			const send = (data: unknown, origin = ADMIN, source: unknown = parent) =>
				listeners.forEach((fn) => fn({ data, origin, source } as unknown as MessageEvent));
			return { root, parent, send, win };
		}

		it('says it is ready, to the admin’s origin only', () => {
			const { parent } = frame();
			expect(parent.postMessage).toHaveBeenCalledWith({ source: 'st-preview', type: 'ready' }, ADMIN);
		});

		it('turns a click into a choice and keeps the frame on the preview', () => {
			const { root, parent } = frame();
			const link = root.querySelector<HTMLAnchorElement>('#link');
			const click = new MouseEvent('click', { bubbles: true, cancelable: true });
			link?.dispatchEvent(click);
			expect(click.defaultPrevented).toBe(true);
			expect(parent.postMessage).toHaveBeenLastCalledWith(
				{ source: 'st-preview', type: 'select', sectionId: 'banner_arrangement' },
				ADMIN,
			);
			const submit = new Event('submit', { bubbles: true, cancelable: true });
			root.querySelector('#form')?.dispatchEvent(submit);
			expect(submit.defaultPrevented).toBe(true);
		});

		it('outlines the section the builder chose, and ignores other windows and origins', () => {
			const scroll = vi.fn();
			Element.prototype.scrollIntoView = scroll;
			const { root, send } = frame();
			const banner = root.querySelector('[data-pb-id="banner_arrangement"]');
			const newsletter = root.querySelector('[data-pb-id="newsletter"]');
			send({ source: 'pb-admin', type: 'outline', sectionId: 'newsletter' });
			expect(newsletter?.classList.contains(CHOSEN_CLASS)).toBe(true);
			expect(banner?.classList.contains(CHOSEN_CLASS)).toBe(false);
			expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });

			send({ source: 'pb-admin', type: 'outline', sectionId: 'banner_arrangement' }, 'https://evil.test');
			send({ source: 'pb-admin', type: 'outline', sectionId: 'banner_arrangement' }, ADMIN, {});
			expect(banner?.classList.contains(CHOSEN_CLASS)).toBe(false);

			send({ source: 'pb-admin', type: 'outline', sectionId: null });
			expect(newsletter?.classList.contains(CHOSEN_CLASS)).toBe(false);
		});
	});
});
