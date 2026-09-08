import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ServiceRequestService } from './service.service';
import { PhotographyService } from './photography.service';
import { GradingService } from './grading.service';
import { DonationService } from './donation.service';
import { ConsignmentService } from './consignment.service';
import { BuyoutService } from './buyout.service';
import { CustomRequestService } from './custom-request.service';
import { CONSIGNMENT_CHANNELS } from './consignment-channels';
import { MediaService } from './media.service';
import { DisposalServicesService, CULL_WINDOW_DAYS } from './disposal-services.service';
import { LotSplitService } from './lot-split.service';
import { INSPECTION_AREAS } from './grading-tiers';

class ItemDto {
  @IsString() itemId!: string;
}
class GradingDto {
  @IsString() itemId!: string;
  /** A tier from the catalogue — it fixes turnaround, ceiling and price. */
  @IsString() tier!: string;
  /** What the card is worth, in minor units. The tier's ceiling applies to it. */
  @IsInt() @IsPositive() declaredMinor!: number;
}

class GradingApprovalDto {
  @IsBoolean() approve!: boolean;
  @IsString() @IsNotEmpty() reason!: string;
}

class OpenSubmissionDto {
  @IsString() @IsNotEmpty() gradingBody!: string;
}

class AddToSubmissionDto {
  @IsString() requestId!: string;
}

class ShipSubmissionDto {
  @IsString() @IsNotEmpty() trackingNumber!: string;
  @IsOptional() @IsString() externalReference?: string;
  @IsString() @IsNotEmpty() notes!: string;
}

class VideoFulfillmentDto {
  @IsString() @IsNotEmpty() objectKey!: string;
  @IsInt() @IsPositive() durationSeconds!: number;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

class InspectionRequestDto {
  @IsString() itemId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) areas!: string[];
}

class AreaFindingDto {
  @IsString() area!: string;
  @IsString() severity!: string;
  @IsString() @IsNotEmpty() note!: string;
}

class InspectionFulfillmentDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => AreaFindingDto)
  findings!: AreaFindingDto[];
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}

class DeslabFulfillmentDto {
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() conditionAfter!: string;
  @IsString() @IsNotEmpty() notes!: string;
}

class CullRequestDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsIn(['discard', 'donate']) outcome!: 'discard' | 'donate';
}

class LotSplitFulfillmentDto {
  @IsBoolean() @Equals(true) itemVerified!: boolean;
  @IsString() @IsNotEmpty() notes!: string;
}
class ConfirmDto {
  @IsString() confirmationToken!: string;
}
class ConsignDto {
  @IsString() itemId!: string;
  @IsString() channel!: string;
  /** What the owner wants for it. Channels enforce their own minimums. */
  @IsInt() @IsPositive() askingMinor!: number;
  /** Required by channels that sell at a specific show. */
  @IsOptional() @IsString() eventId?: string;
}

class BuyoutQuoteDto {
  @IsInt() @IsPositive() offerMinor!: number;
  @IsString() @IsNotEmpty() rationale!: string;
  @IsBoolean() @Equals(true) itemVerified!: boolean;
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

/**
 * Asking for something the service list does not offer.
 *
 * `detail` has a real minimum because somebody has to PRICE this by reading it.
 * "please help" is not a thing anybody can quote.
 */
class CustomRequestDto {
  @IsOptional() @IsString() itemId?: string;
  @IsString() @MinLength(3) @MaxLength(120) summary!: string;
  @IsString() @MinLength(10) @MaxLength(2000) detail!: string;
}

class CustomQuoteDto {
  @IsInt() @IsPositive() priceMinor!: number;
  /** What will actually be done — the thing the collector is agreeing to. */
  @IsString() @MinLength(10) @MaxLength(1000) scope!: string;
}

class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

class CompletionNotesDto {
  @IsString() @MinLength(5) @MaxLength(1000) notes!: string;
}

@ApiTags('DIS')
@Controller('services')
export class DisController {
  constructor(
    private readonly requests: ServiceRequestService,
    private readonly photography: PhotographyService,
    private readonly grading: GradingService,
    private readonly donation: DonationService,
    private readonly consignment: ConsignmentService,
    private readonly buyouts: BuyoutService,
    private readonly custom: CustomRequestService,
    private readonly media: MediaService,
    private readonly disposals: DisposalServicesService,
    private readonly lotSplits: LotSplitService,
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
  /**
   * The tier catalogue.
   *
   * Served before the form is drawn, because the three things that differ
   * between tiers — the value ceiling, the turnaround, and whether a manager has
   * to agree — are exactly what a collector needs to see BEFORE choosing one,
   * not after being rejected for choosing wrong.
   */
  @Get('grading/tiers')
  gradingTiers() {
    return this.grading.tiers();
  }

  @Post('grading')
  requestGrading(@CurrentUser() user: AuthUser, @Body() dto: GradingDto) {
    return this.grading.request(user.id, dto.itemId, dto.tier, dto.declaredMinor);
  }

  /** A card past the walkthrough threshold needs a manager before it leaves. */
  @Roles('admin')
  @Post('grading/:requestId/approval')
  approveGrading(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: GradingApprovalDto,
  ) {
    return this.grading.approve(user.id, requestId, dto.approve, dto.reason);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('grading/:requestId/complete')
  completeGrading(@CurrentUser() user: AuthUser, @Param('requestId') id: string, @Body() dto: GradingFulfillmentDto) {
    return this.grading.complete(user.id, id, dto);
  }

  /* ---- Grading submissions: the batch that physically goes to the grader ---- */

  @Roles('warehouse_operator', 'admin')
  @Get('grading/submissions')
  listSubmissions() {
    return this.grading.listSubmissions();
  }

  @Roles('warehouse_operator', 'admin')
  @Post('grading/submissions')
  openSubmission(@Body() dto: OpenSubmissionDto) {
    return this.grading.openSubmission(dto.gradingBody);
  }

  /** Accepted, approved requests waiting for a batch to this grading body. */
  @Roles('warehouse_operator', 'admin')
  @Get('grading/submissions/ready')
  readyForSubmission(@Query('gradingBody') gradingBody: string) {
    return this.grading.readyFor(gradingBody);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('grading/submissions/:id/add')
  addToSubmission(@Param('id') id: string, @Body() dto: AddToSubmissionDto) {
    return this.grading.addToSubmission(dto.requestId, id);
  }

  /**
   * Ship the batch. Every card in it becomes `at_grader`, which is the whole
   * point: until now a card could be sold or shipped while it was physically in
   * another state.
   */
  @Roles('warehouse_operator', 'admin')
  @Post('grading/submissions/:id/ship')
  shipSubmission(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ShipSubmissionDto,
  ) {
    return this.grading.shipSubmission(user.id, id, {
      trackingNumber: dto.trackingNumber,
      externalReference: dto.externalReference ?? '',
      notes: dto.notes,
    });
  }

  @Roles('warehouse_operator', 'admin')
  @Post('grading/submissions/:id/close')
  closeSubmission(@Param('id') id: string) {
    return this.grading.closeSubmission(id);
  }

  // Video review and condition inspection ---------------------------------------
  /** The closed list of areas an inspection may be asked to look at. */
  @Get('inspection/areas')
  inspectionAreas() {
    return { areas: INSPECTION_AREAS };
  }

  @Post('video')
  requestVideo(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.media.requestVideo(user.id, dto.itemId);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('video/:requestId/complete')
  completeVideo(
    @CurrentUser() user: AuthUser,
    @Param('requestId') id: string,
    @Body() dto: VideoFulfillmentDto,
  ) {
    return this.media.completeVideo(user.id, id, dto);
  }

  @Post('inspection')
  requestInspection(@CurrentUser() user: AuthUser, @Body() dto: InspectionRequestDto) {
    return this.media.requestInspection(user.id, dto.itemId, dto.areas);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('inspection/:requestId/complete')
  completeInspection(
    @CurrentUser() user: AuthUser,
    @Param('requestId') id: string,
    @Body() dto: InspectionFulfillmentDto,
  ) {
    return this.media.completeInspection(user.id, id, dto);
  }

  // Crack a slab (two-step confirmed — the holder does not go back on) ----------
  @Post('deslab')
  requestDeslab(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.disposals.requestDeslab(user.id, dto.itemId);
  }

  @Post('deslab/confirm')
  confirmDeslab(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDto) {
    return this.disposals.confirmDeslab(user.id, dto.confirmationToken);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('deslab/:requestId/complete')
  completeDeslab(
    @CurrentUser() user: AuthUser,
    @Param('requestId') id: string,
    @Body() dto: DeslabFulfillmentDto,
  ) {
    return this.disposals.completeDeslab(user.id, id, dto);
  }

  // Remove commons (the bulk cull) ----------------------------------------------
  /** The window, so the vault can grey out cards that are past it. */
  @Get('remove-commons/window')
  cullWindow() {
    return { windowDays: CULL_WINDOW_DAYS };
  }

  @Post('remove-commons')
  requestCull(@CurrentUser() user: AuthUser, @Body() dto: CullRequestDto) {
    return this.disposals.requestCull(user.id, dto.itemIds, dto.outcome);
  }

  @Post('remove-commons/confirm')
  confirmCull(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDto) {
    return this.disposals.confirmCull(user.id, dto.confirmationToken);
  }

  // Lot split, asked for by the owner --------------------------------------------
  @Post('lot-split')
  requestLotSplit(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.lotSplits.request(user.id, dto.itemId);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('lot-split/:requestId/complete')
  completeLotSplit(
    @CurrentUser() user: AuthUser,
    @Param('requestId') id: string,
    @Body() dto: LotSplitFulfillmentDto,
  ) {
    return this.lotSplits.complete(user.id, id, dto);
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
  /**
   * The consignment channel catalogue, and the shows that are still open.
   *
   * Served together because a seller picks one after the other, and the card
   * show channel is unusable without the list of shows.
   */
  @Get('consignment/channels')
  async channels() {
    return { channels: CONSIGNMENT_CHANNELS, events: await this.consignment.listEvents() };
  }

  /* ---- Buyout: Bault buys the card outright ---- */

  @Post('buyout')
  requestBuyout(@CurrentUser() user: AuthUser, @Body() dto: ItemDto) {
    return this.buyouts.request(user.id, dto.itemId);
  }

  /* ----------------------------------------------------------------
     Custom requests — asking for something the service list lacks
     ---------------------------------------------------------------- */

  /**
   * A collector describes what they want. Costs nothing.
   *
   * Deliberately free: a charge on the QUESTION would stop people asking, and
   * the questions are how Bault finds out which services it should be selling
   * as standard. The money moves only when a quote is accepted.
   */
  @Post('custom')
  askForSomething(@CurrentUser() user: AuthUser, @Body() dto: CustomRequestDto) {
    return this.custom.ask(user.id, dto);
  }

  /** An operator prices it, and states what they will actually do. */
  @Roles('warehouse_operator', 'admin')
  @Post('custom/:requestId/quote')
  quoteCustom(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: CustomQuoteDto,
  ) {
    return this.custom.quote(user.id, requestId, dto);
  }

  /** Or says it cannot be done, and why — a refusal with no reason is a dead end. */
  @Roles('warehouse_operator', 'admin')
  @Post('custom/:requestId/decline')
  declineCustom(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.custom.declineToQuote(user.id, requestId, dto.reason);
  }

  /** The collector agrees to the quote. THIS is what charges the wallet. */
  @Post('custom/:requestId/accept-quote')
  acceptCustomQuote(@CurrentUser() user: AuthUser, @Param('requestId') requestId: string) {
    return this.custom.acceptQuote(user.id, requestId);
  }

  /** Or turns it down. Nothing was charged, so nothing unwinds. */
  @Post('custom/:requestId/decline-quote')
  declineCustomQuote(@CurrentUser() user: AuthUser, @Param('requestId') requestId: string) {
    return this.custom.declineQuote(user.id, requestId);
  }

  /** The work is done. Refused unless the collector accepted the quote first. */
  @Roles('warehouse_operator', 'admin')
  @Post('custom/:requestId/complete')
  completeCustom(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: CompletionNotesDto,
  ) {
    return this.custom.complete(user.id, requestId, dto.notes);
  }

  /** An operator puts a figure on an accepted buyout request. */
  @Roles('warehouse_operator', 'admin')
  @Post('buyout/:requestId/quote')
  quoteBuyout(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: BuyoutQuoteDto,
  ) {
    return this.buyouts.quote(user.id, requestId, dto);
  }

  /** The owner takes the offer — this is what moves the card and the money. */
  @Post('buyout/:requestId/accept')
  acceptBuyout(@CurrentUser() user: AuthUser, @Param('requestId') requestId: string) {
    return this.buyouts.accept(user.id, requestId);
  }

  @Post('buyout/:requestId/decline')
  declineBuyout(@CurrentUser() user: AuthUser, @Param('requestId') requestId: string) {
    return this.buyouts.decline(user.id, requestId);
  }

  @Post('consignment')
  requestConsignment(@CurrentUser() user: AuthUser, @Body() dto: ConsignDto) {
    return this.consignment.request(user.id, dto.itemId, dto.channel, dto.askingMinor, dto.eventId);
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
