import type { Plugin } from 'vite';

import { CONSENT_ASK_CLASS, COOKIE_POLICY_VERSION } from './src/app/core/consent/cookie-catalogue';

/*
 * The cookie box drawn with the page (decision D1, 17 Nov 2026).
 *
 * The server draws the box in every page, hidden, so the page's HTML is the same for every visitor and can be cached.
 * This script, in the page head, runs before the first paint: when the visitor has no `st_consent` decision for the
 * current cookie policy it marks `<html>` with `st-consent-ask`, and the box's own style (shared/ui/cookie) shows the
 * box at once, with the page. A returning visitor's box never shows, not even for a moment. Once the box's code has
 * hydrated, it takes over and removes the mark.
 *
 * Before this, the box was drawn by the browser after the scripts, seconds after the page on a phone; on the
 * category page it was the largest thing on the first screen, so it set the page's Largest Contentful Paint (7.5 s
 * in Lighthouse's phone test).
 */
/** The inline script. The test for a decision is ConsentStore's own: same cookie, same policy version, an id and categories. */
export function consentAskScript(version: string): string {
	return (
		'(function(){try{var m=document.cookie.match(/(?:^|; )st_consent=([^;]*)/),' +
		'c=m&&JSON.parse(decodeURIComponent(m[1]));' +
		`if(c&&c.version===${JSON.stringify(version)}&&c.id&&c.categories)return}catch(e){}` +
		`document.documentElement.classList.add(${JSON.stringify(CONSENT_ASK_CLASS)})})();`
	);
}

/**
 * Puts the script right after the page's charset line, before any stylesheet, so it never waits for one (a script
 * after a stylesheet link waits until that stylesheet has loaded).
 */
export function withConsentAsk(html: string, version: string): string {
	const tag = `<script>${consentAskScript(version)}</script>`;
	const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(html);
	if (charset) return html.replace(charset[0], `${charset[0]}\n\t\t${tag}`);
	return html.replace(/<head>/i, `<head>\n\t\t${tag}`);
}

export function consentAskPlugin(version: string = COOKIE_POLICY_VERSION): Plugin {
	return {
		name: 'saha-textile:consent-ask',
		transformIndexHtml: { order: 'pre', handler: (html) => withConsentAsk(html, version) },
	};
}
