// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { Product } from '@features/shop/product/product';

// Product now loads by slug via injectProductBySlugQuery inside Product (was ProductResolver).
export const routeMeta = {
  canActivate: [ScrollPositionGuard],
};

export default Product;
