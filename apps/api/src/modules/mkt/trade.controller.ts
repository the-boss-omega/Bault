import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { TradeService } from './trade.service';

class ProposeSwapDto {
  @IsString() responderId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) offeredItemIds!: string[];
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) requestedItemIds!: string[];
}
class InitiateTransferDto {
  @IsString() itemId!: string;
  @IsString() toUserId!: string;
}
class ConfirmTokenDto {
  @IsString() confirmationToken!: string;
}

/** MKT swaps + gift transfers (T091). Recipient approval reuses /swaps/:id/approve. */
@ApiTags('MKT')
@Controller('marketplace')
export class TradeController {
  constructor(private readonly trades: TradeService) {}

  @Post('swaps')
  propose(@CurrentUser() user: AuthUser, @Body() dto: ProposeSwapDto) {
    return this.trades.proposeSwap(user.id, dto.responderId, dto.offeredItemIds, dto.requestedItemIds);
  }

  @Post('swaps/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.trades.approve(user.id, id);
  }

  @Post('swaps/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.trades.reject(user.id, id);
  }

  @Post('transfers')
  initiateTransfer(@CurrentUser() user: AuthUser, @Body() dto: InitiateTransferDto) {
    return this.trades.initiateTransfer(user.id, dto.itemId, dto.toUserId);
  }

  @Post('transfers/confirm')
  confirmTransfer(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTokenDto) {
    return this.trades.confirmTransfer(user.id, dto.confirmationToken);
  }
}
