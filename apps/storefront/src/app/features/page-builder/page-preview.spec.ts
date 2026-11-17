import { describe, expect, it } from 'vitest';

import { PREVIEW_COOKIE, cookieValue } from './page-preview';

describe('the builder preview page (Page Builder step 6)', () => {
	it('reads its session from the request cookie header, and nothing else', () => {
		expect(cookieValue(`st_locale=bn; ${PREVIEW_COOKIE}=abc%3D123; st_theme=dark`, PREVIEW_COOKIE)).toBe('abc=123');
		expect(cookieValue('st_locale=bn', PREVIEW_COOKIE)).toBeNull();
		expect(cookieValue(undefined, PREVIEW_COOKIE)).toBeNull();
		expect(cookieValue(`x${PREVIEW_COOKIE}=nope`, PREVIEW_COOKIE)).toBeNull();
	});
});
