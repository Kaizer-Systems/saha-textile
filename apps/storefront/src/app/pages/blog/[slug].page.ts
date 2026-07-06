// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { BlogResolver } from '@data-access/resolvers/blog.resolver';
import { BlogDetails } from '@features/blog/blog-details/blog-details';

export const routeMeta = {
  canActivate: [ScrollPositionGuard],
  resolve: { data: BlogResolver },
};

export default BlogDetails;
