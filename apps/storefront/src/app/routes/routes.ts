import { Routes } from '@angular/router';

import { AuthGuard } from '@core/guards/auth.guard';

export const content: Routes = [
  {
    path: '',
    loadChildren: () => import('@features/themes/themes.routes'),
  },
  {
    path: 'auth',
    loadChildren: () => import('@features/auth/auth.routes'),
  },
  {
    path: 'account',
    loadChildren: () => import('@features/account/account.routes'),
    canActivate: [AuthGuard],
  },
  {
    path: '',
    loadChildren: () => import('@features/shop/shop.routes'),
  },
  {
    path: '',
    loadChildren: () => import('@features/blog/blog.routes'),
  },
  {
    path: '',
    loadChildren: () => import('@features/page/page.routes'),
  },
  {
    path: '**',
    pathMatch: 'full',
    loadComponent: () => import('@features/page/error404/error404').then(m => m.Error404),
  },
];
