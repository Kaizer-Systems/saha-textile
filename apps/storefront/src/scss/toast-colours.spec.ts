import { resolve } from 'node:path';

import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

/**
 * The theme paints toasts white and ngx-toastr writes white text, which showed as a blank box.
 * This reads the compiled theme, because that is what a shopper's browser gets.
 */
describe('the compiled toast styles', () => {
	const root = resolve(__dirname, '../..');
	const css = compile(resolve(__dirname, 'app.scss'), {
		loadPaths: [resolve(root, 'node_modules')],
		quietDeps: true,
		logger: { warn: () => undefined, debug: () => undefined },
	}).css;

	const white = /^(#fff(fff)?|white|rgb\(255, ?255, ?255\))$/i;
	const declaration = (selector: string, property: string) => {
		const block = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
		return block.match(new RegExp(`(?:^|\\s)${property}: ([^;]+);`))?.[1]?.trim();
	};

	it('keeps the card white', () => {
		expect(declaration('.ngx-toastr', 'background-color')).toMatch(white);
	});

	it.each(['success', 'error', 'warning', 'info'])('gives %s toast text a colour of its own', (kind) => {
		const colour = declaration(`.toast-${kind} .toast-message`, 'color');

		expect(colour).toBeDefined();
		expect(colour).not.toMatch(white);
	});
});
