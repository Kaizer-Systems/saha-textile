import { useEffect } from 'react';

/* ============================================================================
 * NEXT-GEN-UI · useMicroInteractions (the "everything feels alive" layer)
 * ----------------------------------------------------------------------------
 * Global, dependency-free micro-interactions driven by two delegated pointer
 * listeners and one IntersectionObserver (see docs/frontend/portal-experience-
 * layer.md, grep `NEXT-GEN-UI`):
 *  - cursor spotlight: writes --spot-x/--spot-y onto the hovered card; the glow
 *    itself is a CSS ::before radial-gradient in custom.css that reads them;
 *  - magnetic pull: nudges primary buttons toward the cursor via transform;
 *  - scroll reveal: adds `reveal-init` then `is-revealed` as sections enter view;
 *  - rail affordance: toggles data-more-below on the fixed sidebar rail so CSS
 *    can show a "more menu below" mist + chevron only while items remain hidden.
 * IMPORTANT: the hidden state (`reveal-init`) is applied by JS ONLY — so with no
 * JavaScript, pages stay fully visible. All motion is disabled under
 * prefers-reduced-motion, and a `portal:rescan` event re-scans after SPA nav.
 * ========================================================================= */

const SPOTLIGHT_SELECTOR =
	'.portalCard, .portalPathCard, .portalImplementationItem, .portalSurfaceNotice, .portalHero__panel';
const MAGNETIC_SELECTOR = '.portalButton--primary';
const REVEAL_SELECTOR = '.portalDashboardSection, .portalSurfaceGrid, .portalProvenancePanel, .portalCardGrid';
/* The full-height command rail (see the NEXT-GEN-UI rail block in custom.css).
   NOTE: `theme-doc-sidebar-menu` is the <ul>; the SCROLL CONTAINER is the
   wrapping `nav.menu` — target that (stable Infima class). */
const RAIL_SELECTOR = '.theme-doc-sidebar-container nav.menu';

/* Stateless by design: queries the DOM each call, so it stays correct across
   SPA navigations even if Docusaurus swaps the sidebar element. */
function updateRailAffordance(): void {
	const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR);
	if (!rail) return;
	const moreBelow = rail.scrollTop + rail.clientHeight < rail.scrollHeight - 12;
	rail.dataset.moreBelow = moreBelow ? 'true' : 'false';
}

function bindRailAffordance(): void {
	const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR);
	if (!rail) return;
	if (rail.dataset.railBound !== 'true') {
		rail.dataset.railBound = 'true';
		rail.addEventListener('scroll', updateRailAffordance, { passive: true });
	}
	updateRailAffordance();
}

export function useMicroInteractions(): void {
	useEffect(() => {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		function onPointerMove(event: PointerEvent) {
			const target = event.target as HTMLElement | null;
			const card = target?.closest<HTMLElement>(SPOTLIGHT_SELECTOR);
			if (card) {
				const rect = card.getBoundingClientRect();
				card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
				card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
			}

			if (reduceMotion) return;
			const magnet = target?.closest<HTMLElement>(MAGNETIC_SELECTOR);
			if (magnet) {
				const rect = magnet.getBoundingClientRect();
				const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
				const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
				magnet.style.transform = `translate(${dx * 6}px, ${dy * 6}px)`;
			}
		}

		function onPointerOut(event: PointerEvent) {
			const target = event.target as HTMLElement | null;
			const magnet = target?.closest<HTMLElement>(MAGNETIC_SELECTOR);
			if (magnet) magnet.style.transform = '';
		}

		document.addEventListener('pointermove', onPointerMove, { passive: true });
		document.addEventListener('pointerout', onPointerOut, { passive: true });

		let observer: IntersectionObserver | null = null;

		function scan() {
			const targets = document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
			targets.forEach((element) => {
				if (element.dataset.revealBound === 'true') return;
				element.dataset.revealBound = 'true';
				if (reduceMotion || !observer) {
					element.classList.add('is-revealed');
					return;
				}
				element.classList.add('reveal-init');
				observer.observe(element);
			});
		}

		if (!reduceMotion && 'IntersectionObserver' in window) {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) {
							entry.target.classList.add('is-revealed');
							observer?.unobserve(entry.target);
						}
					}
				},
				{ rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
			);
		}

		function onRescan() {
			// New page nodes arrive after client navigation; give React a tick.
			window.setTimeout(() => {
				scan();
				bindRailAffordance();
			}, 60);
		}

		scan();
		bindRailAffordance();
		window.addEventListener('portal:rescan', onRescan);
		// Viewport changes alter how much of the rail is hidden below the fold.
		window.addEventListener('resize', updateRailAffordance);

		return () => {
			document.removeEventListener('pointermove', onPointerMove);
			document.removeEventListener('pointerout', onPointerOut);
			window.removeEventListener('portal:rescan', onRescan);
			window.removeEventListener('resize', updateRailAffordance);
			observer?.disconnect();
		};
	}, []);
}
