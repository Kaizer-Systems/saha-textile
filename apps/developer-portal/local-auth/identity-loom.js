/* ============================================================================
 * NEXT-GEN-UI · Identity Loom computational textile engine
 * ----------------------------------------------------------------------------
 * WHAT: persistent fibre weaving, operation-specific input responses, the
 *       five-phase launch ceremony and locally synthesized interface audio.
 * SECURITY: canvas/decorative state receives field identity, operation and
 *           length only. Credential characters stay inside the native inputs
 *           and the same-origin authentication request.
 * PERFORMANCE: DPR and scene density are capped; hidden tabs stop rendering.
 * ========================================================================== */

(() => {
	'use strict';

	const form = document.querySelector('#identity-loom-form');
	const usernameInput = document.querySelector('#developer-portal-username');
	const passwordInput = document.querySelector('#developer-portal-password');
	const submitButton = form?.querySelector('button[type="submit"]');
	const errorRegion = document.querySelector('#identity-loom-error');
	const errorOutput = errorRegion?.querySelector('output');
	const soundButton = document.querySelector('#identity-loom-sound');
	const launchSequence = document.querySelector('#identity-loom-launch');
	const launchIndex = launchSequence?.querySelector('[data-launch-index]');
	const launchTitle = launchSequence?.querySelector('[data-launch-title]');
	const launchDetail = launchSequence?.querySelector('[data-launch-detail]');
	const launchDestination = launchSequence?.querySelector('[data-launch-destination]');
	const compilerState = launchSequence?.querySelector('[data-launch-compiler-state]');
	const canvas = document.querySelector('#identity-loom-field');
	const context = canvas?.getContext('2d');
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const mutedStorageKey = 'saha_textile_developer_portal_sound_muted';
	const arrivalStorageKey = 'saha_textile_developer_portal_arrival';
	const fullLaunchDuration = 5_000;
	const reducedLaunchDuration = 180;
	const maximumWovenThreads = 120;

	if (!form || !usernameInput || !passwordInput || !submitButton || !canvas || !context) {
		return;
	}

	const phaseDefinitions = [
		{
			phase: 'lock',
			index: '01 / 05',
			title: 'Credential lock',
			detail: 'Converting the authentication instrument into computational fibre',
			compiler: 'Awaiting warp tension',
			startsAt: 0,
		},
		{
			phase: 'tension',
			index: '02 / 05',
			title: 'Warp tension',
			detail: 'Pulling every accumulated identity thread across the full viewport',
			compiler: 'Warp synchronized',
			startsAt: 800,
		},
		{
			phase: 'compile',
			index: '03 / 05',
			title: 'Jacquard compile',
			detail: 'Resolving the woven identity through the computational punch-card matrix',
			compiler: 'Pattern resolving',
			startsAt: 2_000,
		},
		{
			phase: 'reactor',
			index: '04 / 05',
			title: 'Architecture fold',
			detail: 'Folding the textile into the Saha Textile portal reactor',
			compiler: 'Reactor geometry stable',
			startsAt: 3_200,
		},
		{
			phase: 'breach',
			index: '05 / 05',
			title: 'Portal breach',
			detail: 'Opening the authenticated route through the reactor core',
			compiler: 'Route aperture open',
			startsAt: 4_400,
		},
	];

	const fieldState = new Map([
		[
			'username',
			{
				input: usernameInput,
				length: usernameInput.value.length,
				inputType: '',
				composing: false,
			},
		],
		[
			'password',
			{
				input: passwordInput,
				length: passwordInput.value.length,
				inputType: '',
				composing: false,
			},
		],
	]);

	const wovenThreads = [];
	const shuttles = [];
	const sparks = [];
	const punchBursts = [];
	const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };

	let width = 0;
	let height = 0;
	let deviceScale = 1;
	let frame = 0;
	let lastTimestamp = 0;
	let nextThreadId = 1;
	let denialStartedAt = 0;
	let launchStartedAt = 0;
	let activeLaunchPhase = '';
	let audioContext;
	let masterBus;
	let compressor;
	let audioBuses;
	let soundMuted = window.localStorage.getItem(mutedStorageKey) === 'true';

	function clamp(value, minimum = 0, maximum = 1) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function lerp(start, end, amount) {
		return start + (end - start) * amount;
	}

	function easeInOutCubic(value) {
		const bounded = clamp(value);
		return bounded < 0.5 ? 4 * bounded * bounded * bounded : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
	}

	function hashUnit(value) {
		const hashed = Math.sin(value * 91.3458 + 12.781) * 43_758.5453;
		return hashed - Math.floor(hashed);
	}

	function resizeCanvas() {
		deviceScale = Math.min(window.devicePixelRatio || 1, 1.75);
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.floor(width * deviceScale);
		canvas.height = Math.floor(height * deviceScale);
		context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
	}

	function fieldAnchor(field) {
		const input = fieldState.get(field)?.input;
		const bounds = input?.getBoundingClientRect();
		return {
			x: bounds ? bounds.left + bounds.width * 0.58 : width / 2,
			y: bounds ? bounds.top + bounds.height / 2 : height / 2,
		};
	}

	function threadGeometry(thread) {
		const anchor = fieldAnchor(thread.field);
		const laneRatio = 0.055 + thread.laneSeed * 0.89;
		const startY = height * laneRatio;
		const endY = height * (0.96 - laneRatio * 0.88);
		const anchorOffset = (hashUnit(thread.id * 3.71) - 0.5) * 26;
		const mid = { x: anchor.x, y: anchor.y + anchorOffset };
		return {
			start: { x: -60, y: startY },
			controlStart: {
				x: width * 0.2,
				y: lerp(startY, mid.y, 0.2) + (thread.laneSeed - 0.5) * 72,
			},
			mid,
			controlEnd: {
				x: width * 0.8,
				y: lerp(mid.y, endY, 0.78) - (thread.laneSeed - 0.5) * 72,
			},
			end: { x: width + 60, y: endY },
		};
	}

	function quadraticPoint(start, control, end, progress) {
		const inverse = 1 - progress;
		return {
			x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
			y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
		};
	}

	function pointOnThread(thread, progress) {
		const geometry = threadGeometry(thread);
		if (progress <= 0.5) {
			return quadraticPoint(geometry.start, geometry.controlStart, geometry.mid, progress * 2);
		}
		return quadraticPoint(geometry.mid, geometry.controlEnd, geometry.end, (progress - 0.5) * 2);
	}

	function traceThread(thread) {
		const geometry = threadGeometry(thread);
		context.beginPath();
		context.moveTo(geometry.start.x, geometry.start.y);
		context.quadraticCurveTo(geometry.controlStart.x, geometry.controlStart.y, geometry.mid.x, geometry.mid.y);
		context.quadraticCurveTo(geometry.controlEnd.x, geometry.controlEnd.y, geometry.end.x, geometry.end.y);
	}

	function emitSparks(x, y, color, amount) {
		for (let index = 0; index < Math.min(34, amount); index += 1) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 24 + Math.random() * 120;
			sparks.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 1,
				color,
			});
		}
	}

	function emitShuttle(thread, operation, delay = 0) {
		shuttles.push({
			thread,
			operation,
			progress: operation === 'delete' ? 1 : 0,
			delay,
		});
	}

	function addWovenThreads(field, amount, operation = 'insert', silent = false) {
		const count = Math.min(Math.max(1, amount), 48);
		for (let index = 0; index < count; index += 1) {
			const thread = {
				id: nextThreadId,
				field,
				laneSeed: hashUnit(nextThreadId * 1.913 + (field === 'password' ? 19 : 3)),
				bornAt: performance.now() + index * (operation === 'burst' ? 24 : 0),
				retractStartedAt: 0,
			};
			nextThreadId += 1;
			wovenThreads.push(thread);
			if (!silent) emitShuttle(thread, operation, index * (operation === 'burst' ? 0.026 : 0));
		}
		while (wovenThreads.length > maximumWovenThreads) wovenThreads.shift();

		if (operation === 'burst' && !silent) {
			punchBursts.push({ field, amount: count, startedAt: performance.now() });
		}
	}

	function retractWovenThreads(field, amount) {
		let remaining = Math.min(Math.max(1, amount), 48);
		for (let index = wovenThreads.length - 1; index >= 0 && remaining > 0; index -= 1) {
			const thread = wovenThreads[index];
			if (thread.field !== field || thread.retractStartedAt > 0) continue;
			thread.retractStartedAt = performance.now();
			emitShuttle(thread, 'delete', (amount - remaining) * 0.022);
			remaining -= 1;
		}
	}

	function drawWarpField(timestamp) {
		const time = timestamp * 0.00024;
		const centerX = width / 2;
		const centerY = height / 2;
		const laneCount = Math.min(132, Math.max(82, Math.round(height / 9)));
		const denialProgress = denialStartedAt ? clamp((timestamp - denialStartedAt) / 680) : 0;
		const launchElapsed = launchStartedAt ? timestamp - launchStartedAt : 0;
		const tension = launchStartedAt ? easeInOutCubic(clamp((launchElapsed - 800) / 1_200)) : 0;
		const fold = launchStartedAt ? easeInOutCubic(clamp((launchElapsed - 3_200) / 1_200)) : 0;

		const canvasWash = context.createRadialGradient(
			centerX,
			centerY,
			0,
			centerX,
			centerY,
			Math.max(width, height) * 0.72,
		);
		canvasWash.addColorStop(0, launchStartedAt ? 'rgba(16, 51, 78, 0.22)' : 'rgba(13, 37, 58, 0.14)');
		canvasWash.addColorStop(0.55, 'rgba(4, 12, 20, 0.03)');
		canvasWash.addColorStop(1, 'rgba(2, 5, 9, 0)');
		context.fillStyle = canvasWash;
		context.fillRect(0, 0, width, height);

		for (let index = 0; index < laneCount; index += 1) {
			const ratio = laneCount === 1 ? 0 : index / (laneCount - 1);
			const originalY = height * (0.035 + ratio * 0.93);
			const phase = index * 0.23;
			const waveStrength = lerp(16 + Math.abs(ratio - 0.5) * 58, 3, tension);
			const wave = Math.sin(time * 5 + phase) * waveStrength;
			const misalignment =
				denialProgress > 0
					? Math.sin(index * 2.4 + denialProgress * 18) * 42 * Math.sin(denialProgress * Math.PI)
					: 0;
			const foldedY = centerY + (ratio - 0.5) * height * 0.12;
			const y = lerp(originalY, foldedY, fold) + misalignment;
			const pointerShift = pointer.active
				? ((pointer.y - centerY) / Math.max(height, 1)) * (ratio - 0.5) * 22
				: 0;
			const opacity =
				(index % 7 === 0 ? 0.24 : 0.075 + (1 - Math.abs(ratio - 0.5) * 2) * 0.08) * (1 + tension * 1.25);
			const isSignalLane = index % 11 === 0;

			context.beginPath();
			context.moveTo(-30, y + pointerShift);
			context.bezierCurveTo(
				width * 0.23,
				y + wave,
				centerX - 180,
				centerY + wave * 0.3 + misalignment * 0.2,
				centerX,
				lerp(centerY, y, fold * 0.18),
			);
			context.bezierCurveTo(
				centerX + 180,
				centerY - wave * 0.3 - misalignment * 0.2,
				width * 0.77,
				y - wave,
				width + 30,
				y - pointerShift,
			);
			context.strokeStyle =
				denialProgress > 0
					? `rgba(255, 156, 50, ${opacity * 0.86})`
					: isSignalLane
						? `rgba(34, 185, 130, ${opacity * 0.9})`
						: `rgba(62, 166, 255, ${opacity})`;
			context.lineWidth = isSignalLane ? 1.1 : index % 7 === 0 ? 1 : 0.55;
			if (isSignalLane) {
				context.shadowColor = denialProgress > 0 ? 'rgba(255, 156, 50, 0.5)' : 'rgba(62, 166, 255, 0.42)';
				context.shadowBlur = 7;
			}
			context.stroke();
			context.shadowBlur = 0;
		}

		if (pointer.active && !launchStartedAt) {
			const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 300);
			glow.addColorStop(0, 'rgba(62, 166, 255, 0.16)');
			glow.addColorStop(1, 'rgba(62, 166, 255, 0)');
			context.fillStyle = glow;
			context.fillRect(pointer.x - 300, pointer.y - 300, 600, 600);
		}
	}

	function drawWovenThreads(timestamp) {
		const launchElapsed = launchStartedAt ? timestamp - launchStartedAt : 0;
		const fold = launchStartedAt ? easeInOutCubic(clamp((launchElapsed - 3_200) / 1_200)) : 0;
		context.save();
		if (fold > 0) {
			context.translate(width / 2, height / 2);
			context.rotate(fold * 0.32);
			context.scale(1 - fold * 0.54, 1 - fold * 0.54);
			context.translate(-width / 2, -height / 2);
		}

		for (let index = wovenThreads.length - 1; index >= 0; index -= 1) {
			const thread = wovenThreads[index];
			const age = Math.max(0, timestamp - thread.bornAt);
			const weaveProgress = easeInOutCubic(clamp(age / 620));
			const retractProgress = thread.retractStartedAt ? clamp((timestamp - thread.retractStartedAt) / 480) : 0;
			const opacity = (thread.field === 'password' ? 0.62 : 0.72) * (1 - retractProgress);
			const color = thread.field === 'password' ? '34, 185, 130' : '62, 166, 255';
			const approximateLength = Math.max(width * 1.75, 900);

			context.save();
			traceThread(thread);
			context.setLineDash([approximateLength, approximateLength]);
			context.lineDashOffset = approximateLength * (1 - weaveProgress + retractProgress);
			context.strokeStyle = `rgba(${color}, ${opacity * 0.24})`;
			context.lineWidth = 5;
			context.shadowColor = `rgba(${color}, 0.56)`;
			context.shadowBlur = 13;
			context.stroke();
			traceThread(thread);
			context.strokeStyle = `rgba(${color}, ${opacity})`;
			context.lineWidth = thread.field === 'password' ? 1.15 : 1.35;
			context.shadowBlur = 5;
			context.stroke();
			context.restore();

			if (retractProgress >= 1) wovenThreads.splice(index, 1);
		}
		context.restore();
	}

	function drawShuttles(deltaSeconds) {
		for (let index = shuttles.length - 1; index >= 0; index -= 1) {
			const shuttle = shuttles[index];
			if (shuttle.delay > 0) {
				shuttle.delay -= deltaSeconds;
				continue;
			}
			const speed = shuttle.operation === 'burst' ? 2.25 : shuttle.operation === 'delete' ? 2.6 : 1.82;
			shuttle.progress += (shuttle.operation === 'delete' ? -1 : 1) * speed * deltaSeconds;
			const targetProgress = shuttle.operation === 'delete' ? Math.max(0.5, shuttle.progress) : shuttle.progress;
			const point = pointOnThread(shuttle.thread, clamp(targetProgress));
			const nextPoint = pointOnThread(
				shuttle.thread,
				clamp(targetProgress + (shuttle.operation === 'delete' ? -0.006 : 0.006)),
			);
			const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x);
			const color =
				shuttle.operation === 'delete'
					? '255, 156, 50'
					: shuttle.thread.field === 'password'
						? '34, 185, 130'
						: '112, 198, 255';

			context.save();
			context.translate(point.x, point.y);
			context.rotate(angle + (shuttle.operation === 'delete' ? Math.PI : 0));
			context.fillStyle = `rgba(${color}, 1)`;
			context.shadowColor = `rgba(${color}, 1)`;
			context.shadowBlur = 24;
			context.beginPath();
			context.moveTo(20, 0);
			context.lineTo(-12, -5);
			context.lineTo(-4, 0);
			context.lineTo(-12, 5);
			context.closePath();
			context.fill();
			context.fillRect(-44, -0.7, 50, 1.4);
			context.restore();

			const complete = shuttle.operation === 'delete' ? shuttle.progress <= 0.5 : shuttle.progress >= 1;
			if (complete) {
				emitSparks(point.x, point.y, color, shuttle.operation === 'burst' ? 11 : 6);
				shuttles.splice(index, 1);
			}
		}
	}

	function drawSparks(deltaSeconds) {
		for (let index = sparks.length - 1; index >= 0; index -= 1) {
			const spark = sparks[index];
			spark.x += spark.vx * deltaSeconds;
			spark.y += spark.vy * deltaSeconds;
			spark.vx *= 0.97;
			spark.vy *= 0.97;
			spark.life -= deltaSeconds * 2.4;
			context.fillStyle = `rgba(${spark.color}, ${Math.max(0, spark.life)})`;
			context.fillRect(spark.x, spark.y, 2, 2);
			if (spark.life <= 0) sparks.splice(index, 1);
		}
	}

	function drawPunchBursts(timestamp) {
		for (let index = punchBursts.length - 1; index >= 0; index -= 1) {
			const burst = punchBursts[index];
			const progress = clamp((timestamp - burst.startedAt) / 760);
			const anchor = fieldAnchor(burst.field);
			const columns = Math.min(12, Math.max(4, burst.amount));
			const cellSize = 10;
			const scanX = lerp(anchor.x - columns * 9, anchor.x + columns * 9, progress);

			context.save();
			context.globalAlpha = Math.sin(progress * Math.PI);
			for (let column = 0; column < columns; column += 1) {
				for (let row = 0; row < 4; row += 1) {
					const x = anchor.x + (column - (columns - 1) / 2) * (cellSize + 4);
					const y = anchor.y - 56 + row * (cellSize + 5);
					context.strokeStyle = 'rgba(62, 166, 255, 0.48)';
					context.strokeRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
					if ((column * 3 + row + burst.amount) % 5 === 0) {
						context.fillStyle = 'rgba(34, 185, 130, 0.9)';
						context.shadowColor = 'rgba(34, 185, 130, 0.9)';
						context.shadowBlur = 8;
						context.fillRect(x - 2, y - 2, 4, 4);
					}
				}
			}
			context.fillStyle = 'rgba(255, 156, 50, 0.9)';
			context.shadowColor = 'rgba(255, 156, 50, 1)';
			context.shadowBlur = 18;
			context.fillRect(scanX, anchor.y - 70, 2, 66);
			context.restore();

			if (progress >= 1) punchBursts.splice(index, 1);
		}
	}

	function drawLaunchEnergy(timestamp) {
		if (!launchStartedAt) return;
		const elapsed = timestamp - launchStartedAt;
		const compileProgress = easeInOutCubic(clamp((elapsed - 2_000) / 1_200));
		const reactorProgress = easeInOutCubic(clamp((elapsed - 3_200) / 1_200));
		const breachProgress = easeInOutCubic(clamp((elapsed - 4_400) / 600));
		const centerX = width / 2;
		const centerY = height / 2;

		if (compileProgress > 0 && reactorProgress < 1) {
			context.save();
			context.globalAlpha = compileProgress * (1 - reactorProgress * 0.72);
			for (let column = 0; column < 18; column += 1) {
				const x = width * 0.12 + (column / 17) * width * 0.76;
				context.strokeStyle = column % 3 === 0 ? 'rgba(34, 185, 130, 0.38)' : 'rgba(62, 166, 255, 0.2)';
				context.beginPath();
				context.moveTo(x, height * 0.2);
				context.lineTo(x, height * 0.8);
				context.stroke();
			}
			for (let row = 0; row < 10; row += 1) {
				const y = height * 0.2 + (row / 9) * height * 0.6;
				context.strokeStyle = 'rgba(62, 166, 255, 0.18)';
				context.beginPath();
				context.moveTo(width * 0.12, y);
				context.lineTo(width * 0.88, y);
				context.stroke();
			}
			context.restore();
		}

		if (reactorProgress > 0) {
			context.save();
			context.translate(centerX, centerY);
			context.rotate(elapsed * 0.00012);
			context.globalAlpha = reactorProgress * (1 - breachProgress * 0.7);
			for (let ray = 0; ray < 36; ray += 1) {
				const angle = (ray / 36) * Math.PI * 2;
				const inner = Math.min(width, height) * 0.18;
				const outer = Math.max(width, height) * 0.62;
				context.strokeStyle = ray % 3 === 0 ? 'rgba(34, 185, 130, 0.36)' : 'rgba(62, 166, 255, 0.24)';
				context.beginPath();
				context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
				context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
				context.stroke();
			}
			context.restore();
		}

		if (breachProgress > 0) {
			const radius = lerp(8, Math.hypot(width, height) * 0.62, breachProgress);
			const breach = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
			breach.addColorStop(0, `rgba(235, 250, 255, ${0.92 * breachProgress})`);
			breach.addColorStop(0.2, `rgba(62, 166, 255, ${0.62 * breachProgress})`);
			breach.addColorStop(1, 'rgba(62, 166, 255, 0)');
			context.fillStyle = breach;
			context.fillRect(0, 0, width, height);
		}
	}

	function updateLaunchPhase(timestamp) {
		if (!launchStartedAt || !launchSequence) return;
		const elapsed = Math.max(0, timestamp - launchStartedAt);
		const definition =
			[...phaseDefinitions].reverse().find((phase) => elapsed >= phase.startsAt) ?? phaseDefinitions[0];
		launchSequence.style.setProperty('--launch-progress', String(clamp(elapsed / fullLaunchDuration)));
		if (definition.phase === activeLaunchPhase) return;

		activeLaunchPhase = definition.phase;
		launchSequence.dataset.phase = definition.phase;
		if (launchIndex) launchIndex.textContent = definition.index;
		if (launchTitle) launchTitle.textContent = definition.title;
		if (launchDetail) launchDetail.textContent = definition.detail;
		if (compilerState) compilerState.textContent = definition.compiler;
	}

	function drawScene(timestamp, deltaSeconds) {
		context.clearRect(0, 0, width, height);
		drawWarpField(timestamp);
		drawWovenThreads(timestamp);
		drawPunchBursts(timestamp);
		drawShuttles(deltaSeconds);
		drawSparks(deltaSeconds);
		drawLaunchEnergy(timestamp);
		updateLaunchPhase(timestamp);
	}

	function render(timestamp) {
		const deltaSeconds = Math.min(0.04, Math.max(0, (timestamp - lastTimestamp) / 1_000));
		lastTimestamp = timestamp;
		drawScene(timestamp, deltaSeconds);
		frame = window.requestAnimationFrame(render);
	}

	function renderStatic() {
		drawScene(performance.now(), 0);
	}

	function startRendering() {
		window.cancelAnimationFrame(frame);
		if (document.hidden) return;
		lastTimestamp = performance.now();
		if (reduceMotion.matches && !launchStartedAt) renderStatic();
		else frame = window.requestAnimationFrame(render);
	}

	function createAudio() {
		if (soundMuted) return undefined;
		if (!audioContext) {
			const AudioConstructor = window.AudioContext || window.webkitAudioContext;
			if (!AudioConstructor) return undefined;
			audioContext = new AudioConstructor();

			masterBus = audioContext.createGain();
			masterBus.gain.value = 0.82;
			compressor = audioContext.createDynamicsCompressor();
			compressor.threshold.value = -18;
			compressor.knee.value = 14;
			compressor.ratio.value = 8;
			compressor.attack.value = 0.003;
			compressor.release.value = 0.22;

			audioBuses = {
				interface: audioContext.createGain(),
				mechanical: audioContext.createGain(),
				fault: audioContext.createGain(),
				ceremony: audioContext.createGain(),
			};
			audioBuses.interface.gain.value = 0.78;
			audioBuses.mechanical.gain.value = 0.68;
			audioBuses.fault.gain.value = 0.72;
			audioBuses.ceremony.gain.value = 0.72;

			for (const bus of Object.values(audioBuses)) bus.connect(compressor);
			compressor.connect(masterBus);
			masterBus.connect(audioContext.destination);
		}
		if (audioContext.state === 'suspended') void audioContext.resume();
		return audioContext;
	}

	function tone({
		frequency,
		frequencyEnd,
		duration = 0.09,
		type = 'sine',
		gain = 0.05,
		delay = 0,
		bus = 'interface',
	}) {
		const audio = createAudio();
		if (!audio || !audioBuses || soundMuted) return;
		const startsAt = audio.currentTime + delay;
		const oscillator = audio.createOscillator();
		const envelope = audio.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(Math.max(24, frequency), startsAt);
		if (frequencyEnd) {
			oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, frequencyEnd), startsAt + duration);
		}
		envelope.gain.setValueAtTime(0.0001, startsAt);
		envelope.gain.exponentialRampToValueAtTime(gain, startsAt + Math.min(0.018, duration * 0.24));
		envelope.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
		oscillator.connect(envelope);
		envelope.connect(audioBuses[bus]);
		oscillator.start(startsAt);
		oscillator.stop(startsAt + duration + 0.03);
	}

	function noiseBurst({ duration = 0.045, gain = 0.032, delay = 0, bus = 'mechanical', highpass = 760 }) {
		const audio = createAudio();
		if (!audio || !audioBuses || soundMuted) return;
		const frameCount = Math.max(1, Math.round(audio.sampleRate * duration));
		const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
		const samples = buffer.getChannelData(0);
		for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

		const startsAt = audio.currentTime + delay;
		const source = audio.createBufferSource();
		const filter = audio.createBiquadFilter();
		const envelope = audio.createGain();
		filter.type = 'highpass';
		filter.frequency.value = highpass;
		envelope.gain.setValueAtTime(gain, startsAt);
		envelope.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
		source.buffer = buffer;
		source.connect(filter);
		filter.connect(envelope);
		envelope.connect(audioBuses[bus]);
		source.start(startsAt);
		source.stop(startsAt + duration);
	}

	function playInputSound(field, operation, length, amount) {
		if (operation === 'burst') {
			const beats = Math.min(8, Math.max(4, amount));
			for (let index = 0; index < beats; index += 1) {
				const delay = index * 0.055;
				tone({
					frequency: 220 + index * 58,
					duration: 0.11,
					type: index % 2 === 0 ? 'triangle' : 'sine',
					gain: 0.048,
					delay,
				});
				noiseBurst({ duration: 0.032, gain: 0.04, delay });
			}
			return;
		}
		if (operation === 'delete') {
			tone({
				frequency: 310,
				frequencyEnd: 112,
				duration: 0.14,
				type: 'sawtooth',
				gain: 0.05,
			});
			noiseBurst({ duration: 0.055, gain: 0.034, highpass: 540 });
			return;
		}

		const base = field === 'password' ? 294 : 372;
		tone({
			frequency: base + (length % 8) * 24,
			frequencyEnd: base * 1.08 + (length % 8) * 24,
			duration: 0.105,
			type: 'triangle',
			gain: 0.052,
		});
		noiseBurst({ duration: 0.03, gain: 0.031 });
	}

	function playDeniedSound() {
		noiseBurst({ duration: 0.32, gain: 0.078, bus: 'fault', highpass: 190 });
		tone({ frequency: 216, frequencyEnd: 118, duration: 0.34, type: 'sawtooth', gain: 0.08, bus: 'fault' });
		tone({
			frequency: 151,
			frequencyEnd: 82,
			duration: 0.46,
			type: 'triangle',
			gain: 0.085,
			delay: 0.12,
			bus: 'fault',
		});
	}

	function playLaunchSound() {
		const droneNotes = [55, 82.41, 110];
		droneNotes.forEach((frequency, index) => {
			tone({
				frequency,
				frequencyEnd: frequency * 1.5,
				duration: 4.72,
				type: index === 0 ? 'sine' : 'triangle',
				gain: index === 0 ? 0.082 : 0.047,
				delay: 0.08 + index * 0.04,
				bus: 'ceremony',
			});
		});

		tone({
			frequency: 118,
			frequencyEnd: 620,
			duration: 1.15,
			type: 'sawtooth',
			gain: 0.052,
			delay: 0.82,
			bus: 'ceremony',
		});
		for (let index = 0; index < 11; index += 1) {
			const delay = 2.02 + index * 0.105;
			noiseBurst({ duration: 0.034, gain: 0.054, delay, bus: 'ceremony', highpass: 920 });
			tone({
				frequency: 260 + index * 39,
				duration: 0.13,
				type: 'triangle',
				gain: 0.04,
				delay,
				bus: 'ceremony',
			});
		}

		[146.83, 220, 293.66, 440].forEach((frequency, index) => {
			tone({
				frequency,
				frequencyEnd: frequency * 1.04,
				duration: 1.18,
				type: index < 2 ? 'triangle' : 'sine',
				gain: 0.068,
				delay: 3.2 + index * 0.035,
				bus: 'ceremony',
			});
		});

		noiseBurst({ duration: 0.5, gain: 0.09, delay: 4.38, bus: 'ceremony', highpass: 420 });
		[293.66, 440, 587.33, 880].forEach((frequency, index) => {
			tone({
				frequency,
				frequencyEnd: frequency * 1.12,
				duration: 0.58,
				type: 'sine',
				gain: 0.074 - index * 0.007,
				delay: 4.4 + index * 0.025,
				bus: 'ceremony',
			});
		});
	}

	function updateSoundControl() {
		if (!soundButton) return;
		soundButton.setAttribute('aria-pressed', String(!soundMuted));
		const state = soundButton.querySelector('strong');
		if (state) state.textContent = soundMuted ? 'Off' : 'On';
	}

	function updateEncryptedCells(length) {
		const container = document.querySelector('.encrypted-cells');
		if (!container) return;
		container.replaceChildren();
		const visibleCount = Math.min(length, 26);
		for (let index = 0; index < visibleCount; index += 1) {
			const cell = document.createElement('i');
			container.append(cell);
		}
	}

	function updateFieldCount(field, length) {
		const output = document.querySelector(`[data-field-count="${field}"]`);
		if (output) output.textContent = String(Math.min(length, 99)).padStart(2, '0');
		if (field === 'password') updateEncryptedCells(length);
	}

	function pulseField(field, operation) {
		const control = document.querySelector(`.loom-field-control[data-field="${field}"]`);
		if (!control) return;
		control.removeAttribute('data-pulse');
		window.requestAnimationFrame(() => control.setAttribute('data-pulse', operation));
	}

	function handleFieldInput(field) {
		const state = fieldState.get(field);
		if (!state || state.composing) return;
		const nextLength = state.input.value.length;
		const delta = nextLength - state.length;
		if (delta === 0 && !state.inputType.includes('Replacement')) {
			state.inputType = '';
			return;
		}

		const inputType = state.inputType;
		const operation =
			inputType.includes('delete') || delta < 0
				? 'delete'
				: inputType.includes('Paste') || inputType.includes('Replacement') || Math.abs(delta) > 1
					? 'burst'
					: 'insert';
		const amount = Math.max(1, Math.abs(delta));

		state.length = nextLength;
		state.inputType = '';
		updateFieldCount(field, nextLength);
		pulseField(field, operation);
		if (operation === 'delete') retractWovenThreads(field, amount);
		else addWovenThreads(field, amount, operation);
		playInputSound(field, operation, nextLength, amount);
		if (reduceMotion.matches) renderStatic();
	}

	function showError(message) {
		if (!errorRegion || !errorOutput) return;
		errorOutput.textContent = message;
		errorRegion.setAttribute('data-visible', 'true');
	}

	function clearError() {
		if (!errorRegion || !errorOutput) return;
		errorOutput.textContent = '';
		errorRegion.removeAttribute('data-visible');
	}

	function setBusy(busy) {
		usernameInput.readOnly = busy;
		passwordInput.readOnly = busy;
		submitButton.disabled = busy;
		const label = submitButton.querySelector('.button-label');
		if (label) label.textContent = busy ? 'Resolving identity' : 'Authenticate';
	}

	async function authenticate(event) {
		event.preventDefault();
		clearError();

		if (!form.reportValidity()) return;
		setBusy(true);
		document.body.setAttribute('data-state', 'verifying');
		tone({ frequency: 420, frequencyEnd: 610, duration: 0.2, type: 'triangle', gain: 0.058 });

		try {
			const formData = new FormData(form);
			const body = new URLSearchParams();
			for (const [key, value] of formData.entries()) {
				if (typeof value === 'string') body.set(key, value);
			}
			const response = await fetch(form.action, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
					'X-Portal-Request': 'identity-loom',
				},
				body,
			});
			const payload = await response.json().catch(() => ({ ok: false }));

			if (!response.ok || payload.ok !== true) {
				throw Object.assign(new Error('Identity not recognized'), { denied: response.status === 401 });
			}

			const destination = typeof payload.next === 'string' ? payload.next : '/';
			document.body.setAttribute('data-state', 'launching');
			launchSequence?.setAttribute('data-active', 'true');
			launchSequence?.setAttribute('aria-hidden', 'false');
			if (launchDestination) launchDestination.textContent = destination;
			window.sessionStorage.setItem(arrivalStorageKey, 'granted');

			if (reduceMotion.matches) {
				launchStartedAt = 0;
				launchSequence?.setAttribute('data-phase', 'breach');
				tone({ frequency: 392, frequencyEnd: 587.33, duration: 0.16, gain: 0.06, bus: 'ceremony' });
				renderStatic();
			} else {
				launchStartedAt = performance.now();
				activeLaunchPhase = '';
				playLaunchSound();
				startRendering();
			}

			const launchDuration = reduceMotion.matches ? reducedLaunchDuration : fullLaunchDuration;
			window.setTimeout(() => window.location.replace(destination), launchDuration);
		} catch (error) {
			const denied = error && typeof error === 'object' && error.denied === true;
			document.body.setAttribute('data-state', 'denied');
			denialStartedAt = performance.now();
			retractWovenThreads('password', Math.max(1, fieldState.get('password')?.length ?? 1));
			passwordInput.value = '';
			const passwordState = fieldState.get('password');
			if (passwordState) passwordState.length = 0;
			updateFieldCount('password', 0);
			showError(denied ? 'Identity not recognized' : 'Local identity gate unavailable');
			playDeniedSound();
			setBusy(false);
			if (reduceMotion.matches) renderStatic();
			window.setTimeout(
				() => {
					document.body.removeAttribute('data-state');
					denialStartedAt = 0;
					passwordInput.focus();
				},
				reduceMotion.matches ? 1 : 720,
			);
		}
	}

	for (const [field, state] of fieldState) {
		if (state.length > 0) addWovenThreads(field, state.length, 'insert', true);
		state.input.addEventListener('beforeinput', (event) => {
			state.inputType = event.inputType || '';
		});
		state.input.addEventListener('input', () => handleFieldInput(field));
		state.input.addEventListener('compositionstart', () => {
			state.composing = true;
		});
		state.input.addEventListener('compositionend', () => {
			state.composing = false;
			state.inputType = 'insertCompositionText';
			handleFieldInput(field);
		});
		state.input.addEventListener('focus', clearError);
		updateFieldCount(field, state.length);
	}

	form.addEventListener('submit', authenticate);
	soundButton?.addEventListener('click', () => {
		soundMuted = !soundMuted;
		window.localStorage.setItem(mutedStorageKey, String(soundMuted));
		if (soundMuted && masterBus && audioContext) {
			masterBus.gain.setTargetAtTime(0.0001, audioContext.currentTime, 0.025);
		} else if (!soundMuted) {
			const audio = createAudio();
			if (audio && masterBus) masterBus.gain.setTargetAtTime(0.82, audio.currentTime, 0.025);
			tone({ frequency: 520, frequencyEnd: 680, duration: 0.14, type: 'sine', gain: 0.055 });
		}
		updateSoundControl();
	});

	function unlockAudio() {
		createAudio();
		window.removeEventListener('pointerdown', unlockAudio);
		window.removeEventListener('keydown', unlockAudio);
	}

	window.addEventListener('pointerdown', unlockAudio, { passive: true });
	window.addEventListener('keydown', unlockAudio);
	window.addEventListener('resize', () => {
		resizeCanvas();
		if (reduceMotion.matches) renderStatic();
	});
	window.addEventListener(
		'pointermove',
		(event) => {
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			pointer.active = true;
		},
		{ passive: true },
	);
	window.addEventListener('pointerleave', () => {
		pointer.active = false;
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) window.cancelAnimationFrame(frame);
		else startRendering();
	});
	reduceMotion.addEventListener('change', startRendering);

	const query = new URLSearchParams(window.location.search);
	if (query.get('error') === '1') showError('Identity not recognized');
	updateSoundControl();
	resizeCanvas();
	startRendering();
	usernameInput.focus({ preventScroll: true });

	window.setTimeout(() => {
		for (const field of fieldState.keys()) handleFieldInput(field);
	}, 240);
})();
