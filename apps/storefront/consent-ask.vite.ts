import {
	CONSENT_ASK_CLASS,
	CONSENT_BUTTONS,
	CONSENT_TAP_ATTRIBUTE,
	COOKIE_POLICY_VERSION,
} from './src/app/core/consent/cookie-catalogue';

import type { Plugin } from 'vite';

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
 *
 * A tap before the box wakes: Angular queues it and replays it once the box is awake, except when the box had already
 * started waking on its idle trigger, which carries no replay (Angular 22's incremental hydration returns early and
 * the queued tap is never replayed; seen on a busy machine, 21 Nov). So the script also notes, while the page is still
 * asking, which of the box's buttons was tapped first, and the box carries that tap out once awake if no replay did
 * (shared/ui/cookie). It never stops the tap reaching Angular.
 */
/** The inline script. The test for a decision is ConsentStore's own: same cookie, same policy version, an id and categories. */
export function consentAskScript(version: string): string {
	return (
		'(function(){try{var m=document.cookie.match(/(?:^|; )st_consent=([^;]*)/),' +
		'c=m&&JSON.parse(decodeURIComponent(m[1]));' +
		`if(c&&c.version===${JSON.stringify(version)}&&c.id&&c.categories)return}catch(e){}` +
		`var h=document.documentElement,k=${JSON.stringify(CONSENT_ASK_CLASS)},a=${JSON.stringify(CONSENT_TAP_ATTRIBUTE)};` +
		'h.classList.add(k);' +
		"document.addEventListener('click',function(e){" +
		`var b=e.target&&e.target.closest&&e.target.closest(${JSON.stringify(CONSENT_BUTTONS.map((id) => `#${id}`).join(','))});` +
		'if(b&&h.classList.contains(k)&&!h.hasAttribute(a))h.setAttribute(a,b.id)},true)})();'
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
