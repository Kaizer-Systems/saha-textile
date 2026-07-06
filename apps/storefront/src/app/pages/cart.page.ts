// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Cart } from '@features/shop/cart/cart';

export const routeMeta = { canActivate: [ScrollPositionGuard] };

export default Cart;
