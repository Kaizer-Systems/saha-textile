import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHOSEN_CLASS, linkToBuilder } from './preview-messages';

const ADMIN = 'https://admin.shop.test';

describe('linkToBuilder: what it leaves alone', () => {
	let unlink: (() => void) | null = null;
	afterEach(() => {
		unlink?.();
		unlink = null;
		document.body.innerHTML = '';
	});

	const frame = () => {
		const root = document.createElement('div');
		root.innerHTML = `
			<section data-pb-id="newsletter"><p id="words">Join us</p></section>
			<section data-pb-id="not a valid id!"><p id="odd">Odd</p></section>
			<p id="outside">Outside</p>`;
		document.body.append(root);
		const parent = { postMessage: vi.fn() };
		const listeners: ((event: MessageEvent) => void)[] = [];
		const win = {
			parent,
			addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
			removeEventListener: vi.fn(),
		} as unknown as Window;
		unlink = linkToBuilder(root, win, ADMIN);
		parent.postMessage.mockClear();
		const send = (data: unknown) =>
			listeners.forEach((fn) => fn({ data, origin: ADMIN, source: parent } as unknown as MessageEvent));
		const click = (target: EventTarget) => {
			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			target.dispatchEvent(event);
			return event;
		};
		return { root, parent, send, click };
	};

	it('ignores anything from the builder that is not an outline request', () => {
		const { root, send } = frame();
		send({ source: 'pb-admin', type: 'outline', sectionId: 'newsletter', extra: true });
		expect(root.querySelector(`.${CHOSEN_CLASS}`)).toBeNull();
	});

	it('chooses a section from a click on plain text, without stopping the click', () => {
		const { root, parent, click } = frame();
		const event = click(root.querySelector('#words') as Element);
		expect(event.defaultPrevented).toBe(false);
		expect(parent.postMessage).toHaveBeenCalledWith(
			{ source: 'st-preview', type: 'select', sectionId: 'newsletter' },
			ADMIN,
		);
	});

	it('sends nothing for a click outside the sections, on a section with a bad id, or on a text node', () => {
		const { root, parent, click } = frame();
		click(root.querySelector('#outside') as Element);
		click(root.querySelector('#odd') as Element);
		click(root.querySelector('#words')?.firstChild as Node);
		expect(parent.postMessage).not.toHaveBeenCalled();
	});
});
