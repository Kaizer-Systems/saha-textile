import { Component, computed, input } from '@angular/core';

/** One section of a layout's outline picture. */
export interface PbOutlineItem {
	type: string;
	arrangement?: string | null;
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	kind: 'hi' | 'lo' | 'bar' | 'crd';
}

const W = 200;

/** Boxes for one section, drawn from the top `y`; answers the boxes and the height used. */
function sectionBoxes(item: PbOutlineItem, y: number): { boxes: Box[]; height: number } {
	const boxes: Box[] = [];
	const cards = (count: number, h: number) => {
		const gap = 4;
		const w = (W - 16 - gap * (count - 1)) / count;
		for (let i = 0; i < count; i++) boxes.push({ x: 8 + i * (w + gap), y, w, h, kind: 'crd' });
	};
	switch (item.type) {
		case 'banner_arrangement': {
			const h = 38;
			if (item.arrangement === 'hero_main_side')
				boxes.push({ x: 8, y, w: 138, h, kind: 'hi' }, { x: 150, y, w: 42, h, kind: 'lo' });
			else if (item.arrangement === 'hero_main_stack')
				boxes.push(
					{ x: 8, y, w: 124, h, kind: 'hi' },
					{ x: 136, y, w: 56, h: 17, kind: 'lo' },
					{ x: 136, y: y + 21, w: 56, h: 17, kind: 'lo' },
				);
			else if (item.arrangement === 'hero_center_sides')
				boxes.push(
					{ x: 8, y, w: 120, h, kind: 'hi' },
					{ x: 132, y, w: 28, h, kind: 'lo' },
					{ x: 164, y, w: 28, h, kind: 'lo' },
				);
			else boxes.push({ x: 8, y, w: 184, h, kind: 'hi' });
			return { boxes, height: h + 6 };
		}
		case 'promo_banners':
			boxes.push({ x: 8, y, w: 118, h: 22, kind: 'lo' }, { x: 130, y, w: 62, h: 22, kind: 'lo' });
			return { boxes, height: 28 };
		case 'newsletter':
			boxes.push({ x: 8, y, w: 184, h: 14, kind: 'bar' });
			return { boxes, height: 20 };
		default:
			boxes.push({ x: 8, y, w: 60, h: 4, kind: 'bar' });
			cards(5, 14);
			boxes.forEach((box, index) => index > 0 && (box.y += 7));
			return { boxes, height: 27 };
	}
}

/**
 * A layout's outline picture for its card (brief A1; the template outline pictures are an approved custom part):
 * one box per section in order, the banner arrangement drawn in its shape. Pure SVG in the admin's own colours.
 */
@Component({
	selector: 'app-pb-thumb',
	template: `
		<svg
			class="pb-thumb"
			[attr.viewBox]="'0 0 ' + width + ' ' + height()"
			aria-hidden="true"
		>
			<rect
				class="bg"
				[attr.width]="width"
				[attr.height]="height()"
				rx="8"
			/>
			@for (box of boxes(); track $index) {
				<rect
					[attr.class]="box.kind"
					[attr.x]="box.x"
					[attr.y]="box.y"
					[attr.width]="box.w"
					[attr.height]="box.h"
					rx="3"
				/>
			}
		</svg>
	`,
})
export class PbThumb {
	readonly outline = input.required<readonly PbOutlineItem[]>();
	readonly width = W;
	private readonly drawn = computed(() => {
		let y = 8;
		const boxes: Box[] = [];
		for (const item of this.outline().slice(0, 9)) {
			const section = sectionBoxes(item, y);
			boxes.push(...section.boxes);
			y += section.height;
		}
		return { boxes, height: Math.max(y + 2, 60) };
	});
	readonly boxes = computed(() => this.drawn().boxes);
	readonly height = computed(() => this.drawn().height);
}
