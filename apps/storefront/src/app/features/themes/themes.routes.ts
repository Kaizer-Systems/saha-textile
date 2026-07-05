import { Routes } from '@angular/router';

import { Themes } from './themes';

export default [
  {
    path: 'home',
    component: Themes,
  },
  {
    path: 'theme/:slug',
    component: Themes,
  },
] as Routes;
