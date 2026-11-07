import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type AddCartLineRequest,
	type Cart,
	type CartLine,
	Cart as CartSchema,
	CartView,
	type CartViewLine,
	type UpdateCartLineRequest,
} from '@saha-textile/contracts';
import { type CartRepository, type PricedCartLine, priceCartLine } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CatalogPublicService } from '../catalog/catalog-public.service';
import { CART_REPOSITORY } from '../infra/tokens';
import { CartService, lineKey } from './cart.service';

export interface CartOwner {
	principal?: AuthenticatedPrincipal;
	guestToken?: string | null;
}

export interface CartWrite {
	view: CartView;
	/** Set when this write started a guest cart, so the cookie can be issued. */
	guestTokenRaw: string | null;
}

/** Problems that keep a line out of the total. A short line still counts, at what it holds. */
const UNSELLABLE = new Set<CartViewLine['problem']>(['unavailable', 'out_of_stock']);

/**
 * The shopper's own cart, always priced here. The browser sends choices, never prices: every read
 * re-prices each line from the live product, so a changed price or sold-out size shows at once.
 */
@Injectable()
export class CartLinesService {
	constructor(
		@Inject(CART_REPOSITORY) private readonly carts: CartRepository,
		private readonly ownership: CartService,
		private readonly catalog: CatalogPublicService,
	) {}

	async current(owner: CartOwner): Promise<CartView> {
		return this.view(await this.find(owner));
	}

	async add(input: AddCartLineRequest, owner: CartOwner): Promise<CartWrite> {
		const { cart, guestTokenRaw } = await this.findOrStart(owner);
		const line: CartLine = {
			id: `line_${randomUUID()}`,
			productId: input.productId,
			variationId: input.variationId ?? null,
			quantity: input.quantity,
			addons: input.addons ?? [],
		};
		const priced = await this.price(line);
		line.addons = savedChoices(priced);
		const same = cart.lines.find((row) => lineKey(row) === lineKey(line));
		const quantity = line.quantity + (same?.quantity ?? 0);
		assertStock(priced, quantity);
		if (same) same.quantity = quantity;
		else cart.lines.push(line);
		return { view: await this.view(await this.carts.save(cart)), guestTokenRaw };
	}

	/** Sets a line's quantity, and its choices when an edit sends them. Equal lines become one. */
	async update(lineId: string, input: UpdateCartLineRequest, owner: CartOwner): Promise<CartView> {
		const cart = await this.find(owner);
		const line = cart?.lines.find((row) => row.id === lineId);
		if (!cart || !line) throw new NotFoundException('Cart not found');
		const next: CartLine = {
			...line,
			quantity: input.quantity,
			variationId: input.variationId === undefined ? line.variationId : input.variationId,
			addons: input.addons ?? line.addons,
		};
		const priced = await this.price(next);
		next.addons = savedChoices(priced);
		const twin = cart.lines.find((row) => row.id !== lineId && lineKey(row) === lineKey(next));
		next.quantity += twin?.quantity ?? 0;
		assertStock(priced, next.quantity);
		cart.lines = cart.lines
			.filter((row) => row.id !== twin?.id)
			.map((row) => (row.id === lineId ? next : row));
		return this.view(await this.carts.save(cart));
	}

	async remove(lineId: string, owner: CartOwner): Promise<CartView> {
		const cart = await this.find(owner);
		if (!cart?.lines.some((row) => row.id === lineId)) throw new NotFoundException('Cart not found');
		cart.lines = cart.lines.filter((row) => row.id !== lineId);
		return this.view(await this.carts.save(cart));
	}

	private async find(owner: CartOwner): Promise<Cart | null> {
		if (owner.principal?.audience === 'storefront') return this.carts.findByUserId(owner.principal.userId);
		if (!owner.guestToken) return null;
		return this.carts.findByGuestToken(this.ownership.hashGuestToken(owner.guestToken));
	}

	private async findOrStart(owner: CartOwner): Promise<{ cart: Cart; guestTokenRaw: string | null }> {
		const found = await this.find(owner);
		if (found) return { cart: found, guestTokenRaw: null };
		const signedIn = owner.principal?.audience === 'storefront' ? owner.principal.userId : null;
		const guest = signedIn ? null : this.ownership.mintGuestToken();
		return {
			cart: CartSchema.parse({
				id: `cart_${randomUUID()}`,
				userId: signedIn,
				guestToken: guest?.hash ?? null,
				currency: 'INR',
				lines: [],
			}),
			guestTokenRaw: guest?.raw ?? null,
		};
	}

	private async price(line: CartLine): Promise<PricedCartLine> {
		const read = await this.catalog.cartRead(line.productId);
		if (!read?.page) throw new NotFoundException('Product not found');
		const priced = priceCartLine(read.page, line);
		if (!priced.ok) {
			throw new BadRequestException({
				issues: [{ path: 'addons', message: 'That choice is not available', code: priced.reason }],
			});
		}
		return priced.line;
	}

	private async view(cart: Cart | null): Promise<CartView> {
		const lines = await Promise.all((cart?.lines ?? []).map((line) => this.lineView(line)));
		return CartView.parse({
			id: cart?.id ?? null,
			currency: 'INR',
			lines,
			subtotalINR: lines
				.filter((line) => !UNSELLABLE.has(line.problem))
				.reduce((sum, line) => sum + line.lineTotalINR, 0),
			count: lines.reduce((sum, line) => sum + line.quantity, 0),
		});
	}

	private async lineView(line: CartLine): Promise<CartViewLine> {
		const read = await this.catalog.cartRead(line.productId);
		const page = read?.page;
		const priced = page ? priceCartLine(page, line) : null;
		const identity = {
			id: line.id,
			productId: line.productId,
			slug: read?.slug ?? '',
			title: read?.title ?? '',
			quantity: line.quantity,
			addons: line.addons,
		};
		if (!page || !priced?.ok) {
			return {
				...identity,
				image: null,
				sku: '',
				variationId: line.variationId,
				variantLabel: null,
				available: 0,
				basePriceINR: 0,
				unitPriceINR: 0,
				mrpINR: null,
				lineTotalINR: 0,
				options: [],
				measurements: [],
				problem: 'unavailable',
			};
		}
		const row: PricedCartLine = priced.line;
		const { sku, variationId, variantLabel, available, basePriceINR, unitPriceINR, mrpINR } = row;
		const { options, measurements } = row;
		return {
			...identity,
			image: page.gallery[row.galleryIndex ?? 0] ?? null,
			sku,
			variationId,
			variantLabel,
			available,
			basePriceINR,
			unitPriceINR,
			mrpINR,
			lineTotalINR: unitPriceINR * line.quantity,
			options,
			measurements,
			problem: lineProblem(row, line.quantity),
		};
	}
}

/** Defaults spelled out, so a line chosen by hand and one left on its default are the same line. */
function savedChoices(row: PricedCartLine): CartLine['addons'] {
	return [
		...row.options.map((option) => ({ code: option.code, value: option.termCode })),
		...row.measurements.map((field) => ({ code: field.code, value: field.value })),
	];
}

function assertStock({ available, buyable }: PricedCartLine, quantity: number): void {
	if (buyable && (available === null || quantity <= available)) return;
	throw new ConflictException({
		issues: [{ path: 'quantity', message: 'Not enough stock', code: 'stock_limit' }],
	});
}

function lineProblem(row: PricedCartLine, quantity: number): CartViewLine['problem'] {
	if (!row.buyable) return 'out_of_stock';
	return row.available !== null && quantity > row.available ? 'limited' : null;
}
