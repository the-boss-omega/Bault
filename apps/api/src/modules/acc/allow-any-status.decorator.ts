import { SetMetadata } from '@nestjs/common';

export const ALLOW_ANY_STATUS_KEY = 'allow_any_status';
export const AllowAnyStatus = () => SetMetadata(ALLOW_ANY_STATUS_KEY, true);
