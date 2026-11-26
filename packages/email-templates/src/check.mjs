/**
 * MSG91's Handlebars subset and our email rules (orders and checkout brief, approved 2026-11-20).
 * `checkTemplate` refuses what MSG91 can't run (helpers other than if, unless and each; partials;
 * odd variables) and what our rules forbid (scripts, forms, iframes, background images, relative or
 * WebP images). `renderSample` is a small renderer for previews and tests, not for sending: MSG91
 * renders the registered template itself.
 */
const HELPERS = new Set(['if', 'unless', 'each']);
export function checkTemplate(name, src) {
	const errs = [];
	const stack = [];
	for (const m of src.matchAll(/\{\{\{?\s*([#/^>!]?)\s*([^}\s]*)[^}]*\}?\}\}/g)) {
		const [, sigil, word] = m;
		if (sigil === '#') {
			if (!HELPERS.has(word)) errs.push(`helper “${word}” is not available on MSG91`);
			stack.push(word);
		} else if (sigil === '/') {
			const open = stack.pop();
			if (open !== word) errs.push(`{{/${word}}} closes {{#${open}}}`);
		} else if (sigil === '>' || sigil === '^') errs.push(`“${sigil}” (partials, inverse) is not supported`);
		else if (word && word !== 'else' && !/^(@root\.)?[a-z_][a-z0-9_]*$/.test(word))
			errs.push(`odd variable “${word}”`);
	}
	if (stack.length) errs.push(`unclosed {{#${stack.join(', ')}}}`);
	if (/<script|<form|<iframe|javascript:/i.test(src)) errs.push('script, form or iframe found');
	if (/background-image|url\(/i.test(src)) errs.push('background image found');
	if (/src="(?!https?:|\[\[|\{\{)/.test(src)) errs.push('an image without an absolute address');
	if (/\.webp/i.test(src)) errs.push('WebP image (use PNG or JPG)');
	return errs.map((e) => `${name}: ${e}`);
}
export function renderSample(src, data) {
	const tokens = src.split(/(\{\{\{?[^}]*\}?\}\})/g);
	let i = 0;
	const esc = (v) =>
		String(v ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	const get = (ctx, root, path) => (path.startsWith('@root.') ? root[path.slice(6)] : (ctx[path] ?? undefined));
	function block(ctx, root) {
		let out = '';
		let other = '';
		let inElse = false;
		while (i < tokens.length) {
			const t = tokens[i++];
			const m = t.match(/^\{\{(\{?)\s*([#/]?)\s*([^\s}]+)?\s*([^}]*)\}?\}\}$/);
			if (!m) {
				if (inElse) other += t;
				else out += t;
				continue;
			}
			const [, raw, sigil, word, arg] = m;
			if (sigil === '/') return { out, other };
			if (word === 'else' && !sigil) {
				inElse = true;
				continue;
			}
			let piece = '';
			if (sigil === '#') {
				const start = i;
				const val = get(ctx, root, arg.trim());
				if (word === 'each') {
					const list = Array.isArray(val) ? val : [];
					if (!list.length) block(ctx, root);
					for (const [n, it] of list.entries()) {
						i = start;
						piece += block(it, root).out;
						if (n === list.length - 1) break;
					}
				} else {
					const truthy = Array.isArray(val) ? val.length > 0 : Boolean(val);
					const r = block(ctx, root);
					piece = (word === 'if' ? truthy : !truthy) ? r.out : r.other;
				}
			} else {
				const v = get(ctx, root, word);
				piece = raw ? String(v ?? '') : esc(v);
			}
			if (inElse) other += piece;
			else out += piece;
		}
		return { out, other };
	}
	i = 0;
	return block(data, data).out;
}

/** Fills the per-environment marks (`[[shop_origin]]`, `[[admin_origin]]`, `[[legal_name]]`, `[[shop_address]]`). */
export const fillTokens = (source, values) =>
	source.replace(/\[\[([a-z_]+)\]\]/g, (_, key) => values[key] ?? `[[${key}]]`);
