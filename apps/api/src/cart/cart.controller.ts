import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CartService } from './cart.service';
import { Public } from '../auth/session.guard';

const CreateCartSchema = z.object({
	userId: z.string().min(1).nullable().optional(),
	guestToken: z.string().min(1).nullable().optional(),
	currency: z.string().length(3).optional(),
});
type CreateCartInput = z.infer<typeof CreateCartSchema>;

const AddLineSchema = z.object({
	productId: z.string().min(1),
	variationId: z.string().min(1).nullable().optional(),
	quantity: z.number().int().positive(),
	addons: z.array(z.object({ code: z.string().min(1), value: z.union([z.string(), z.number()]) })).optional(),
});
type AddLineBody = z.infer<typeof AddLineSchema>;

const UpdateQtySchema = z.object({ quantity: z.number().int().positive() });
type UpdateQtyBody = z.infer<typeof UpdateQtySchema>;

@ApiTags('cart')
@Controller('cart')
/** Guest add-to-cart is an owner lock, so carts stay reachable without an account. Guest-token authorization and user-cart ownership land with Chunk G. */
@Public()
export class CartController {
	constructor(private readonly cart: CartService) {}

	@Post()
	@ApiOperation({ summary: 'Create a new (guest or user) cart' })
	create(@Body(new ZodValidationPipe(CreateCartSchema)) body: CreateCartInput) {
		return this.cart.createCart(body);
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get a cart by id' })
	get(@Param('id') id: string) {
		return this.cart.getCart(id);
	}

	@Post(':id/lines')
	@ApiOperation({ summary: 'Add a line to a cart' })
	addLine(@Param('id') id: string, @Body(new ZodValidationPipe(AddLineSchema)) body: AddLineBody) {
		return this.cart.addLine(id, body);
	}

	@Patch(':id/lines/:lineId')
	@ApiOperation({ summary: 'Update the quantity of a cart line' })
	updateLine(
		@Param('id') id: string,
		@Param('lineId') lineId: string,
		@Body(new ZodValidationPipe(UpdateQtySchema)) body: UpdateQtyBody,
	) {
		return this.cart.updateLineQuantity(id, lineId, body.quantity);
	}

	@Delete(':id/lines/:lineId')
	@ApiOperation({ summary: 'Remove a line from a cart' })
	removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
		return this.cart.removeLine(id, lineId);
	}
}
