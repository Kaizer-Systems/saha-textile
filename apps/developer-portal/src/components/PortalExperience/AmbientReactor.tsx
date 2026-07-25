import React, { useEffect, useRef } from 'react';

import styles from './styles.module.css';

type Node = { x: number; y: number; vx: number; vy: number };

/* ============================================================================
 * NEXT-GEN-UI · AmbientReactor (living constellation canvas)
 * ----------------------------------------------------------------------------
 * A fixed, behind-content <canvas> that draws a slow "data constellation":
 * drifting nodes linked by faint proximity lines, with a soft radial glow that
 * leans toward the cursor. Pure Canvas 2D — no libraries. Educational notes:
 *
 * - LAYERING: the canvas is z-index:-1 (see styles.ambientCanvas), so it paints
 *   above the body background but below all content. Content surfaces are made
 *   slightly translucent in custom.css so the field reads through.
 * - PERF: node count scales with viewport area (capped); links are O(n²) but n
 *   is small; devicePixelRatio is capped at 2. rAF loop, not setInterval.
 * - MOTION/LIFECYCLE: honours prefers-reduced-motion (one static frame, no
 *   loop), pauses on tab hide (visibilitychange), and re-reads colours when the
 *   theme toggles (MutationObserver on <html data-theme>). All listeners are
 *   removed on unmount.
 * - The non-null `canvas`/`context` locals below exist so TypeScript keeps the
 *   null-narrowing inside the nested animation closures.
 * ========================================================================= */
export function AmbientReactor(): React.ReactNode {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvasEl = canvasRef.current;
		if (!canvasEl) return;
		const context2d = canvasEl.getContext('2d');
		if (!context2d) return;
		// Bind non-null locals so control-flow narrowing survives into the
		// nested animation closures below.
		const canvas: HTMLCanvasElement = canvasEl;
		const context: CanvasRenderingContext2D = context2d;

		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		let width = 0;
		let height = 0;
		let dpr = 1;
		let nodes: Node[] = [];
		let raf = 0;
		const pointer = { x: -9999, y: -9999, active: false };

		function readTheme(): { line: string; dot: string; glow: string } {
			const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
			return isDark
				? { line: '99, 179, 255', dot: '120, 190, 255', glow: '62, 166, 255' }
				: { line: '0, 90, 160', dot: '0, 110, 190', glow: '0, 130, 208' };
		}
		let theme = readTheme();

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			width = window.innerWidth;
			height = window.innerHeight;
			canvas.width = Math.floor(width * dpr);
			canvas.height = Math.floor(height * dpr);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			context.setTransform(dpr, 0, 0, dpr, 0, 0);

			const target = Math.round(Math.min(120, Math.max(34, (width * height) / 18000)));
			nodes = Array.from({ length: target }, () => ({
				x: Math.random() * width,
				y: Math.random() * height,
				vx: (Math.random() - 0.5) * 0.16,
				vy: (Math.random() - 0.5) * 0.16,
			}));
		}

		function step() {
			context.clearRect(0, 0, width, height);
			const linkDistance = Math.min(190, Math.max(120, width / 9));

			for (const node of nodes) {
				node.x += node.vx;
				node.y += node.vy;
				if (node.x < 0 || node.x > width) node.vx *= -1;
				if (node.y < 0 || node.y > height) node.vy *= -1;

				// Gentle cursor gravity.
				if (pointer.active) {
					const dx = pointer.x - node.x;
					const dy = pointer.y - node.y;
					const dist2 = dx * dx + dy * dy;
					if (dist2 < 26000) {
						node.vx += dx * 0.000018;
						node.vy += dy * 0.000018;
					}
				}
				node.vx = Math.max(-0.4, Math.min(0.4, node.vx));
				node.vy = Math.max(-0.4, Math.min(0.4, node.vy));
			}

			for (let i = 0; i < nodes.length; i += 1) {
				const a = nodes[i];
				for (let j = i + 1; j < nodes.length; j += 1) {
					const b = nodes[j];
					const dx = a.x - b.x;
					const dy = a.y - b.y;
					const dist = Math.hypot(dx, dy);
					if (dist < linkDistance) {
						const alpha = (1 - dist / linkDistance) * 0.28;
						context.strokeStyle = `rgba(${theme.line}, ${alpha})`;
						context.lineWidth = 1;
						context.beginPath();
						context.moveTo(a.x, a.y);
						context.lineTo(b.x, b.y);
						context.stroke();
					}
				}
			}

			for (const node of nodes) {
				context.fillStyle = `rgba(${theme.dot}, 0.85)`;
				context.beginPath();
				context.arc(node.x, node.y, 1.55, 0, Math.PI * 2);
				context.fill();
			}

			if (pointer.active) {
				const gradient = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 280);
				gradient.addColorStop(0, `rgba(${theme.glow}, 0.2)`);
				gradient.addColorStop(1, `rgba(${theme.glow}, 0)`);
				context.fillStyle = gradient;
				context.fillRect(pointer.x - 280, pointer.y - 280, 560, 560);
			}

			raf = window.requestAnimationFrame(step);
		}

		function drawStaticFrame() {
			// Reduced-motion: one calm frame, no animation loop.
			context.clearRect(0, 0, width, height);
			for (const node of nodes) {
				context.fillStyle = `rgba(${theme.dot}, 0.55)`;
				context.beginPath();
				context.arc(node.x, node.y, 1.4, 0, Math.PI * 2);
				context.fill();
			}
		}

		function start() {
			window.cancelAnimationFrame(raf);
			if (reduceMotion) drawStaticFrame();
			else raf = window.requestAnimationFrame(step);
		}

		function onPointerMove(event: PointerEvent) {
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			pointer.active = true;
		}
		function onPointerLeave() {
			pointer.active = false;
			pointer.x = -9999;
			pointer.y = -9999;
		}
		function onVisibility() {
			if (document.hidden) window.cancelAnimationFrame(raf);
			else start();
		}

		const themeObserver = new MutationObserver(() => {
			theme = readTheme();
		});

		resize();
		start();
		window.addEventListener('resize', resize);
		window.addEventListener('pointermove', onPointerMove, { passive: true });
		window.addEventListener('pointerleave', onPointerLeave);
		document.addEventListener('visibilitychange', onVisibility);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		return () => {
			window.cancelAnimationFrame(raf);
			window.removeEventListener('resize', resize);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerleave', onPointerLeave);
			document.removeEventListener('visibilitychange', onVisibility);
			themeObserver.disconnect();
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className={styles.ambientCanvas}
			aria-hidden="true"
		/>
	);
}
