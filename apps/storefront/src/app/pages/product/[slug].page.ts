// AnalogJS file-based route → /<locale>/product/:slug. One flat product URL per
// language, whatever categories the product sits in.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { ProductDetail } from '@features/shop/product-detail/product-detail';

export const routeMeta = {
	canActivate: [ScrollPositionGuard],
};

export default ProductDetail;
