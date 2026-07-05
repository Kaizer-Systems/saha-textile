import { Routes } from '@angular/router';

import { content } from './routes/routes';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/theme/paris',
    pathMatch: 'full',
  },
  {
    path: 'maintenance',
    loadComponent: () => import('@features/maintenance/maintenance').then(m => m.Maintenance),
  },
  {
    path: '',
    loadComponent: () => import('./layout/layout').then(m => m.Layout),
    children: content,
  },
];
