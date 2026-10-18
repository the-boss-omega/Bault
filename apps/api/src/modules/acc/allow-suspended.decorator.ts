import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_KEY = 'allow_suspended';
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
