import React, { useEffect, useRef } from 'react';

import styles from './styles.module.css';

/* ============================================================================
 * NEXT-GEN-UI · ScrollBeam (read-depth progress beam)
 * ----------------------------------------------------------------------------
 * A thin luminous bar under the app bar whose horizontal scale tracks scroll
 * depth. Educational note: the scroll handler only schedules one rAF at a time
 * (the `raf` guard) and mutates `transform: scaleX()` directly — cheap, no React
 * re-render per scroll frame. See docs/frontend/portal-experience-layer.md.
 * ========================================================================= */
export function ScrollBeam(): React.ReactNode {
	const beamRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let raf = 0;
		function update() {
			raf = 0;
			const doc = document.documentElement;
			const max = doc.scrollHeight - doc.clientHeight;
			const progress = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
			if (beamRef.current) beamRef.current.style.transform = `scaleX(${progress})`;
		}
		function onScroll() {
			if (!raf) raf = window.requestAnimationFrame(update);
		}
		update();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.cancelAnimationFrame(raf);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
	}, []);

	return (
		<div
			className={styles.scrollBeamTrack}
			aria-hidden="true"
		>
			<div
				ref={beamRef}
				className={styles.scrollBeam}
			/>
		</div>
	);
}
