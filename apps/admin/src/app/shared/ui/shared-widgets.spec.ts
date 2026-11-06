import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';
import { LoaderStore } from '@core/state/loader.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Alert } from './alert/alert';
import { Button } from './button/button';
import { FeatherIcons } from './feather-icons/feather-icons';
import { FormFields } from './form-fields/form-fields';
import { ImageUpload } from './image-upload/image-upload';
import { Link } from './link/link';
import { MediaBox } from './media-box/media-box';
import { NoData } from './no-data/no-data';
import { Pagination } from './pagination/pagination';
import { PinPad } from './pin-pad/pin-pad';
import { Addtocart } from './product-box/modal/addtocart/addtocart';
import { ProductBox } from './product-box/product-box';
import { SidebarMenuSkeleton } from './skeleton/sidebar-menu-skeleton/sidebar-menu-skeleton';
import { YouTubeVideoField } from './youtube-video-field/youtube-video-field';

const attachments = signal<unknown>(undefined);
const fetching = signal(false);
const categories = signal<unknown>(undefined);
vi.mock('@data-access/queries/attachment.queries', () => ({
	injectAttachmentsQuery: (params: () => unknown) => {
		params();
		return { data: attachments, isFetching: fetching };
	},
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data: categories };
	},
}));

const feather = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('feather-icons', () => ({ ...feather, default: feather }));

const bare = <T>(type: new () => T, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type);
};

afterEach(() => {
	attachments.set(undefined);
	categories.set(undefined);
	fetching.set(false);
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
});

describe('display components', () => {
	it.each<[string, new () => unknown]>([
		['FormFields', FormFields],
		['NoData', NoData],
		['SidebarMenuSkeleton', SidebarMenuSkeleton],
	])('%s can be created', (_name, type) => {
		expect(bare(type).componentInstance).toBeInstanceOf(type);
	});

	it('draws the feather icons', () => {
		const fixture = bare(FeatherIcons);
		fixture.detectChanges();
		expect(feather.replace).toHaveBeenCalled();
	});
});

describe('Alert', () => {
	it('shows the latest alert and turns toasts back on when it leaves', () => {
		const service = { alertSubject: new Subject(), notification: false };
		const fixture = bare(Alert, [{ provide: NotificationService, useValue: service }]);
		service.alertSubject.next({ type: 'error', message: 'No' });
		expect(fixture.componentInstance.alert).toEqual({ type: 'error', message: 'No' });
		fixture.destroy();
		expect(service.notification).toBe(true);
	});
});

describe('Button', () => {
	it('remembers the pressed button until the spinner stops', () => {
		const buttonSpinner = signal(true);
		const button = bare(Button, [{ provide: LoaderStore, useValue: { buttonSpinner } }]).componentInstance;
		TestBed.tick();
		button.onClick('save');
		TestBed.tick();
		expect(button.buttonId).toBe('save');
		buttonSpinner.set(false);
		TestBed.tick();
		expect(button.buttonId).toBeNull();
	});
});

describe('Pagination', () => {
	const pager = () => bare(Pagination).componentInstance;

	it.each([
		['fits', 24, 1, 12, [1, 2]],
		['start', 100, 1, 10, [1, 2, 3]],
		['middle', 100, 5, 10, [4, 5, 6]],
		['end', 100, 10, 10, [8, 9, 10]],
		['below one', 100, 0, 10, [1, 2, 3]],
		['past the end', 100, 99, 10, [8, 9, 10]],
	])('%s', (_name, total, page, size, pages) => {
		expect(pager().getPager(total, page, size).pages).toEqual(pages);
	});

	it('recomputes on changes and emits the page', () => {
		const instance = pager();
		instance.ngOnChanges({
			total: { currentValue: 100 },
			currentPage: { currentValue: 5 },
			pageSize: { currentValue: 10 },
		} as never);
		expect(instance.paginate.pages).toEqual([4, 5, 6]);
		instance.ngOnChanges({});
		expect(instance.paginate.totalItems).toBe(100);
		const seen: number[] = [];
		instance.setPage.subscribe((page) => seen.push(page));
		instance.pageSet(2);
		expect(seen).toEqual([2]);
	});
});

describe('PinPad', () => {
	const pad = (length = 3) => {
		const fixture = bare(PinPad);
		fixture.componentRef.setInput('length', length);
		const seen: string[] = [];
		fixture.componentInstance.completed.subscribe((value) => seen.push(value));
		return { pad: fixture.componentInstance, seen };
	};
	const key = (name: string, extra: Record<string, unknown> = {}) =>
		({ key: name, target: document.body, preventDefault: vi.fn(), ...extra }) as never;

	it('fills the cells and completes once', () => {
		vi.useFakeTimers();
		const { pad: widget, seen } = pad();
		widget.append('1');
		widget.append('2');
		expect(widget.cells()).toEqual([true, true, false]);
		widget.append('3');
		expect(seen).toEqual(['123']);
		widget.append('4');
		expect(widget.value()).toBe('123');
		expect(widget.isComplete()).toBe(true);
	});

	it('flashes the pressed key, keeping the newest', () => {
		vi.useFakeTimers();
		const { pad: widget } = pad();
		widget.append('1');
		expect(widget.isPressed('1')).toBe(true);
		vi.advanceTimersByTime(100);
		widget.append('2');
		vi.advanceTimersByTime(50);
		expect(widget.isPressed('2')).toBe(true);
		vi.advanceTimersByTime(100);
		expect(widget.isPressed('2')).toBe(false);
	});

	it('handles digits, backspace and escape from the keyboard', () => {
		vi.useFakeTimers();
		const { pad: widget } = pad();
		widget.handleKeydown(key('1'));
		widget.handleKeydown(key('2'));
		widget.handleKeydown(key('Backspace'));
		expect(widget.value()).toBe('1');
		widget.handleKeydown(key('Escape'));
		expect(widget.value()).toBe('');
		widget.handleKeydown(key('a'));
		expect(widget.value()).toBe('');
	});

	it('leaves shortcuts and text boxes alone', () => {
		vi.useFakeTimers();
		const { pad: widget } = pad();
		widget.handleKeydown(key('1', { ctrlKey: true }));
		widget.handleKeydown(key('1', { metaKey: true }));
		widget.handleKeydown(key('1', { altKey: true }));
		for (const tag of ['input', 'textarea', 'select']) {
			widget.handleKeydown(key('1', { target: document.createElement(tag) }));
		}
		const editable = document.createElement('div');
		Object.defineProperty(editable, 'isContentEditable', { value: true });
		widget.handleKeydown(key('1', { target: editable }));
		expect(widget.value()).toBe('');
		widget.handleKeydown(key('1', { target: document }));
		expect(widget.value()).toBe('1');
	});
});

describe('ImageUpload', () => {
	const upload = () => {
		const widget = bare(ImageUpload).componentInstance;
		const seen: unknown[] = [];
		widget.selectedFiles.subscribe((value) => seen.push(value));
		return { widget, seen };
	};

	it('shows what it is given', () => {
		const { widget } = upload();
		widget.image = { id: 1 } as never;
		widget.imageUrl = 'x';
		widget.ngOnChanges();
		expect(widget.showImage).toEqual({ id: 1 });
		expect(widget.showImageUrl).toBe('x');
	});

	it('takes a list, a URL or a single image', () => {
		const { widget, seen } = upload();
		widget.selectImage([{ id: 1 }] as never, false);
		expect(seen.at(-1)).toEqual([{ id: 1 }]);
		widget.images = [];
		widget.selectImage({ id: 2 } as never, false);
		expect(seen.at(-1)).toEqual({ id: 2 });
		widget.selectImage({ original_url: 'u' } as never, true);
		expect(seen.at(-1)).toBe('u');
	});

	it('removes by kind', () => {
		const { widget, seen } = upload();
		widget.images = [{ id: 1 }, { id: 2 }] as never;
		widget.remove(0, 'multiple');
		expect(seen.at(-1)).toEqual([{ id: 2 }]);
		widget.images = [];
		widget.imageUrl = 'u';
		widget.remove(0, 'single_image_url');
		expect(widget.showImageUrl).toBeNull();
		widget.image = { id: 1 } as never;
		widget.remove(0, 'single');
		expect(widget.showImage).toBeNull();
		expect(seen.at(-1)).toBeNull();
		widget.images = '' as never;
		widget.remove(0, 'multiple');
		expect(widget.image).toBeNull();
	});
});

describe('YouTubeVideoField', () => {
	const render = (value: string | null = null) => {
		const gateway = { validate: vi.fn(() => of<unknown>({ title: 'Video', videoId: 'abc' })) };
		const fixture = bare(YouTubeVideoField, [{ provide: YouTubeGateway, useValue: gateway }]);
		const control = new FormControl<string | null>(value);
		fixture.componentRef.setInput('control', control);
		return { fixture, field: fixture.componentInstance, gateway, control };
	};

	it('checks a value already saved', async () => {
		const { fixture, field, gateway } = render('abc');
		fixture.detectChanges();
		await fixture.whenStable();
		expect(gateway.validate).toHaveBeenCalledWith('abc');
		expect(field.matchedTitle()).toBe('Video');
	});

	it('starts empty', () => {
		const { fixture, gateway } = render();
		fixture.detectChanges();
		expect(gateway.validate).not.toHaveBeenCalled();
	});

	it('blocks the form until a typed value is checked', () => {
		const { field, control } = render();
		field.edit('abc');
		expect(control.errors).toEqual({ youtubeNotValidated: true });
		field.edit('  ');
		expect(control.errors).toBeNull();
	});

	it('does not check an empty box', async () => {
		const { field, gateway } = render();
		await field.validate();
		expect(gateway.validate).not.toHaveBeenCalled();
	});

	it('shows a refusal, or the generic message', async () => {
		const { field, gateway, control } = render();
		field.text.set('abc');
		gateway.validate.mockReturnValueOnce(throwError(() => ({ error: { message: 'Not found' } })));
		await field.validate();
		expect(field.error()).toBe('Not found');
		expect(control.errors).toEqual({ youtubeNotValidated: true });
		gateway.validate.mockReturnValueOnce(throwError(() => new Error('down')));
		await field.validate();
		expect(field.error()).toBe('The video could not be checked.');
		expect(field.checking()).toBe(false);
	});
});

describe('MediaBox', () => {
	const render = () => {
		const fixture = bare(MediaBox);
		fixture.detectChanges();
		TestBed.tick();
		const box = fixture.componentInstance;
		const images: unknown[] = [];
		box.setImage.subscribe((value) => images.push(value));
		const deleted: unknown[] = [];
		box.setDeleteImage.subscribe((value) => deleted.push(value));
		return { fixture, box, images, deleted };
	};
	const event = (checked: boolean, value = '1') => ({ target: { checked, value } }) as never;

	it('follows the query', async () => {
		const { box } = render();
		attachments.set({ total: 3 });
		fetching.set(true);
		TestBed.tick();
		expect(box.totalItems).toBe(3);
		expect(box.loading).toBe(true);
		expect(await firstValueFrom(box.attachment$)).toEqual({ total: 3 });
	});

	it('searches after a pause, sorts and pages', () => {
		vi.useFakeTimers();
		const { box } = render();
		box.term.setValue('silk');
		vi.advanceTimersByTime(400);
		expect(box.filter.search).toBe('silk');
		box.onMediaChange({ target: { value: 'newest' } } as never);
		expect(box.filter.sort).toBe('newest');
		box.setPaginate(2);
		expect(box.filter.page).toBe(2);
		expect(document.body.classList.contains('loader-none')).toBe(true);
	});

	it('keeps the page loader when asked', () => {
		const { box } = render();
		box.getAttachments({}, true);
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});

	it('reports a delete only', () => {
		const { box, deleted } = render();
		box.onActionClicked('edit', { id: 1 } as never);
		box.onActionClicked('delete', { id: 1 } as never);
		expect(deleted).toEqual([1]);
	});

	it('selects one image', () => {
		const { box, images } = render();
		box.selectImage(event(true), { id: 1 } as never, false);
		expect(images.at(-1)).toEqual({ id: 1 });
	});

	it('selects several, and unselects', () => {
		const { fixture, box } = render();
		fixture.componentRef.setInput('multiple', true);
		const one = { id: 1 } as never;
		box.selectImage(event(true), one, false);
		box.selectImage(event(true), one, false);
		expect(box.selectedImages).toEqual([{ id: 1 }]);
		box.selectImage(event(false), one, false);
		expect(box.selectedImages).toEqual([]);
	});

	it('takes the image itself in URL mode', () => {
		const { box } = render();
		box.selectImage(event(true), { id: 1 } as never, true);
		expect(box.selectedImages).toEqual({ id: 1 });
	});

	it('removes the body class when leaving', () => {
		const { fixture } = render();
		document.body.classList.add('loader-none');
		fixture.destroy();
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});

describe('Link', () => {
	const render = () => {
		const fixture = bare(Link);
		fixture.detectChanges();
		TestBed.tick();
		return { fixture, link: fixture.componentInstance };
	};

	it('falls back when a category icon has an empty address', () => {
		const { link } = render();
		categories.set({ data: [{ id: 1, name: 'Silk', slug: 'silk', category_icon: { original_url: '' } }] });
		TestBed.tick();
		expect(link.categories).toMatchObject([{ data: { image: 'assets/images/product.png' } }]);
	});

	it('lists the categories, using a fallback image', () => {
		const { link } = render();
		categories.set({
			data: [
				{ id: 1, name: 'Silk', slug: 'silk', category_icon: { original_url: 'i.png' } },
				{ id: 2, name: 'Cotton', slug: 'cotton' },
			],
		});
		TestBed.tick();
		expect(link.categories).toMatchObject([
			{ value: 'silk', data: { image: 'i.png' } },
			{ value: 'cotton', data: { image: 'assets/images/category.png' } },
		]);
	});

	it('stores the chosen product', () => {
		const { fixture, link } = render();
		const setValue = vi.fn();
		fixture.componentRef.setInput('linkForm', { get: () => ({ setValue }) });
		link.selectProduct({ value: 3 } as never);
		expect(setValue).toHaveBeenCalledWith(3);
		link.selectProduct(undefined as never);
		expect(setValue).toHaveBeenLastCalledWith(undefined);
	});

	it('copes with no form', () => {
		const { link } = render();
		expect(() => link.selectProduct({ value: 3 } as never)).not.toThrow();
	});

	it('searches after a pause and resets a closed search', () => {
		vi.useFakeTimers();
		const { link } = render();
		const seen: unknown[] = [];
		link.productFilter.subscribe((value) => seen.push({ ...value }));
		link.searchProduct({ search: 'silk' } as never);
		vi.advanceTimersByTime(300);
		expect(seen.at(-1)).toMatchObject({ search: 'silk' });
		link.productDropdown({ innerSearchText: 'x' } as never);
		vi.advanceTimersByTime(300);
		expect(seen.at(-1)).toMatchObject({ search: '' });
		const count = seen.length;
		link.productDropdown({ innerSearchText: '' } as never);
		expect(seen.length).toBe(count);
	});

	it('has a no-op image hook and cleans up', () => {
		const { fixture, link } = render();
		expect(link.selectImageLink()).toBeUndefined();
		expect(() => fixture.destroy()).not.toThrow();
	});
});

describe('ProductBox', () => {
	const render = (product?: unknown) => {
		const items = new BehaviorSubject<unknown[]>([]);
		const store = { select: () => items, dispatch: vi.fn() };
		const fixture = bare(ProductBox, [{ provide: Store, useValue: store }]);
		if (product) fixture.componentRef.setInput('product', product);
		fixture.detectChanges();
		return { box: fixture.componentInstance, items, store };
	};

	it('finds its line, or none', () => {
		const { box, items } = render({ id: 7 });
		expect(box.cartItem).toBeNull();
		items.next([{ id: 'line', product: { id: 7 } }]);
		expect(box.cartItem).toMatchObject({ id: 'line' });
		expect(render().box.cartItem).toBeNull();
	});

	it('adds a new line, or to the existing one', () => {
		const { box, store } = render({ id: 7 });
		box.addToCart({ id: 7 } as never, 1);
		expect(store.dispatch.mock.lastCall?.[0].payload).toMatchObject({ id: null, quantity: 1 });
		box.cartItem = { id: 'line' } as never;
		box.addToCart({ id: 7 } as never, 2);
		expect(store.dispatch.mock.lastCall?.[0].payload).toMatchObject({ id: 'line', quantity: 2 });
	});
});

describe('Addtocart', () => {
	const render = (result: Promise<unknown> = Promise.resolve('closed')) => {
		const store = { dispatch: vi.fn() };
		const modal = { open: vi.fn(() => ({ result })), dismissAll: vi.fn() };
		const fixture = bare(Addtocart, [
			{ provide: Store, useValue: store },
			{ provide: NgbModal, useValue: modal },
		]);
		return { dialog: fixture.componentInstance, store, modal };
	};
	const red = { id: 1, attribute_id: 1 };
	const small = { id: 2, attribute_id: 2 };
	const variation = () => ({ id: 9, quantity: 2, stock_status: 'in_stock', attribute_values: [red, small] });
	const settle = async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	};

	it('opens and gathers the attribute values once', async () => {
		const { dialog, modal } = render();
		await dialog.openModal({ variations: [variation(), variation()] } as never);
		await settle();
		expect(modal.open).toHaveBeenCalledOnce();
		expect(dialog.attributeValues).toEqual([1, 2]);
		expect(dialog.closeResult).toBe('Closed with: closed');
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { dialog } = render(Promise.reject(reason));
		await dialog.openModal({} as never);
		await settle();
		expect(dialog.closeResult).toBe(text);
	});

	it('copes with a variation with no values', () => {
		const { dialog } = render();
		dialog.checkVariantAvailability({ variations: [{}] } as never);
		expect(dialog.attributeValues).toEqual([]);
		dialog.checkVariantAvailability(undefined as never);
	});

	it('finds the variation for the chosen values', () => {
		const { dialog } = render();
		const row = variation();
		dialog.setVariant([row] as never, red as never);
		expect(dialog.selectedVariation).toBeUndefined();
		dialog.setVariant([row] as never, small as never);
		expect(dialog.selectedVariation).toBe(row);
		dialog.setVariant([row] as never, { id: 3, attribute_id: 2 } as never);
		expect(dialog.selectedOptions).toHaveLength(2);
		dialog.setVariant(undefined as never, red as never);
	});

	it('tracks stock against the quantity, and never goes below one', () => {
		const { dialog } = render();
		dialog.updateQuantity(-1);
		expect(dialog.productQty).toBe(1);
		dialog.updateQuantity(1);
		const row = variation();
		dialog.selectedVariation = row as never;
		dialog.updateQuantity(1);
		expect(row.stock_status).toBe('out_of_stock');
		dialog.updateQuantity(-1);
		expect(row.stock_status).toBe('in_stock');
	});

	it('adds only with a variation chosen', () => {
		const { dialog, store, modal } = render();
		dialog.addToCart({ id: 7 } as never);
		expect(store.dispatch).not.toHaveBeenCalled();
		dialog.selectedVariation = variation() as never;
		dialog.addToCart({ id: 7 } as never);
		expect(store.dispatch).toHaveBeenCalledOnce();
		expect(modal.dismissAll).toHaveBeenCalledOnce();
	});
});
