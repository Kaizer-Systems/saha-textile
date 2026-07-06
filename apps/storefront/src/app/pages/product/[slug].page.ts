// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { ProductResolver } from '@data-access/resolvers/product.resolver';
import { Product } from '@features/shop/product/product';

export const routeMeta = {
  canActivate: [ScrollPositionGuard],
  resolve: { data: ProductResolver },
};

export default Product;
