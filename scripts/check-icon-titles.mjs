#!/usr/bin/env node
/**
 * Every icon-only action in the admin names itself on hover (owner rule 2026-11-10,
 * `DEC-ICON-TITLES`). Staff should never have to guess that a pencil means Edit or a bin means
 * Delete, so a clickable thing that shows no words must carry a `title`, translated like any
 * other label: `[title]="'edit' | transloco"`. The browser shows it on hover; no tooltip library.
 *
 *   pnpm check:icon-titles
 *
 * Reads every admin template with Angular's own parser, so `@if`, `@for` and `*ngIf` blocks are
 * understood. An action is a `<button>`, an `<a>`, or anything with a `(click)` or `routerLink`.
 * It is icon-only when nothing inside it prints text: no words, no `{{ }}`, no component that
 * could print them. Fields are left out: they carry a label or placeholder. A template that builds its words some other way can mark the element with
 * the attribute `data-icon-title-ok` and a comment saying why.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps/admin/src');
const require = createRequire(join(ROOT, 'apps/admin/package.json'));
const compiler = await import(require.resolve('@angular/compiler'));
const { parseTemplate, TmplAstElement, TmplAstText, TmplAstBoundText, TmplAstContent } = compiler;

const ICON_TAGS = new Set(['i', 'svg', 'img', 'app-feather-icons']);
/** Fields name themselves with a label or placeholder; a click on one is not an icon action. */
const FIELDS = new Set(['input', 'select', 'select2', 'textarea', 'ng-select']);
const CHILD_KEYS = ['children', 'branches', 'cases', 'empty', 'placeholder', 'loading', 'error'];

function templates(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return templates(path);
		return entry.name.endsWith('.html') ? [path] : [];
	});
}

/** Every child node, through elements, `<ng-template>` and control-flow blocks alike. */
function childrenOf(node) {
	return CHILD_KEYS.flatMap((key) => {
		const value = node[key];
		if (!value) return [];
		return Array.isArray(value) ? value : [value];
	});
}

const named = (node, name) =>
	(node.attributes ?? []).some((attr) => attr.name === name) ||
	(node.inputs ?? []).some((input) => input.name === name);

const isElement = (node) => node instanceof TmplAstElement;

function isAction(node) {
	if (!isElement(node) || FIELDS.has(node.name)) return false;
	if (node.name === 'button') return true;
	// An `<a>` with nowhere to go and nothing to do is a placeholder, such as a loading skeleton.
	if (node.name === 'a' && named(node, 'href')) return true;
	return (node.outputs ?? []).some((output) => output.name === 'click') || named(node, 'routerLink');
}

/** Words the person can read inside an element, or a component that may print them. */
function printsText(node) {
	for (const child of childrenOf(node)) {
		// Projected content is the caller's words, checked where the caller writes them.
		if (child instanceof TmplAstBoundText || child instanceof TmplAstContent) return true;
		if (child instanceof TmplAstText && child.value.replace(/&nbsp;/g, '').trim()) return true;
		if (isElement(child) && child.name.includes('-') && !ICON_TAGS.has(child.name)) return true;
		if (isElement(child) && (named(child, 'innerHTML') || named(child, 'innerText'))) return true;
		if (!(isElement(child) && ICON_TAGS.has(child.name)) && printsText(child)) return true;
	}
	return false;
}

const findings = [];
for (const file of templates(APP)) {
	const source = readFileSync(file, 'utf8');
	const { nodes, errors } = parseTemplate(source, file, { preserveWhitespaces: false });
	if (errors?.length) {
		findings.push(`${relative(ROOT, file)}: cannot be read (${errors[0].msg})`);
		continue;
	}
	const visit = (node) => {
		if (isAction(node) && !named(node, 'title') && !named(node, 'data-icon-title-ok') && !printsText(node)) {
			const line = node.sourceSpan.start.line + 1;
			const snippet = source.slice(node.sourceSpan.start.offset, node.sourceSpan.end.offset).replace(/\s+/g, ' ');
			findings.push(`${relative(ROOT, file)}:${line}  ${snippet.slice(0, 110)}`);
		}
		for (const child of childrenOf(node)) visit(child);
	};
	for (const node of nodes) visit(node);
}

if (findings.length) {
	console.error(`Icon-only actions without a hover name (${findings.length}):`);
	for (const finding of findings) console.error(`  ${finding}`);
	console.error(`\nGive each one a translated title, for example [title]="'edit' | transloco".`);
	process.exit(1);
}
console.log('Every icon-only admin action names itself on hover.');
