import { Routes } from '@angular/router';

import { Account } from './account';
import { Adresses } from './adresses/adresses';
import { BankDetails } from './bank-details/bank-details';
import { Dashboard } from './dashboard/dashboard';
import { Notification } from './notification/notification';
import { OrderDetails } from './orders/details/details';
import { Orders } from './orders/orders';
import { Point } from './point/point';
import { Refund } from './refund/refund';
import { Wallet } from './wallet/wallet';

export default [
  {
    path: '',
    component: Account,
    children: [
      {
        path: 'dashboard',
        component: Dashboard,
      },
      {
        path: 'wallet',
        component: Wallet,
      },
      {
        path: 'notifications',
        component: Notification,
      },
      {
        path: 'bank-details',
        component: BankDetails,
      },
      {
        path: 'point',
        component: Point,
      },
      {
        path: 'order',
        component: Orders,
      },
      {
        path: 'order/details/:id',
        component: OrderDetails,
      },
      {
        path: 'refund',
        component: Refund,
      },
      {
        path: 'addresses',
        component: Adresses,
      },
    ],
  },
] as Routes;
