import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { TradeService } from './trade.service';
import { MarketReadService } from './market-read.service';

class ProposeSwapDto {
  @IsString() responderUsername!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) offeredItemIds!: string[];
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) requestedItemIds!: string[];
}
class InitiateTransferDto {
  @IsString() itemId!: string;
  @IsString() toUsername!: string;
}
class ConfirmTokenDto {
  @IsString() confirmationToken!: string;
}

@ApiTags('MKT')
@Controller('marketplace')
export class TradeController {
  constructor(
    private readonly trades: TradeService,
    private readonly read: MarketReadService,
  ) {}

  @Get('swaps')
  mine(@CurrentUser() user: AuthUser) {
    return this.read.mySwaps(user.id);
  }

  @Post('swaps')
  async propose(@CurrentUser() user: AuthUser, @Body() dto: ProposeSwapDto) {
    const responder = await this.read.counterparty(dto.responderUsername, user.id);
    return this.trades.proposeSwap(user.id, responder.id, dto.offeredItemIds, dto.requestedItemIds);
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
  async initiateTransfer(@CurrentUser() user: AuthUser, @Body() dto: InitiateTransferDto) {
    const recipient = await this.read.counterparty(dto.toUsername, user.id);
    return this.trades.initiateTransfer(user.id, dto.itemId, recipient.id);
  }

  @Post('transfers/confirm')
  confirmTransfer(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTokenDto) {
    return this.trades.confirmTransfer(user.id, dto.confirmationToken);
  }
}
