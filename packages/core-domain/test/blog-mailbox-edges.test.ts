import { describe, expect, it } from 'vitest';

import { sanitizeArticleHtml } from '../src/blog/sanitize-html';
import { deletableForever, labelChange } from '../src/mailbox/mailbox-rules';

describe('article HTML cleaning: the remaining cases', () => {
	it('reads single-quoted, unquoted and valueless attributes', () => {
		expect(sanitizeArticleHtml(`<a title='Hi' href=/about>x</a>`)).toBe('<a title="Hi" href="/about">x</a>');
		expect(sanitizeArticleHtml('<table><tr><td colspan>1</td></tr></table>')).toBe(
			'<table><tr><td>1</td></tr></table>',
		);
	});

	it('drops sizes that are not numbers, ids that are not slugs, and unsafe addresses', () => {
		expect(sanitizeArticleHtml('<img src="/a.jpg" width="big">')).toBe('<img src="/a.jpg">');
		expect(sanitizeArticleHtml('<h2 id="Bad Id">T</h2>')).toBe('<h2>T</h2>');
		expect(sanitizeArticleHtml('<img src="//evil.example/x.png">')).toBe('');
		expect(sanitizeArticleHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<a>x</a>');
	});

	it('escapes a bare “greater than” in text', () => {
		expect(sanitizeArticleHtml('a > b')).toBe('a &gt; b');
	});

	it('drops an unclosed comment, a doctype and an unclosed processing line', () => {
		expect(sanitizeArticleHtml('<p>x</p><!-- open')).toBe('<p>x</p>');
		expect(sanitizeArticleHtml('<!DOCTYPE html><p>x</p>')).toBe('<p>x</p>');
		expect(sanitizeArticleHtml('<p>x</p><?xml version="1.0"')).toBe('<p>x</p>');
	});

	it('keeps dropping a script’s content past a stray “<”, and ignores self-closed or lone closing scripts', () => {
		expect(sanitizeArticleHtml('<script>if (a < b) {}</script><p>ok</p>')).toBe('<p>ok</p>');
		expect(sanitizeArticleHtml('<script/><p>x</p>')).toBe('<p>x</p>');
		expect(sanitizeArticleHtml('</script><p>y</p>')).toBe('<p>y</p>');
	});

	it('writes no closing tag for a void element', () => {
		expect(sanitizeArticleHtml('<p>a<br></br>b</p>')).toBe('<p>a<br>b</p>');
	});
});

describe('mailbox rules: the remaining cases', () => {
	it('stars, marks important and labels, each changing only its own label', () => {
		expect(labelChange('star')).toEqual({ add: ['STARRED'], remove: [] });
		expect(labelChange('unstar')).toEqual({ add: [], remove: ['STARRED'] });
		expect(labelChange('important')).toEqual({ add: ['IMPORTANT'], remove: [] });
		expect(labelChange('not_important')).toEqual({ add: [], remove: ['IMPORTANT'] });
		expect(labelChange('add_label', 'Label_1')).toEqual({ add: ['Label_1'], remove: [] });
		expect(labelChange('add_label')).toEqual({ add: [], remove: [] });
		expect(labelChange('remove_label', 'Label_1')).toEqual({ add: [], remove: ['Label_1'] });
		expect(labelChange('remove_label')).toEqual({ add: [], remove: [] });
	});

	it('deletes for good only what is in the Bin, the whole conversation when all of it is', () => {
		expect(deletableForever([])).toEqual({ whole: false, messageIds: [] });
		expect(
			deletableForever([
				{ id: 'm1', labelIds: ['TRASH'] },
				{ id: 'm2', labelIds: ['INBOX'] },
			]),
		).toEqual({ whole: false, messageIds: ['m1'] });
		expect(deletableForever([{ id: 'm1', labelIds: ['TRASH'] }])).toEqual({ whole: true, messageIds: ['m1'] });
	});
});
