// AnalogJS file-based route → /en/product/:slug (KB-shaped, locale-prefixed).
// Literal `en` segment for now; a non-breaking rename to `[locale]` in the
// site-wide locale pass. The demo product page stays at /product/:slug.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { ProductDetail } from '@features/shop/product-detail/product-detail';

export const routeMeta = {
	canActivate: [ScrollPositionGuard],
};

export default ProductDetail;
