import React, { useEffect, useState } from 'react';
import { useLocation } from '@docusaurus/router';

import { FirstFlightHUD } from '../FirstFlight/FirstFlightHUD';
import { PortalArrival } from '../PortalArrival';
import { AmbientReactor } from './AmbientReactor';
import { CommandPalette } from './CommandPalette';
import { ScrollBeam } from './ScrollBeam';
import { useMicroInteractions } from './useMicroInteractions';
import styles from './styles.module.css';

/* ============================================================================
 * NEXT-GEN-UI · PortalExperience (orchestrator)
 * ----------------------------------------------------------------------------
 * Mounts the four overlay features once and coordinates them. See the full map
 * in docs/frontend/portal-experience-layer.md. Grep `NEXT-GEN-UI`.
 *
 * - AmbientReactor  : the living constellation canvas behind everything.
 * - scanlines <div> : the holographic CRT veil + drifting scan sweep (Maximal).
 * - ScrollBeam      : read-progress beam under the app bar.
 * - CommandPalette  : the ⌘K warp navigator + its launcher pill.
 * - FirstFlightHUD  : URL-carried route guide + measured spotlight aperture.
 *
 * `mounted` gates the first client render so nothing renders during SSR; the
 * pathname effect re-fires `portal:rescan` so the scroll-reveal layer re-scans
 * pages reached by SPA navigation (Root mounts this once, not per page).
 * ========================================================================= */
export function PortalExperience(): React.ReactNode {
	const [mounted, setMounted] = useState(false);
	const location = useLocation();
	useMicroInteractions();

	useEffect(() => {
		setMounted(true);
	}, []);

	// Ask the reveal layer to re-scan when the SPA navigates to a new page.
	useEffect(() => {
		if (!mounted) return;
		window.dispatchEvent(new CustomEvent('portal:rescan'));
	}, [location.pathname, mounted]);

	if (!mounted) return null;

	return (
		<>
			<PortalArrival />
			<AmbientReactor />
			{/* Holographic scanline veil — drawn just above the ambient canvas,
			    below all content. Static lines + a slow drifting scan sweep. */}
			<div
				className={styles.scanlines}
				aria-hidden="true"
			/>
			{/* Uniform scrim — the ONE place the ambient field is dimmed. Fixed,
			    full-viewport, z-index:-1, above the canvas + scanlines and below
			    all content. Because it is a single viewport-fixed layer, the field
			    reads at one consistent strength everywhere (no per-surface seams).
			    Content surfaces are transparent (see custom.css). */}
			<div
				className={styles.scrim}
				aria-hidden="true"
			/>
			<ScrollBeam />
			<CommandPalette />
			<FirstFlightHUD />
		</>
	);
}
