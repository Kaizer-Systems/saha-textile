import { Location } from '@angular/common';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaGateway } from '@core/media/media.gateway';
import { SettingStore } from '@core/state/setting.store';
import { NotificationService } from '@data-access/services/notification.service';
import { QuestionsAnswersService } from '@data-access/services/questions-answers.service';
import { ShippingService } from '@data-access/services/shipping.service';

import { Category } from './category/category';
import { EditCategory } from './category/edit-category/edit-category';
import { Tree } from './category/tree/tree';
import { TreeNode } from './category/tree/tree-node/tree-node';
import { Error403 } from './errors/error403/error403';
import { Error404 } from './errors/error404/error404';
import { Media } from './media/media';
import { Notification } from './notification/notification';
import { AnswersModal } from './questions-answers/answers-modal/answers-modal';
import { FormShipping } from './shipping/form-shipping/form-shipping';
import { ShippingCountryModal } from './shipping/modal/shipping-country-modal/shipping-country-modal';
import { ShippingRuleModal } from './shipping/modal/shipping-rule-modal/shipping-rule-modal';
import { Shipping } from './shipping/shipping';
import { ShippingCountry } from './shipping/shipping-country/shipping-country';
import { CreateTag } from './tag/create-tag/create-tag';
import { EditTag } from './tag/edit-tag/edit-tag';

const categories = signal<unknown>(undefined);
const notifications = signal<unknown>(undefined);
const shippings = signal<unknown>(undefined);
const countries = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data: categories };
	},
}));
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: notifications }),
}));
vi.mock('@data-access/queries/shipping.queries', () => ({
	injectShippingsQuery: (params: () => unknown) => {
		params();
		return { data: shippings };
	},
}));
vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: countries }) }));

const bare = <T>(type: Type<T>, providers: unknown[] = [], template = '') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template } });
	return TestBed.createComponent(type);
};
const settings = { provide: SettingStore, useValue: { setting: signal(null) } };
const reasons: [unknown, string][] = [
	[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
	[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
	['cross', 'Dismissed with: cross'],
];
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

afterEach(() => {
	categories.set(undefined);
	notifications.set(undefined);
	shippings.set(undefined);
	countries.set(undefined);
});

describe('simple screens', () => {
	it('creates the wrappers', async () => {
		expect(bare(EditCategory).componentInstance).toBeInstanceOf(EditCategory);
		expect(bare(CreateTag).componentInstance).toBeInstanceOf(CreateTag);
		expect(bare(EditTag).componentInstance).toBeInstanceOf(EditTag);
		const category = bare(Category).componentInstance;
		categories.set({ data: [] });
		TestBed.tick();
		expect(await firstValueFrom(category.category$)).toEqual({ data: [] });
	});

	it.each<[string, Type<Error403>]>([
		['Error403', Error403],
		['Error404', Error404 as Type<Error403>],
	])('%s goes back', (_name, type) => {
		const location = { back: vi.fn() };
		bare(type, [{ provide: Location, useValue: location }]).componentInstance.back();
		expect(location.back).toHaveBeenCalledOnce();
	});

	it('lists the notifications', () => {
		const page = bare(Notification).componentInstance;
		expect(page.notifications()).toEqual([]);
		notifications.set({ data: [{ id: 1 }] });
		expect(page.notifications()).toEqual([{ id: 1 }]);
	});

	it('lists the shipping countries, with a no-op delete', async () => {
		const page = bare(Shipping).componentInstance;
		shippings.set({ data: [] });
		TestBed.tick();
		expect(await firstValueFrom(page.shipping$)).toEqual({ data: [] });
		expect(page.delete('delete', {} as never)).toBeUndefined();
	});
});

describe('Tree', () => {
	const rows = [
		{ id: 1, name: 'Sarees', subcategories: [{ id: 2, name: 'Silk', subcategories: [] }] },
		{ id: 3, name: 'Dress' },
	];
	const render = () => {
		const fixture = bare(Tree);
		fixture.componentRef.setInput('data', rows);
		fixture.componentRef.setInput('recursionKey', 'subcategories');
		fixture.componentInstance.ngOnChanges();
		return fixture.componentInstance;
	};

	it('shows everything, then filters by name or child', () => {
		const tree = render();
		expect(tree.dataToShow).toHaveLength(2);
		tree.treeSearch.setValue('silk');
		expect(tree.dataToShow.map((row) => row.id)).toEqual([1]);
		tree.treeSearch.setValue('dress');
		expect(tree.dataToShow.map((row) => row.id)).toEqual([3]);
		tree.treeSearch.setValue('');
		expect(tree.dataToShow).toHaveLength(2);
	});
});

describe('TreeNode', () => {
	const render = () => {
		const router = { navigateByUrl: vi.fn() };
		const fixture = bare(TreeNode, [
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { params: of({ id: 4 }) } },
		]);
		fixture.detectChanges();
		return { node: fixture.componentInstance, router };
	};

	it('reads the selected id', () => {
		expect(render().node.id).toBe(4);
	});

	it('returns to the right list after a delete', () => {
		const { node, router } = render();
		node.delete('delete', { type: 'post' } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/blog/category');
		node.delete('delete', { type: 'product' } as never);
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/category');
	});
});

describe('ShippingCountry', () => {
	const render = (params: Record<string, unknown>, answer: unknown = of({ data: [{ id: 4 }] })) => {
		const fixture = bare(ShippingCountry, [
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(params) } },
			{ provide: ShippingService, useValue: { getShippings: () => answer } },
		]);
		fixture.detectChanges();
		return { fixture, page: fixture.componentInstance };
	};

	it('finds the country from the address', () => {
		const { page } = render({ id: 4 });
		expect(page.shipping()).toEqual({ id: 4 });
		expect(page.id).toBe(4);
		expect(page.delete('delete', {} as never)).toBeUndefined();
	});

	it('does nothing without an id, and copes with a miss', () => {
		expect(render({}).page.shipping()).toBeUndefined();
		const miss = render({ id: 9 });
		expect(miss.page.id).toBeUndefined();
		expect(() => miss.fixture.destroy()).not.toThrow();
	});
});

describe('FormShipping', () => {
	const render = (data?: unknown) => {
		const dismissAll = vi.fn();
		const fixture = bare(FormShipping, [
			settings,
			{ provide: NgbModal, useValue: { dismissAll } },
			{ provide: ActivatedRoute, useValue: { snapshot: { params: { id: 4 } } } },
		]);
		if (data) fixture.componentRef.setInput('data', data);
		const form = fixture.componentInstance;
		form.ngOnChanges();
		return { form, dismissAll };
	};
	const filled = { name: 'n', rule_type: 'r', min: 1, max: 2, amount: 3 };

	it('starts from the address, and fills from a rule', () => {
		expect(render().form.form.value.shipping_id).toBe(4);
		expect(render({ ...filled, shipping_id: 9 }).form.form.value).toMatchObject({ name: 'n', shipping_id: 9 });
	});

	it('drops the amount for free shipping and brings it back', () => {
		const { form } = render();
		form.form.patchValue(filled);
		form.form.controls['shipping_type']?.setValue('free');
		expect(form.form.get('amount')).toBeNull();
		form.selectShippingType();
		form.form.controls['shipping_type']?.setValue('fixed');
		expect(form.form.get('amount')?.value).toBe('');
		const saved = render(filled).form;
		saved.form.controls['shipping_type']?.setValue('free');
		saved.form.controls['shipping_type']?.setValue('fixed');
		expect(saved.form.get('amount')?.value).toBe(3);
		saved.selectShippingType();
		expect(saved.form.get('amount')?.value).toBe('');
	});

	it('closes on a valid form only, with a no-op delete', () => {
		const { form, dismissAll } = render();
		form.submit();
		expect(dismissAll).not.toHaveBeenCalled();
		form.form.patchValue(filled);
		form.submit();
		expect(dismissAll).toHaveBeenCalledOnce();
		expect(form.delete('delete', {} as never)).toBeUndefined();
	});
});

describe.each([
	{ name: 'ShippingCountryModal', type: ShippingCountryModal as Type<unknown>, opener: 'openModal' },
	{ name: 'ShippingRuleModal', type: ShippingRuleModal as Type<unknown>, opener: 'openModal' },
])('$name', ({ type }) => {
	const render = (result: Promise<unknown> = Promise.resolve('closed')) => {
		const open = vi.fn(() => ({ result }));
		const dismissAll = vi.fn();
		const fixture = bare(type, [{ provide: NgbModal, useValue: { open, dismissAll } }]);
		return { fixture, modal: fixture.componentInstance as ShippingCountryModal, open, dismissAll };
	};

	it('opens', async () => {
		const { modal, open } = render();
		await modal.openModal();
		await settle();
		expect(open).toHaveBeenCalledOnce();
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(Promise.reject(reason));
		await modal.openModal();
		await settle();
		expect(modal.closeResult).toBe(text);
	});

	it('closes an open dialog when destroyed, and leaves others alone', async () => {
		const closed = render();
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const opened = render();
		await opened.modal.openModal();
		opened.fixture.destroy();
		expect(opened.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('ShippingCountryModal form', () => {
	const render = () => {
		const dismissAll = vi.fn();
		const open = vi.fn(() => ({ result: Promise.resolve() }));
		const modal = bare(ShippingCountryModal, [
			{ provide: NgbModal, useValue: { open, dismissAll } },
		]).componentInstance;
		return { modal, dismissAll };
	};

	it('lists the countries', async () => {
		const { modal } = render();
		TestBed.tick();
		expect(await firstValueFrom(modal.countries$)).toEqual([]);
		countries.set([{ id: 1, name: 'India' }]);
		TestBed.tick();
		expect(await firstValueFrom(modal.countries$)).toEqual([{ label: 'India', value: 1 }]);
	});

	it('fills from a saved country', async () => {
		const { modal } = render();
		await modal.openModal({ country_id: 4, status: 0 } as never);
		expect(modal.form.value).toEqual({ country_id: 4, status: 0 });
	});

	it('closes on a valid form only', () => {
		const { modal, dismissAll } = render();
		modal.submit();
		expect(dismissAll).not.toHaveBeenCalled();
		(modal.form as FormGroup).patchValue({ country_id: 4 });
		modal.submit();
		expect(dismissAll).toHaveBeenCalledOnce();
	});
});

describe('AnswersModal', () => {
	const render = (result: Promise<unknown> = Promise.resolve('closed')) => {
		const open = vi.fn(() => ({ result }));
		const dismissAll = vi.fn();
		const api = { answer: vi.fn(() => of({})) };
		const fixture = bare(AnswersModal, [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: QuestionsAnswersService, useValue: api },
		]);
		return { fixture, modal: fixture.componentInstance, dismissAll, api };
	};

	it('sends an empty answer when the control holds nothing', () => {
		const { modal, api } = render();
		modal.qna = { questionId: 'q1' } as never;
		modal.answers.clearValidators();
		modal.answers.setValue(null as never);
		modal.submit();
		expect(api.answer).toHaveBeenCalledWith('q1', '');
	});

	it('opens with the saved answer, or empty', async () => {
		const { modal } = render();
		await modal.openModal({ answer: 'Yes' } as never);
		await settle();
		expect(modal.answers.value).toBe('Yes');
		expect(modal.closeResult).toBe('Closed with: closed');
		await modal.openModal({} as never);
		expect(modal.answers.value).toBe('');
	});

	it.each(reasons)('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render(Promise.reject(reason));
		await modal.openModal({} as never);
		await settle();
		expect(modal.closeResult).toBe(text);
	});

	it('posts a valid answer for a real question only', async () => {
		const { modal, api, dismissAll } = render();
		await modal.openModal({ questionId: 'q1' } as never);
		modal.submit();
		expect(api.answer).not.toHaveBeenCalled();
		modal.answers.setValue('Yes');
		modal.submit();
		expect(api.answer).toHaveBeenCalledWith('q1', 'Yes');
		expect(dismissAll).toHaveBeenCalledOnce();
		modal.qna = {} as never;
		modal.submit();
		expect(api.answer).toHaveBeenCalledOnce();
	});

	it('closes an open dialog when destroyed, and leaves others alone', async () => {
		const closed = render();
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const opened = render();
		await opened.modal.openModal({} as never);
		opened.fixture.destroy();
		expect(opened.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('Media page', () => {
	const render = () => {
		const gateway = { remove: vi.fn(() => of<unknown>(undefined)) };
		const client = { invalidateQueries: vi.fn(async () => undefined) };
		const notification = { showError: vi.fn() };
		const page = bare(Media, [
			{ provide: MediaGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notification },
		]).componentInstance;
		return { page, gateway, client, notification };
	};

	it('keeps the selection and clears it on delete all', () => {
		const { page } = render();
		page.selectImage([{ id: 1 }] as never);
		page.onActionClicked('other');
		expect(page.images).toHaveLength(1);
		page.onActionClicked('deleteAll');
		expect(page.images).toEqual([]);
	});

	it('deletes one image and refreshes', async () => {
		const { page, gateway, client } = render();
		page.images = [{ id: 1 }, { id: 2 }] as never;
		await page.deleteImage(1);
		expect(gateway.remove).toHaveBeenCalledWith('1');
		expect(page.images).toEqual([{ id: 2 }]);
		expect(client.invalidateQueries).toHaveBeenCalledOnce();
	});

	it('shows a refusal, or the generic message', async () => {
		const { page, gateway, notification } = render();
		gateway.remove.mockReturnValueOnce(throwError(() => ({ error: { message: 'In use' } })));
		await page.deleteImage(1);
		expect(notification.showError).toHaveBeenCalledWith('In use');
		gateway.remove.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.deleteImage(1);
		expect(notification.showError).toHaveBeenLastCalledWith('Delete failed');
	});
});
