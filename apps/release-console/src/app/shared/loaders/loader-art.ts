/**
 * The 29 loader drawings (brief N5kmX6DLJv1ECitVUPFHJ8, revision 2, approved 21 Nov 2026), each an SVG
 * in a 200 × 200 box in the console's colours, and which screen shows which. The drawings are
 * fixed text written here, never built from anything a vendor or a person sends.
 */
export interface LoaderArt {
	id: string;
	name: string;
	/** Who the loader says it is reading, when the screen does not say. */
	vendor: string;
	/** What it is reading, in the gallery. */
	what: string;
	idea: string;
	svg(): string;
}

const C = '#5ed6ff',
	A = '#ffb547',
	G = '#5dffa8',
	R = '#ff5d5d',
	D = 'rgba(94,214,255,0.25)',
	M = '#7fa3b8';
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const diamond = (cx: number, cy: number, s: number, cls = '', extra = ''): string =>
	`<rect class="${cls}" x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" transform="rotate(45 ${cx} ${cy})" fill="rgba(94,214,255,0.12)" stroke="${C}" stroke-width="2.5" ${extra}/>`;

export const LOADERS: readonly LoaderArt[] = [
	{
		id: 'boot',
		name: 'Boot sequence',
		vendor: 'the console',
		what: 'projects · keys · Mac helper',
		idea: 'The console wakes: the logo diamond lights, rings push outward, and the three things it reads at start tick in.',
		svg: () =>
			`${range(3)
				.map(
					(i) =>
						`<circle class="b-ring" style="animation-delay:${i * 0.6}s" cx="100" cy="82" r="20" fill="none" stroke="${C}" stroke-width="1.5"/>`,
				)
				.join(
					'',
				)}${diamond(100, 82, 26, 'b-core')}${['projects', 'keys', 'Mac helper'].map((t, i) => `<g class="b-line" style="animation-delay:${0.4 + i * 0.5}s"><text x="60" y="${142 + i * 18}" fill="${M}" font-size="11" font-family="IBM Plex Mono">${t}</text><text x="140" y="${142 + i * 18}" fill="${G}" font-size="11" font-family="IBM Plex Mono" text-anchor="end">ok</text></g>`).join('')}`,
	},
	{
		id: 'reactor',
		name: 'Reactor core',
		vendor: 'GitHub',
		what: 'deploy.yml · staging',
		idea: 'The reactor from the Live deploy drawing: rings turn, a cyan arc charges round, the core breathes. A release is power moving.',
		svg: () =>
			`<g class="spin"><circle cx="100" cy="100" r="92" fill="none" stroke="${D}" stroke-dasharray="2 6"/></g><g class="spin-r"><circle cx="100" cy="100" r="82" fill="none" stroke="rgba(94,214,255,0.25)" stroke-width="6" stroke-dasharray="34 12 7 12"/></g><circle cx="100" cy="100" r="68" fill="none" stroke="rgba(94,214,255,0.12)" stroke-width="9"/><g class="spin-fast"><circle class="charge" cx="100" cy="100" r="68" fill="none" stroke="${C}" stroke-width="9" pathLength="100"/></g><circle cx="100" cy="100" r="52" fill="none" stroke="rgba(255,181,71,0.3)" stroke-width="3" stroke-dasharray="3 5"/><g class="breathe">${diamond(100, 100, 34)}</g>`,
	},
	{
		id: 'rewind',
		name: 'Rewind',
		vendor: 'GitHub',
		what: 'tags · earlier releases',
		idea: 'The reactor running backwards in amber, with double chevrons: going back to a release that worked.',
		svg: () =>
			`<g class="spin-r"><circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,181,71,0.35)" stroke-dasharray="2 6"/></g><circle cx="100" cy="100" r="68" fill="none" stroke="rgba(255,181,71,0.12)" stroke-width="9"/><g class="spin-back"><circle class="charge back" cx="100" cy="100" r="68" fill="none" stroke="${A}" stroke-width="9" pathLength="100"/></g><g class="chev"><path d="M108 84 L90 100 L108 116 M126 84 L108 100 L126 116" fill="none" stroke="${A}" stroke-width="5" stroke-linejoin="round"/></g>`,
	},
	{
		id: 'pipeline',
		name: 'Pipeline track',
		vendor: 'GitHub',
		what: 'checks · workflow runs',
		idea: 'A CI track: five checks on a line; a pulse runs along, each turns queued, running, passed.',
		svg: () =>
			`<line x1="20" y1="100" x2="180" y2="100" stroke="${D}" stroke-width="2"/><circle class="p-pulse" cx="20" cy="100" r="4" fill="${C}"/>${range(
				5,
			)
				.map(
					(i) =>
						`<g class="p-node" style="animation-delay:${i * 0.45}s"><circle cx="${20 + i * 40}" cy="100" r="11" fill="#050b14" stroke="${M}" stroke-width="2" stroke-dasharray="4 3"/><path d="M${15 + i * 40} 100 l4 4 l7 -8" fill="none" stroke="${G}" stroke-width="2.5" class="p-tick" style="animation-delay:${i * 0.45}s"/></g>`,
				)
				.join(
					'',
				)}<text x="100" y="140" text-anchor="middle" fill="${M}" font-size="10" font-family="IBM Plex Mono">lint · types · unit · build · e2e</text>`,
	},
	{
		id: 'terminal',
		name: 'Terminal',
		vendor: 'this Mac',
		what: 'saha-textile-api · logs',
		idea: 'A terminal window typing its first lines, cursor blinking: reading logs and running fixed commands.',
		svg: () =>
			`<rect x="22" y="40" width="156" height="120" rx="4" fill="#03070d" stroke="${D}"/><circle cx="34" cy="50" r="3" fill="${R}"/><circle cx="44" cy="50" r="3" fill="${A}"/><circle cx="54" cy="50" r="3" fill="${G}"/>${range(
				5,
			)
				.map(
					(i) =>
						`<rect class="t-line" style="animation-delay:${i * 0.35}s" x="32" y="${66 + i * 16}" width="${[110, 80, 124, 64, 96][i]}" height="6" fill="${i === 3 ? R : i % 2 ? M : G}" opacity="0.8"/>`,
				)
				.join('')}<rect class="cursor-b" x="32" y="146" width="7" height="9" fill="${C}"/>`,
	},
	{
		id: 'diff',
		name: 'Diff scan',
		vendor: 'GitHub',
		what: 'compare · last release → now',
		idea: 'Two columns of lines; a scan line passes and green additions and red removals settle into place.',
		svg: () =>
			`${range(8)
				.map(
					(i) =>
						`<rect class="d-row" style="animation-delay:${i * 0.18}s" x="26" y="${44 + i * 15}" width="${[60, 40, 66, 30, 54, 62, 36, 50][i]}" height="7" fill="${[R, M, R, M, M, R, M, M][i]}"/><rect class="d-row" style="animation-delay:${i * 0.18 + 0.1}s" x="108" y="${44 + i * 15}" width="${[56, 40, 64, 44, 54, 30, 60, 50][i]}" height="7" fill="${[G, M, G, G, M, M, G, M][i]}"/>`,
				)
				.join('')}<line class="d-scan" x1="20" x2="180" y1="40" y2="40" stroke="${C}" stroke-width="2"/>`,
	},
	{
		id: 'timeline',
		name: 'Timeline',
		vendor: 'GitHub',
		what: 'releases · freezes · schedules',
		idea: 'A month of days lighting in a wave, freeze days glowing red, with a clock hand sweeping: things in time.',
		svg: () =>
			`${range(35)
				.map(
					(i) =>
						`<rect class="tl-day ${[11, 12, 13, 26].includes(i) ? 'frz' : ''}" style="animation-delay:${(i % 7) * 0.08 + Math.floor(i / 7) * 0.12}s" x="${30 + (i % 7) * 20}" y="${48 + Math.floor(i / 7) * 20}" width="15" height="15" fill="none" stroke="${D}"/>`,
				)
				.join(
					'',
				)}<g class="hand"><line x1="168" y1="36" x2="168" y2="24" stroke="${A}" stroke-width="2"/></g><circle cx="168" cy="36" r="13" fill="none" stroke="${A}" stroke-opacity="0.6"/>`,
	},
	{
		id: 'pressure',
		name: 'Pressure gauge',
		vendor: 'staging',
		what: 'load test · 4 stages',
		idea: 'A dial whose needle climbs in four steps while load bars rise: the shop being pushed to find where it slows.',
		svg: () =>
			`<path d="M40 130 A60 60 0 0 1 160 130" fill="none" stroke="${D}" stroke-width="10"/><path d="M128 72 A60 60 0 0 1 160 130" fill="none" stroke="rgba(255,93,93,0.5)" stroke-width="10"/><g class="needle"><line x1="100" y1="130" x2="100" y2="80" stroke="${A}" stroke-width="3"/></g><circle cx="100" cy="130" r="6" fill="${A}"/>${range(
				4,
			)
				.map(
					(i) =>
						`<rect class="pz-bar" style="animation-delay:${i * 0.6}s" x="${62 + i * 20}" y="150" width="14" height="24" fill="${C}"/>`,
				)
				.join('')}`,
	},
	{
		id: 'mirror',
		name: 'Mirror',
		vendor: 'DigitalOcean',
		what: 'snapshots · backups',
		idea: 'Production on the left, its copy forming on the right: blocks cross the mirror line. Copies, backups and rehearsals.',
		svg: () =>
			`<rect x="24" y="52" width="60" height="96" fill="rgba(94,214,255,0.08)" stroke="${C}"/><rect x="116" y="52" width="60" height="96" fill="none" stroke="${C}" stroke-dasharray="4 4"/><line x1="100" y1="40" x2="100" y2="160" stroke="${A}" stroke-dasharray="2 4"/>${range(
				4,
			)
				.map(
					(i) =>
						`<rect class="mi-blk" style="animation-delay:${i * 0.5}s" x="40" y="${62 + i * 20}" width="28" height="12" fill="${C}"/>`,
				)
				.join(
					'',
				)}<text x="54" y="170" text-anchor="middle" fill="${M}" font-size="9" font-family="IBM Plex Mono">live</text><text x="146" y="170" text-anchor="middle" fill="${M}" font-size="9" font-family="IBM Plex Mono">copy</text>`,
	},
	{
		id: 'stack',
		name: 'Container stack',
		vendor: 'DigitalOcean',
		what: 'images · clusters · apps',
		idea: 'Layers drop and lock onto a stack, the way an image is built from layers and an app from containers.',
		svg: () =>
			`<line x1="50" y1="160" x2="150" y2="160" stroke="${D}" stroke-width="2"/>${range(4)
				.map(
					(i) =>
						`<g class="st-blk" style="animation-delay:${i * 0.45}s"><rect x="${56 + i * 4}" y="${136 - i * 24}" width="${88 - i * 8}" height="20" fill="rgba(94,214,255,${0.1 + i * 0.06})" stroke="${C}"/></g>`,
				)
				.join('')}`,
	},
	{
		id: 'radar',
		name: 'Radar',
		vendor: 'this Mac',
		what: 'errors · alerts · findings',
		idea: 'A radar sweep finds blips, amber and red: hunting for what is wrong.',
		svg: () =>
			`${[80, 56, 32].map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${D}"/>`).join('')}<line x1="20" y1="100" x2="180" y2="100" stroke="${D}"/><line x1="100" y1="20" x2="100" y2="180" stroke="${D}"/><g class="sweep"><path d="M100 100 L100 20 A80 80 0 0 1 156 43 Z" fill="url(#rg)"/></g>${[
				[132, 70, A, 0.2],
				[70, 128, R, 1.1],
				[146, 120, A, 1.8],
				[80, 60, R, 2.5],
			]
				.map(
					([x, y, c, d]) =>
						`<circle class="blip" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="5" fill="${c}"/>`,
				)
				.join(
					'',
				)}<defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="${C}" stop-opacity="0"/><stop offset="1" stop-color="${C}" stop-opacity="0.45"/></linearGradient></defs>`,
	},
	{
		id: 'waterfall',
		name: 'Waterfall',
		vendor: 'this Mac',
		what: 'routes · timings',
		idea: 'Trace spans drawing in a staggered waterfall: where the time of a request goes.',
		svg: () =>
			`${range(6)
				.map(
					(i) =>
						`<rect class="wf-bar" style="animation-delay:${i * 0.3}s;--w:${[150, 70, 52, 90, 34, 58][i]}px" x="${24 + ([0, 8, 26, 40, 96, 120][i] ?? 0)}" y="${46 + i * 19}" height="11" width="${[150, 70, 52, 90, 34, 58][i]}" fill="${[C, C, A, C, R, C][i]}"/>`,
				)
				.join('')}<line x1="24" y1="40" x2="24" y2="164" stroke="${D}"/>`,
	},
	{
		id: 'heartbeat',
		name: 'Heartbeat',
		vendor: 'this Mac',
		what: 'health · uptime',
		idea: 'A pulse line draws across while three check points ping: is everything alive.',
		svg: () =>
			`<polyline class="ecg" points="10,100 50,100 62,100 70,70 80,134 90,86 98,100 130,100 140,100 148,76 158,124 166,100 190,100" fill="none" stroke="${G}" stroke-width="2.5" pathLength="100"/>${[50, 100, 150].map((x, i) => `<circle class="ping" style="animation-delay:${i * 0.5}s" cx="${x}" cy="160" r="5" fill="none" stroke="${G}" stroke-width="2"/><circle cx="${x}" cy="160" r="3" fill="${G}"/>`).join('')}`,
	},
	{
		id: 'gauges',
		name: 'Gauges',
		vendor: 'DigitalOcean',
		what: 'usage · balance · totals',
		idea: 'Three dials sweep up and settle, as on a car’s dashboard when the engine starts.',
		svg: () =>
			`${[
				[55, 90, 0],
				[145, 90, 0.4],
				[100, 145, 0.8],
			]
				.map(
					([x, y, d]) =>
						`<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="${D}" stroke-width="7"/><circle class="gz" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="30" fill="none" stroke="${C}" stroke-width="7" pathLength="100" transform="rotate(-90 ${x} ${y})"/>`,
				)
				.join('')}`,
	},
	{
		id: 'rack',
		name: 'Server rack',
		vendor: 'this Mac',
		what: 'containers · processes',
		idea: 'Rack units power on in order, their lights blinking: servers and processes waking.',
		svg: () =>
			`<rect x="50" y="30" width="100" height="140" fill="#03070d" stroke="${D}"/>${range(6)
				.map(
					(i) =>
						`<g><rect x="58" y="${38 + i * 22}" width="84" height="16" fill="rgba(94,214,255,0.06)" stroke="${D}"/>${range(
							3,
						)
							.map(
								(j) =>
									`<circle class="led" style="animation-delay:${i * 0.25 + j * 0.12}s" cx="${70 + j * 9}" cy="${46 + i * 22}" r="2.6" fill="${j === 2 ? A : G}"/>`,
							)
							.join(
								'',
							)}<rect class="rk-bar" style="animation-delay:${i * 0.25}s" x="104" y="${43 + i * 22}" width="30" height="6" fill="${C}"/></g>`,
				)
				.join('')}`,
	},
	{
		id: 'uplink',
		name: 'Uplink',
		vendor: 'this Mac',
		what: 'connections · outside services',
		idea: 'The console and the far end joined by a link that packets travel home along, over a signal trace.',
		svg: () =>
			`${diamond(34, 90, 22, 'breathe')}<circle cx="166" cy="90" r="20" fill="none" stroke="${C}" stroke-width="2"/><g class="spin" style="transform-origin:166px 90px"><circle cx="166" cy="90" r="27" fill="none" stroke="${D}" stroke-dasharray="3 4"/></g><line x1="52" y1="90" x2="144" y2="90" stroke="${C}" stroke-opacity="0.5" stroke-dasharray="4 4"/>${range(
				3,
			)
				.map(
					(i) =>
						`<rect class="pkt" style="animation-delay:${i * 0.5}s" x="0" y="0" width="7" height="7" fill="${C}"/>`,
				)
				.join('')}<path class="wave" d="M10 140 ${range(10)
				.map((i) => `q 10 ${i % 2 ? 12 : -12} 20 0`)
				.join(' ')}" fill="none" stroke="${C}" stroke-width="1.6"/>`,
	},
	{
		id: 'tunnel',
		name: 'Tunnel',
		vendor: 'Cloudflare',
		what: 'tunnels · Access',
		idea: 'Diamonds stream out of the centre like the walls of a tunnel: private ways in, through Cloudflare.',
		svg: () =>
			`${range(5)
				.map(
					(i) =>
						`<rect class="tn" style="animation-delay:${i * 0.5}s" x="85" y="85" width="30" height="30" fill="none" stroke="${C}" stroke-width="2" transform="rotate(45 100 100)"/>`,
				)
				.join('')}<circle cx="100" cy="100" r="4" fill="${C}"/>`,
	},
	{
		id: 'datacore',
		name: 'Data core',
		vendor: 'MongoDB',
		what: 'collections · indexes',
		idea: 'A database cylinder fills and settles, its rings lighting from the bottom: data being read off disk.',
		svg: () =>
			`<defs><clipPath id="cyl"><path d="M50 50 a50 14 0 0 1 100 0 v100 a50 14 0 0 1 -100 0 z"/></clipPath></defs><g clip-path="url(#cyl)"><rect class="fill" x="50" y="60" width="100" height="110" fill="rgba(94,214,255,0.22)"/></g><path d="M50 50 a50 14 0 0 1 100 0 v100 a50 14 0 0 1 -100 0 z" fill="none" stroke="${C}" stroke-width="2"/><ellipse cx="100" cy="50" rx="50" ry="14" fill="none" stroke="${C}" stroke-width="2"/>${[84, 117].map((y, i) => `<path class="ring" style="animation-delay:${i * 0.5}s" d="M50 ${y} a50 14 0 0 0 100 0" fill="none" stroke="${C}" stroke-width="1.5"/>`).join('')}`,
	},
	{
		id: 'conveyor',
		name: 'Conveyor',
		vendor: 'Redis',
		what: 'queues · jobs',
		idea: 'Jobs ride a belt into a turning worker: queues being worked through.',
		svg: () =>
			`<line x1="14" y1="130" x2="140" y2="130" stroke="${D}" stroke-width="3"/>${range(4)
				.map(
					(i) =>
						`<rect class="cv" style="animation-delay:${i * 0.6}s" x="0" y="112" width="16" height="16" fill="rgba(94,214,255,0.25)" stroke="${C}"/>`,
				)
				.join(
					'',
				)}<g class="gear"><circle cx="160" cy="120" r="18" fill="none" stroke="${A}" stroke-width="4" stroke-dasharray="6 4"/><circle cx="160" cy="120" r="6" fill="${A}"/></g>`,
	},
	{
		id: 'pixel',
		name: 'Pixel resolve',
		vendor: 'Spaces',
		what: 'photos · buckets',
		idea: 'Tiles of a photo resolve from coarse to sharp: pictures and stored files arriving.',
		svg: () =>
			`${range(16)
				.map(
					(i) =>
						`<rect class="px" style="animation-delay:${[0.1, 0.7, 0.3, 1.2, 0.9, 0.2, 1.4, 0.5, 1.1, 0.6, 0.0, 1.3, 0.4, 1.0, 0.8, 1.5][i]}s" x="${44 + (i % 4) * 28}" y="${44 + Math.floor(i / 4) * 28}" width="26" height="26" fill="rgba(94,214,255,${0.1 + ((i * 7) % 5) * 0.08})" stroke="${D}"/>`,
				)
				.join('')}`,
	},
	{
		id: 'lens',
		name: 'Search lens',
		vendor: 'Meilisearch',
		what: 'indexes · pages',
		idea: 'A lens sweeps over rows of words and lights the matches: search indexes, crawlers and what engines see.',
		svg: () =>
			`${range(6)
				.map(
					(i) =>
						`<rect x="30" y="${50 + i * 18}" width="${[120, 96, 140, 80, 110, 70][i]}" height="7" fill="${D}"/>`,
				)
				.join(
					'',
				)}<g class="lens"><circle cx="70" cy="86" r="22" fill="rgba(94,214,255,0.1)" stroke="${C}" stroke-width="3"/><line x1="86" y1="102" x2="100" y2="116" stroke="${C}" stroke-width="5"/></g>`,
	},
	{
		id: 'vault',
		name: 'Vault',
		vendor: 'Infisical',
		what: 'names only · never values',
		idea: 'A vault dial turns in clicks while masked characters tick to checks: keys and secrets read by name, never by value.',
		svg: () =>
			`<circle cx="100" cy="88" r="56" fill="none" stroke="${D}" stroke-width="2"/><g class="dial">${range(24)
				.map(
					(i) =>
						`<line x1="100" y1="36" x2="100" y2="${i % 6 ? 42 : 48}" stroke="${C}" stroke-width="2" transform="rotate(${i * 15} 100 88)"/>`,
				)
				.join(
					'',
				)}</g><circle cx="100" cy="88" r="20" fill="none" stroke="${C}" stroke-width="3"/><rect x="97" y="80" width="6" height="16" fill="${C}"/>${range(
				6,
			)
				.map(
					(i) =>
						`<text class="mask" style="animation-delay:${i * 0.3}s" x="${55 + i * 18}" y="170" fill="${C}" font-size="16" font-family="IBM Plex Mono" text-anchor="middle">•</text>`,
				)
				.join('')}`,
	},
	{
		id: 'neural',
		name: 'Neural mesh',
		vendor: 'DigitalOcean',
		what: 'agents · models',
		idea: 'Nodes of a small network with signals running between them: AI and compute building blocks.',
		svg: () =>
			`${[
				[40, 60],
				[40, 140],
				[100, 40],
				[100, 100],
				[100, 160],
				[160, 70],
				[160, 130],
			]
				.map(([x, y], i, all) =>
					(i < 2 ? [2, 3, 4] : i < 5 ? [5, 6] : [])
						.map(
							(j) =>
								`<line class="nl" style="animation-delay:${(i + j) * 0.15}s" x1="${x}" y1="${y}" x2="${all[j]?.[0]}" y2="${all[j]?.[1]}" stroke="${C}" stroke-width="1.5" pathLength="100"/>`,
						)
						.join(''),
				)
				.join('')}${[
				[40, 60],
				[40, 140],
				[100, 40],
				[100, 100],
				[100, 160],
				[160, 70],
				[160, 130],
			]
				.map(
					([x, y], i) =>
						`<circle class="nn" style="animation-delay:${i * 0.2}s" cx="${x}" cy="${y}" r="7" fill="#050b14" stroke="${C}" stroke-width="2"/>`,
				)
				.join('')}`,
	},
	{
		id: 'shield',
		name: 'Shield scan',
		vendor: 'Cloudflare',
		what: 'rules · certificates',
		idea: 'A shield with corner brackets locking on and a beam sweeping inside: security rules and certificates checked.',
		svg: () =>
			`<defs><clipPath id="sh"><path d="M100 30 L160 52 V104 C160 140 132 162 100 174 C68 162 40 140 40 104 V52 Z"/></clipPath></defs><path d="M100 30 L160 52 V104 C160 140 132 162 100 174 C68 162 40 140 40 104 V52 Z" fill="rgba(94,214,255,0.06)" stroke="${C}" stroke-width="2.5"/><g clip-path="url(#sh)"><rect class="beam-y" x="30" y="20" width="140" height="18" fill="url(#bg2)"/></g><defs><linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C}" stop-opacity="0"/><stop offset="1" stop-color="${C}" stop-opacity="0.7"/></linearGradient></defs>${[
				[22, 22, 'M22 38 V22 H38'],
				[178, 22, 'M162 22 H178 V38'],
				[22, 178, 'M22 162 V178 H38'],
				[178, 178, 'M162 178 H178 V162'],
			]
				.map((b) => `<path class="brk" d="${b[2]}" fill="none" stroke="${C}" stroke-width="3"/>`)
				.join('')}`,
	},
	{
		id: 'globe',
		name: 'Edge globe',
		vendor: 'Cloudflare',
		what: 'accounts · domains',
		idea: 'A wire globe turning with edge points pulsing around it: Cloudflare’s network, account-wide.',
		svg: () =>
			`<circle cx="100" cy="100" r="70" fill="none" stroke="${C}" stroke-width="2"/>${range(3)
				.map(
					(i) =>
						`<ellipse class="lon" style="animation-delay:${i * -1}s" cx="100" cy="100" rx="70" ry="70" fill="none" stroke="${D}" stroke-width="1.5"/>`,
				)
				.join(
					'',
				)}${[60, 100, 140].map((y) => `<ellipse cx="100" cy="${y}" rx="${y === 100 ? 70 : 58}" ry="8" fill="none" stroke="${D}"/>`).join('')}${[
				[52, 70],
				[140, 62],
				[120, 132],
				[70, 128],
				[100, 40],
			]
				.map(
					([x, y], i) =>
						`<circle class="ep" style="animation-delay:${i * 0.4}s" cx="${x}" cy="${y}" r="4" fill="${A}"/>`,
				)
				.join('')}`,
	},
	{
		id: 'edge',
		name: 'Edge cache',
		vendor: 'Cloudflare',
		what: 'cache · rules · speed',
		idea: 'Requests fly in; most bounce straight back green from the cache, a few pass amber through to the server.',
		svg: () =>
			`<rect x="96" y="40" width="8" height="120" fill="${C}" opacity="0.7"/><rect x="160" y="80" width="24" height="40" fill="none" stroke="${M}"/><text x="172" y="134" text-anchor="middle" fill="${M}" font-size="9" font-family="IBM Plex Mono">server</text>${range(
				4,
			)
				.map(
					(i) =>
						`<circle class="hit" style="animation-delay:${i * 0.45}s" cx="20" cy="${60 + i * 26}" r="5" fill="${G}"/>`,
				)
				.join('')}<circle class="miss" cx="20" cy="100" r="5" fill="${A}"/>`,
	},
	{
		id: 'decoder',
		name: 'Decoder',
		vendor: 'Cloudflare',
		what: 'DNS records',
		idea: 'The domain name decodes letter by letter from noise, as a name resolves to an address.',
		svg: () =>
			`<rect x="20" y="70" width="160" height="40" fill="rgba(94,214,255,0.06)" stroke="${D}"/><text class="dec" x="100" y="96" text-anchor="middle" fill="${C}" font-size="15" font-family="IBM Plex Mono" data-word="sahatextile.com">sahatextile.com</text><text class="dec2" x="100" y="134" text-anchor="middle" fill="${M}" font-size="11" font-family="IBM Plex Mono" data-word="A · 203.0.113.9">A · 203.0.113.9</text>`,
	},
	{
		id: 'ledger',
		name: 'Ledger',
		vendor: 'the console',
		what: 'entries · who · when',
		idea: 'Rows write themselves into a ledger and get stamped: payments, the audit log, requests with deadlines.',
		svg: () =>
			`<rect x="36" y="30" width="128" height="140" fill="rgba(94,214,255,0.04)" stroke="${D}"/>${range(6)
				.map(
					(i) =>
						`<g class="lg" style="animation-delay:${i * 0.4}s"><rect x="46" y="${44 + i * 20}" width="${[70, 54, 80, 62, 48, 74][i]}" height="6" fill="${M}"/><path d="M140 ${44 + i * 20} l4 4 l8 -8" fill="none" stroke="${G}" stroke-width="2.5"/></g>`,
				)
				.join('')}`,
	},
	{
		id: 'switchboard',
		name: 'Switchboard',
		vendor: 'MongoDB',
		what: 'switches · settings',
		idea: 'A row of switches flicking one after another: kill switches and settings being read.',
		svg: () =>
			`${range(4)
				.map(
					(i) =>
						`<g><rect x="${30 + i * 38}" y="80" width="28" height="44" rx="14" fill="none" stroke="${D}" stroke-width="2"/><circle class="sw" style="animation-delay:${i * 0.35}s" cx="${44 + i * 38}" cy="${110}" r="9" fill="${C}"/></g>`,
				)
				.join('')}`,
	},
];

/** Repository screen (menu key) → its loader. Every screen of the approved menu is listed. */
export const LOADER_OF_SCREEN: Readonly<Record<string, string>> = {
	pulls: 'pipeline',
	pipeline: 'pipeline',
	logs: 'terminal',
	approvals: 'reactor',
	deploy: 'reactor',
	steps: 'reactor',
	impact: 'reactor',
	changes: 'diff',
	rollback: 'rewind',
	calendar: 'timeline',
	rehearsal: 'mirror',
	loadtest: 'pressure',
	images: 'stack',
	deps: 'diff',
	issues: 'radar',
	alerts: 'radar',
	incident: 'radar',
	apm: 'waterfall',
	traces: 'waterfall',
	queries: 'waterfall',
	rum: 'waterfall',
	health: 'heartbeat',
	uptime: 'heartbeat',
	slo: 'heartbeat',
	dashboards: 'gauges',
	services: 'rack',
	processes: 'rack',
	infra: 'rack',
	server: 'rack',
	terminal: 'terminal',
	tail: 'terminal',
	network: 'uplink',
	cdn: 'edge',
	database: 'datacore',
	search: 'lens',
	media: 'pixel',
	queues: 'conveyor',
	cron: 'timeline',
	flags: 'switchboard',
	secrets: 'vault',
	drift: 'diff',
	droplets: 'rack',
	doautoscale: 'stack',
	kubernetes: 'stack',
	apps: 'stack',
	functions: 'stack',
	spaces: 'pixel',
	volumes: 'datacore',
	nfs: 'datacore',
	dobackups: 'mirror',
	databases: 'datacore',
	registry: 'stack',
	cloudnet: 'uplink',
	donetadv: 'uplink',
	loadbalancers: 'uplink',
	dodns: 'decoder',
	certificates: 'shield',
	inference: 'neural',
	domonitoring: 'heartbeat',
	dosecrets: 'vault',
	security: 'radar',
	doaccount: 'gauges',
	doteam: 'vault',
	dosupport: 'ledger',
	cfhome: 'globe',
	cforgs: 'globe',
	cfprofile: 'vault',
	cfdomains: 'globe',
	cfbuild: 'neural',
	cfprotect: 'shield',
	cfzt: 'tunnel',
	cfdev: 'stack',
	cfaccount: 'gauges',
	cfoverview: 'globe',
	cfaicrawl: 'lens',
	cfagent: 'lens',
	cfanalytics: 'gauges',
	cfobs: 'waterfall',
	dns: 'decoder',
	cfemail: 'decoder',
	cfssl: 'shield',
	cfwaf: 'shield',
	cfbots: 'shield',
	cfaccess: 'tunnel',
	cfspeed: 'edge',
	cfcache: 'edge',
	cfroutes: 'edge',
	cfrules: 'edge',
	cferror: 'edge',
	cfnetwork: 'globe',
	cftraffic: 'globe',
	cfweb3: 'globe',
	payments: 'ledger',
	messages: 'uplink',
	clients: 'diff',
	seo: 'lens',
	access: 'vault',
	audit: 'ledger',
	privacy: 'ledger',
	costs: 'gauges',
	domains: 'decoder',
	overview: 'gauges',
	settings: 'vault',
};

/** A console or project page → its loader. */
export const LOADER_OF_PAGE: Readonly<Record<string, string>> = {
	projects: 'boot',
	add: 'boot',
	attention: 'gauges',
	audit: 'ledger',
	overview: 'gauges',
	settings: 'vault',
	connections: 'vault',
	repositories: 'stack',
	environments: 'stack',
	menus: 'stack',
	remove: 'vault',
};

export const loaderArt = (id: string): LoaderArt => LOADERS.find((l) => l.id === id) ?? (LOADERS[0] as LoaderArt);
