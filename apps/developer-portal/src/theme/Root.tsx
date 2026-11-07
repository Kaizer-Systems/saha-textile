/* ============================================================================
 * NEXT-GEN-UI · Theme Root (mount point for the whole interaction layer)
 * ----------------------------------------------------------------------------
 * Part of the developer portal "futuristic interaction layer". These files are
 * kept as a deliberately readable reference — see the convention and full map
 * in docs/frontend/portal-experience-layer.md. Grep `NEXT-GEN-UI` to find every
 * piece of this pass.
 *
 * WHAT: Docusaurus renders the swizzled `@theme/Root` around the entire app on
 *       every route, so it is the one place to mount global chrome exactly once.
 * WHY BrowserOnly: the interaction layer is pure overlay (canvas, palette, beam)
 *       with no SEO/content value. Rendering it browser-only sidesteps any
 *       server/client hydration mismatch — the server HTML simply omits it.
 * ========================================================================= */

import React, { type ReactNode } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import { PortalExperience } from '@site/src/components/PortalExperience';

export default function Root({ children }: { children: ReactNode }): ReactNode {
	return (
		<>
			{children}
			<BrowserOnly>{() => <PortalExperience />}</BrowserOnly>
		</>
	);
}
