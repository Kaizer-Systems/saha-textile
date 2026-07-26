/**
 * NEXT-GEN-UI · Generated child navigation
 * Forces a document request so Docusaurus cannot resolve its fallback bridge
 * client-side when a generated child is mounted at the same route.
 */

import React, { type MouseEvent } from 'react';

type ChildToolNavbarItemProps = {
	label: string;
	href: string;
	mobile?: boolean;
};

export default function ChildToolNavbarItem({ label, href, mobile = false }: ChildToolNavbarItemProps) {
	function navigate(event: MouseEvent<HTMLAnchorElement>) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		window.location.assign(`${href.replace(/\/+$/u, '')}/index.html`);
	}

	return (
		<a
			className={mobile ? 'menu__link' : 'dropdown__link'}
			href={href}
			onClick={navigate}
		>
			{label}
		</a>
	);
}
