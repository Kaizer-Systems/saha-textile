import { Routes } from '@angular/router';

import { Blog } from './blog';
import { BlogDetails } from './blog-details/blog-details';
import { ScrollPositionGuard } from '@core/guards/scroll.guard';
import { BlogResolver } from '@data-access/resolvers/blog.resolver';

export default [
  {
    path: 'blogs',
    component: Blog,
    canActivate: [ScrollPositionGuard],
  },
  {
    path: 'blog/:slug',
    component: BlogDetails,
    resolve: {
      data: BlogResolver,
    },
    canActivate: [ScrollPositionGuard],
  },
] as Routes;
