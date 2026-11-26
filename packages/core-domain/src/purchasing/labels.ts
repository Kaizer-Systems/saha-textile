/**
 * Barcode label sheets (l01, P10): A4 sheets holding many labels and many items, the first free
 * label chosen on a part-used sheet, and Code 128 barcodes drawn as bars. Pure geometry and
 * encoding, used by the API's PDF and by the admin's on-screen preview so they always agree.
 */

export type LabelSheetKind = 'a4_65' | 'a4_40' | 'a4_24' | 'a4_21';

export interface LabelSheetGeometry {
	kind: LabelSheetKind;
	columns: number;
	rows: number;
	/** Label size and the gaps between labels, in millimetres. */
	widthMm: number;
	heightMm: number;
	gapXMm: number;
	gapYMm: number;
	/** Distance from the sheet's top-left corner to the first label. */
	topMm: number;
	leftMm: number;
}

const A4 = { widthMm: 210, heightMm: 297 };

/** Common A4 label stock sizes (the 65, 40, 24 and 21 per sheet layouts), centred on the page. */
function sheet(
	kind: LabelSheetKind,
	columns: number,
	rows: number,
	widthMm: number,
	heightMm: number,
	gapXMm: number,
): LabelSheetGeometry {
	const gapYMm = 0;
	return {
		kind,
		columns,
		rows,
		widthMm,
		heightMm,
		gapXMm,
		gapYMm,
		leftMm: Math.round(((A4.widthMm - (columns * widthMm + (columns - 1) * gapXMm)) / 2) * 100) / 100,
		topMm: Math.round(((A4.heightMm - (rows * heightMm + (rows - 1) * gapYMm)) / 2) * 100) / 100,
	};
}

export const LABEL_SHEETS: Readonly<Record<LabelSheetKind, LabelSheetGeometry>> = {
	a4_65: sheet('a4_65', 5, 13, 38.1, 21.2, 2.5),
	a4_40: sheet('a4_40', 4, 10, 45.7, 25.4, 2.6),
	a4_24: sheet('a4_24', 3, 8, 63.5, 33.9, 2.5),
	a4_21: sheet('a4_21', 3, 7, 63.5, 38.1, 2.5),
};

export const labelsPerSheet = (kind: LabelSheetKind): number => LABEL_SHEETS[kind].columns * LABEL_SHEETS[kind].rows;

export interface LabelSlot {
	/** Which sheet, from 0. */
	sheet: number;
	/** Position on its sheet, counted across then down from 1 (as "Start at label" counts). */
	position: number;
	xMm: number;
	yMm: number;
}

/**
 * Where `count` labels go, starting at label `startAt` of the first sheet (labels before it are
 * already used); later sheets start at their first label.
 */
export function labelSlots(kind: LabelSheetKind, startAt: number, count: number): LabelSlot[] {
	const geometry = LABEL_SHEETS[kind];
	const perSheet = labelsPerSheet(kind);
	const first = Math.min(Math.max(1, Math.floor(startAt)), perSheet);
	const slots: LabelSlot[] = [];
	for (let i = 0; i < count; i += 1) {
		const absolute = first - 1 + i;
		const sheetIndex = Math.floor(absolute / perSheet);
		const position = (absolute % perSheet) + 1;
		const column = (position - 1) % geometry.columns;
		const row = Math.floor((position - 1) / geometry.columns);
		slots.push({
			sheet: sheetIndex,
			position,
			xMm: Math.round((geometry.leftMm + column * (geometry.widthMm + geometry.gapXMm)) * 100) / 100,
			yMm: Math.round((geometry.topMm + row * (geometry.heightMm + geometry.gapYMm)) * 100) / 100,
		});
	}
	return slots;
}

/** How many sheets `count` labels need from label `startAt`. */
export function sheetsNeeded(kind: LabelSheetKind, startAt: number, count: number): number {
	if (count <= 0) return 0;
	const perSheet = labelsPerSheet(kind);
	const first = Math.min(Math.max(1, Math.floor(startAt)), perSheet);
	return Math.ceil((first - 1 + count) / perSheet);
}

/* ------------------------------------------------------------------ Code 128 */

/** Bar and space widths (in modules) for Code 128 values 0–106; 106 is the stop pattern. */
const PATTERNS = [
	'212222',
	'222122',
	'222221',
	'121223',
	'121322',
	'131222',
	'122213',
	'122312',
	'132212',
	'221213',
	'221312',
	'231212',
	'112232',
	'122132',
	'122231',
	'113222',
	'123122',
	'123221',
	'223211',
	'221132',
	'221231',
	'213212',
	'223112',
	'312131',
	'311222',
	'321122',
	'321221',
	'312212',
	'322112',
	'322211',
	'212123',
	'212321',
	'232121',
	'111323',
	'131123',
	'131321',
	'112313',
	'132113',
	'132311',
	'211313',
	'231113',
	'231311',
	'112133',
	'112331',
	'132131',
	'113123',
	'113321',
	'133121',
	'313121',
	'211331',
	'231131',
	'213113',
	'213311',
	'213131',
	'311123',
	'311321',
	'331121',
	'312113',
	'312311',
	'332111',
	'314111',
	'221411',
	'431111',
	'111224',
	'111422',
	'121124',
	'121421',
	'141122',
	'141221',
	'112214',
	'112412',
	'122114',
	'122411',
	'142112',
	'142211',
	'241211',
	'221114',
	'413111',
	'241112',
	'134111',
	'111242',
	'121142',
	'121241',
	'114212',
	'124112',
	'124211',
	'411212',
	'421112',
	'421211',
	'212141',
	'214121',
	'412121',
	'111143',
	'111341',
	'131141',
	'114113',
	'114311',
	'411113',
	'411311',
	'113141',
	'114131',
	'311141',
	'411131',
	'211412',
	'211214',
	'211232',
	'2331112',
] as const;

export const CODE128_PATTERNS: readonly string[] = PATTERNS;

const START_B = 104;
const STOP = 106;

/** Whether text can be drawn in Code 128 set B (printable ASCII: SKUs, codes). */
export const code128Encodable = (text: string): boolean => text.length > 0 && /^[\x20-\x7e]+$/.test(text);

/**
 * Code 128 (set B) for `text`: the values with their check value, and the run widths starting
 * with a bar (bar, space, bar, …), quiet zones not included. Throws for text outside set B.
 */
export function code128(text: string): { values: number[]; runs: number[]; modules: number } {
	if (!code128Encodable(text)) throw new Error('Code 128 set B takes printable ASCII only');
	const data = [...text].map((char) => char.charCodeAt(0) - 32);
	const check = (START_B + data.reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;
	const values = [START_B, ...data, check, STOP];
	// Every value is 0–106 (set B data, its check value, start and stop), and PATTERNS has all 107.
	const runs = values.flatMap((value) => [...(PATTERNS[value] as string)].map(Number));
	return { values, runs, modules: runs.reduce((sum, width) => sum + width, 0) };
}

/** The bars as rectangles in modules (x and width), for an SVG of any size. */
export function code128Bars(text: string): { bars: Array<{ x: number; width: number }>; modules: number } {
	const { runs, modules } = code128(text);
	const bars: Array<{ x: number; width: number }> = [];
	let x = 0;
	runs.forEach((width, index) => {
		if (index % 2 === 0) bars.push({ x, width });
		x += width;
	});
	return { bars, modules };
}
