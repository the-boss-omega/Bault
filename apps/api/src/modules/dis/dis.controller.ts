import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Equals, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ServiceRequestService } from './service.service';
import { PhotographyService } from './photography.service';
import { GradingService } from './grading.service';
import { DonationService } from './donation.service';
import { ConsignmentService } from './consignment.service';

class ItemDto {
  @IsString() itemId!: string;
}
class GradingDto {
  @IsString() itemId!: string;
  @IsOptional() @IsString() gradingBody?: string;
}
class ConfirmDto {
  @IsString() confirmationToken!: string;
}
class ConsignDto {
  @IsString() itemId!: string;
  @IsString() channel!: string;
}

/*
 * Structured warehouse fulfillment forms (Requirement 5.4). Same pattern as the
 * shipment dispatch form: a customer request can only be closed once the operator
 * has filled EVERY required field, including an explicit item-verified confirmation.
 */

class PhotographyFulfillmentDto {
  @IsString() @IsNotEmpty() objectKey!: string;
  @IsInt() @IsPositive() shotCount!: number;
  @IsString() @IsNotEmpty() lighting!: string;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

class GradingFulfillmentDto {
  @IsString() @IsNotEmpty() grade!: string;
  @IsString() @IsNotEmpty() gradingBody!: string;
  @IsString() @IsNotEmpty() certificateNumber!: string;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

class ConsignmentFulfillmentDto {
  @IsInt() @IsPositive() saleAmountMinor!: number;
  @IsString() @IsNotEmpty() channel!: string;
  @IsString() @IsNotEmpty() externalReference!: string;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

class WarehouseTransferDto {
  @IsString() itemId!: string;
  @IsString() @IsNotEmpty() destinationWarehouse!: string;
  @IsString() @IsNotEmpty() destinationBin!: string;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

/** DIS endpoints (`/services/*`). */
@ApiTags('DIS')
@Controller('services')
export class DisController {
  constructor(
    private readonly requests: ServiceRequestService,
    private readonly photography: PhotographyService,
    private readonly grading: GradingService,
    private readonly donation: DonationService,
    private readonly consignment: ConsignmentService,
  ) {}

  /** A customer's own service requests (pending / accepted / done / denied). */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.requests.listMine(user.id);
  }

  /** Operator queue: pending + accepted requests to act on. */
  @Roles('warehouse_operator', 'admin')
  @Get('queue')
  queue() {
    return this.requests.listQueue();
  }

  @Get('requests/:id')
  get(@Param('id') id: string) {
    return this.requests.get(id);
  }

  // Operator approval workflow --------------------------------------------------
  @Roles('warehouse_operator', 'admin')
  @Post('requests/:id/accept')
  accept(@Param('id') id: string) {
    return this.requests.accept(id);
  }
  @Roles('warehouse_operator', 'admin')
  @Post('requests/:id/deny')
  deny(@Param('id') id: string) {
    return this.requests.deny(id);
  }

  // Photography -----------------------------------------------------------------
  @Post('photography')
  requestPhoto(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.photography.request(user.id, dto.itemId);
  }
  @Roles('warehouse_operator', 'admin')
  @Post('photography/:requestId/complete')
  completePhoto(@CurrentUser() user: AuthUser, @Param('requestId') id: string, @Body() dto: PhotographyFulfillmentDto) {
    return this.photography.complete(user.id, id, dto);
  }

  // Grading ---------------------------------------------------------------------
  @Post('grading')
  requestGrading(@CurrentUser() user: AuthUser, @Body() dto: GradingDto) {
    return this.grading.request(user.id, dto.itemId, dto.gradingBody);
  }
  @Roles('warehouse_operator', 'admin')
  @Post('grading/:requestId/complete')
  completeGrading(@CurrentUser() user: AuthUser, @Param('requestId') id: string, @Body() dto: GradingFulfillmentDto) {
    return this.grading.complete(user.id, id, dto);
  }

  // Donation (two-step confirmation; no operator step) --------------------------
  @Post('donation')
  requestDonation(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.donation.request(user.id, dto.itemId);
  }
  @Post('donation/confirm')
  confirmDonation(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDto) {
    return this.donation.confirm(user.id, dto.confirmationToken);
  }

  // Consignment -----------------------------------------------------------------
  @Post('consignment')
  requestConsignment(@CurrentUser() user: AuthUser, @Body() dto: ConsignDto) {
    return this.consignment.request(user.id, dto.itemId, dto.channel);
  }
  @Roles('warehouse_operator', 'admin')
  @Post('consignment/:requestId/complete')
  completeConsignment(@CurrentUser() user: AuthUser, @Param('requestId') id: string, @Body() dto: ConsignmentFulfillmentDto) {
    return this.consignment.complete(user.id, id, dto);
  }

  // Warehouse transfer ----------------------------------------------------------
  @Roles('warehouse_operator', 'admin')
  @Post('warehouse-transfer')
  warehouseTransfer(@CurrentUser() user: AuthUser, @Body() dto: WarehouseTransferDto) {
    return this.consignment.warehouseTransfer(user.id, dto.itemId, {
      destinationWarehouse: dto.destinationWarehouse,
      destinationBin: dto.destinationBin,
      itemVerified: dto.itemVerified,
      notes: dto.notes,
    });
  }
}
