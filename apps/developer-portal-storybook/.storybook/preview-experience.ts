/**
 * NEXT-GEN-UI · Storybook preview experience
 * ----------------------------------------------------------------------------
 * WHAT: a lightweight canvas constellation and cursor-follow coordinates for
 * every Angular preview.
 * WHY: shared tokens establish identity, but movement/depth must be implemented
 * in each tool adapter because Docusaurus's React overlay cannot run here.
 * HOW: one guarded canvas per preview iframe, with reduced-motion support.
 */

type StarNode = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
};

const EXPERIENCE_KEY = 'portalStorybookExperience';

function installPointerGlow() {
	document.addEventListener(
		'pointermove',
		(event) => {
			document.documentElement.style.setProperty('--portal-pointer-x', `${event.clientX}px`);
			document.documentElement.style.setProperty('--portal-pointer-y', `${event.clientY}px`);

			const spotlightTarget = (event.target as HTMLElement | null)?.closest<HTMLElement>(
				'.storybookSpotlight, button, a, [role="button"]',
			);
			if (spotlightTarget) {
				const bounds = spotlightTarget.getBoundingClientRect();
				spotlightTarget.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
				spotlightTarget.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
			}
		},
		{ passive: true },
	);
}

function installConstellation() {
	const canvas = document.createElement('canvas');
	canvas.className = 'storybookConstellation';
	canvas.setAttribute('aria-hidden', 'true');
	document.body.prepend(canvas);
	const renderingContext = canvas.getContext('2d');
	if (!renderingContext) {
		return;
	}
	const context: CanvasRenderingContext2D = renderingContext;

	const nodes: StarNode[] = Array.from({ length: 42 }, (_, index) => ({
		x: ((index * 83) % 997) / 997,
		y: ((index * 137 + 41) % 991) / 991,
		vx: (((index * 17) % 11) - 5) * 0.000006,
		vy: (((index * 29) % 13) - 6) * 0.000005,
		radius: 0.75 + (index % 4) * 0.28,
	}));

	let width = 0;
	let height = 0;
	let frame = 0;
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	function resize() {
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.max(1, Math.floor(width * ratio));
		canvas.height = Math.max(1, Math.floor(height * ratio));
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		draw();
	}

	function draw() {
		context.clearRect(0, 0, width, height);
		const dark = document.documentElement.dataset.portalTheme !== 'light';
		const line = dark ? '99, 179, 255' : '0, 90, 160';
		const dot = dark ? '120, 190, 255' : '0, 110, 190';

		for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
			const first = nodes[firstIndex];
			for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
				const second = nodes[secondIndex];
				const dx = (first.x - second.x) * width;
				const dy = (first.y - second.y) * height;
				const distance = Math.hypot(dx, dy);
				if (distance < 128) {
					context.beginPath();
					context.moveTo(first.x * width, first.y * height);
					context.lineTo(second.x * width, second.y * height);
					context.strokeStyle = `rgba(${line}, ${(1 - distance / 128) * 0.17})`;
					context.lineWidth = 0.7;
					context.stroke();
				}
			}
		}

		for (const node of nodes) {
			context.beginPath();
			context.arc(node.x * width, node.y * height, node.radius, 0, Math.PI * 2);
			context.fillStyle = `rgba(${dot}, 0.5)`;
			context.fill();
		}
	}

	function animate() {
		for (const node of nodes) {
			node.x = (node.x + node.vx + 1) % 1;
			node.y = (node.y + node.vy + 1) % 1;
		}
		draw();
		frame = window.requestAnimationFrame(animate);
	}

	function updateMotion() {
		window.cancelAnimationFrame(frame);
		if (reduceMotion.matches) {
			draw();
		} else {
			frame = window.requestAnimationFrame(animate);
		}
	}

	window.addEventListener('resize', resize, { passive: true });
	reduceMotion.addEventListener('change', updateMotion);
	resize();
	updateMotion();
}

export function installPreviewExperience() {
	if (typeof window === 'undefined' || document.documentElement.dataset[EXPERIENCE_KEY] === 'true') {
		return;
	}
	document.documentElement.dataset[EXPERIENCE_KEY] = 'true';
	installPointerGlow();
	installConstellation();
}
