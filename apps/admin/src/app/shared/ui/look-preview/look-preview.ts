import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/** One value as the preview draws it. */
export interface LookPreviewValue {
	label: string;
	/** The second line (`size_v2`). */
	subLabel?: string | null;
	hex?: string | null;
	/** The swatch file the shop draws; null draws the grey placeholder. */
	picture?: string | null;
	/** Rupees the value adds, shown by the looks that show a price. */
	price?: number | null;
}

const RADIO_LOOKS = new Set(['radio', 'radio_bar']);
const COLOUR_LOOKS = new Set(['color_swatch', 'colour_chip']);
const PICTURE_LOOKS = new Set(['image_swatch', 'image_tile', 'picture_row', 'picture_chip']);
/** Looks that show only the colour or picture; the name is on hover, as in the shop. */
const NAMELESS_LOOKS = new Set(['image_swatch', 'color_swatch']);
const PRICED_LOOKS = new Set(['image_tile', 'radio_bar', 'picture_row']);
/** How many values a preview draws. */
const SHOWN = 6;

/**
 * Admin's live preview of an option look (owner, 21 Nov 2026, product page brief A5): under the look choice, a sketch
 * in plain admin colours of how the shop shows the values on hand, the first drawn as chosen. It is the element's
 * shape, not the shop's styling, and it changes as soon as another look is picked.
 */
@Component({
	selector: 'app-look-preview',
	templateUrl: './look-preview.html',
	styleUrls: ['./look-preview.scss'],
	imports: [TranslocoModule, DecimalPipe],
})
export class LookPreview {
	readonly look = input.required<string>();
	readonly values = input<readonly LookPreviewValue[]>([]);
	/** The note on the heading's right ("changes as you pick a style"). */
	readonly note = input<string>('');
	/** The line under the sketch. */
	readonly help = input<string>('');

	readonly shown = computed(() => this.values().slice(0, SHOWN));
	readonly radio = computed(() => RADIO_LOOKS.has(this.look()));
	readonly colour = computed(() => COLOUR_LOOKS.has(this.look()));
	readonly picture = computed(() => PICTURE_LOOKS.has(this.look()));
	readonly named = computed(() => !NAMELESS_LOOKS.has(this.look()));
	readonly priced = computed(() => PRICED_LOOKS.has(this.look()));
}
