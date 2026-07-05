import { IUserAddress } from '@data-access/interfaces/user.interface';
import { IAccountUser, IAccountUserUpdatePassword } from '@data-access/interfaces/account.interface';

export class GetUserDetailsAction {
  static readonly type = '[Account] User Get';
  constructor() {}
}

export class UpdateUserProfileAction {
  static readonly type = '[Account] User Update';
  constructor(public payload: IAccountUser) {}
}

export class UpdateUserPasswordAction {
  static readonly type = '[Account] User Update Password';
  constructor(public payload: IAccountUserUpdatePassword) {}
}

export class CreateAddressAction {
  static readonly type = '[Account] Address Create';
  constructor(public payload: IUserAddress) {}
}

export class UpdateAddressAction {
  static readonly type = '[Account] Address Edit';
  constructor(
    public payload: IUserAddress,
    public id: number,
  ) {}
}

export class DeleteAddressAction {
  static readonly type = '[Account] Address Delete';
  constructor(public id: number) {}
}

export class AccountClearAction {
  static readonly type = '[Account] Clear';
  constructor() {}
}
