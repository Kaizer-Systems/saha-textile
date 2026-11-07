// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';

import { storefrontAddress } from '@core/i18n/legacy-address';
import { notFoundRouteMeta } from '@core/i18n/locale-seo';
import { Error404 } from '@features/page/error404/error404';
import { Gone } from '@features/page/gone/gone';

// A mistyped new-site path answers 404. An old catalogue path answers the gone
// page, including after the locale prefix is applied to the address.
export const routeMeta = notFoundRouteMeta;

@Component({
	selector: 'app-unknown-address',
	imports: [Error404, Gone],
	template: `
		@if (retired) {
			<app-gone />
		} @else {
			<app-error404 />
		}
	`,
})
class UnknownAddress {
	readonly retired = storefrontAddress(currentPath(), undefined)?.status === 410;
}

function currentPath(): string {
	const doc = inject(DOCUMENT);
	const view = doc.defaultView;
	if (view) return `${view.location.pathname}${view.location.search}`;
	return doc.location?.pathname ?? '';
}

export default UnknownAddress;
