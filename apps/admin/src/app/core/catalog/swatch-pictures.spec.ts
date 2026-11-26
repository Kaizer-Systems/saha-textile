import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Subject, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { AuthStore } from '@core/state/auth.store';

import { SwatchPictures, swatchFile } from './swatch-pictures';

import type { MediaFileDetails } from '@saha-textile/contracts';

const squares = (name: string) => ({
	role: 'swatch_image',
	files: [80, 160, 240].map((width) => ({
		width,
		height: width,
		bytes: 1,
		format: 'webp',
		url: `${name}-${width}.webp`,
	})),
});
const version = (id: string, state: 'ready' | 'making' = 'ready', withSquares = true) => ({
	id,
	profileKey: 'product_3x4',
	fill: id.split('.')[1] ?? 'as_is',
	state,
	error: null,
	createdAt: '2026-11-21T00:00:00.000Z',
	bytes: 1,
	families: withSquares ? [{ role: 'card', files: [] }, squares(id)] : [{ role: 'card', files: [] }],
});
const details = (...versions: ReturnType<typeof version>[]) => ({ versions }) as unknown as MediaFileDetails;

describe('swatchFile', () => {
	it('draws the chosen version’s square, at the size the preview reads', () => {
		const photo = details(version('product_3x4.as_is'), version('product_3x4.crop'));
		expect(swatchFile(photo, 'product_3x4.crop')).toBe('product_3x4.crop-160.webp');
	});

	it('falls back, as the shop does, to the first ready version with a square', () => {
		const photo = details(
			version('product_3x4.white', 'ready', false),
			version('product_3x4.as_is'),
			version('product_3x4.crop', 'making'),
		);
		expect(swatchFile(photo, null)).toBe('product_3x4.as_is-160.webp');
		expect(swatchFile(photo, 'product_3x4.crop')).toBe('product_3x4.as_is-160.webp');
		expect(swatchFile(photo, 'product_3x4.white')).toBe('product_3x4.as_is-160.webp');
		expect(swatchFile(details(), null)).toBeNull();
	});

	it('takes the largest square when none is big enough', () => {
		const small = details({
			...version('product_3x4.as_is'),
			families: [
				{
					role: 'swatch_image',
					files: [{ width: 80, height: 80, bytes: 1, format: 'webp', url: 's-80.webp' }],
				},
			],
		} as never);
		expect(swatchFile(small)).toBe('s-80.webp');
	});
});

describe('SwatchPictures', () => {
	const service = (details?: (id: string) => unknown, permissions = ['attachment.index']) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
				...(details ? [{ provide: MediaLibraryGateway, useValue: { details } }] : []),
			],
		});
		return TestBed.inject(SwatchPictures);
	};

	it('reads each photo once and answers with its square once read', () => {
		const answers = new Subject<MediaFileDetails>();
		let asked = 0;
		const pictures = service(() => {
			asked++;
			return answers;
		});
		pictures.need(['a', 'a']);
		expect(asked).toBe(1);
		expect(pictures.url('a')).toBeNull();
		answers.next(details(version('product_3x4.as_is'), version('product_3x4.crop')));
		expect(pictures.url('a')).toBe('product_3x4.as_is-160.webp');
		expect(pictures.url('a', 'product_3x4.crop')).toBe('product_3x4.crop-160.webp');
		pictures.need(['a']);
		expect(asked).toBe(1);
	});

	it('answers null for a photo it cannot read, and with no media library at all', () => {
		const failing = service(() => throwError(() => new Error('gone')));
		failing.need(['x']);
		expect(failing.url('x')).toBeNull();
		const bare = service();
		bare.need(['y']);
		expect(bare.url('y')).toBeNull();
	});

	it('asks nothing for someone who may not open the Media Library', () => {
		let asked = 0;
		const pictures = service(() => {
			asked++;
			return new Subject<MediaFileDetails>();
		}, ['catalog.product.edit']);
		pictures.need(['a']);
		expect(asked).toBe(0);
		expect(pictures.url('a')).toBeNull();
	});
});
