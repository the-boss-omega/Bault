/**
 * Central schema barrel (T009/T010).
 *
 * Aggregates every module's tables into one `schema` object handed to Drizzle so
 * the client is fully typed and relational queries work. Each MODULE still owns
 * its own table definitions (plan.md: a module touches only its own tables);
 * this file only re-exports them for the DB client and drizzle-kit.
 */
export * from '../../modules/acc/acc.schema';
export * from '../../modules/acc/address.schema';
export * from '../../modules/adm/adm.schema';
export * from '../../modules/cst/cst.schema';
export * from '../../modules/sec/audit.schema';
export * from '../../modules/not/outbox/outbox.schema';
export * from '../../modules/not/notification.schema';
export * from '../../modules/pay/pay.schema';
export * from '../../modules/prc/prc.schema';
export * from '../../modules/mkt/mkt.schema';
export * from '../../modules/mkt/house.schema';
export * from '../../modules/dis/dis.schema';
export * from '../../modules/dis/consignment-event.schema';
export * from '../../modules/dis/grading-submission.schema';
export * from '../../modules/shp/shipment-group.schema';
export * from '../../modules/esc/escrow.schema';
export * from '../../modules/inv/disposal.schema';
export * from '../../modules/inv/facility.schema';
export * from '../../modules/inv/parcel.schema';
export * from '../../modules/sup/sup.schema';
export * from '../../modules/shp/shp.schema';
export * from '../../shared/idempotency/idempotency.schema';
export * from '../../shared/confirmation/confirmation.schema';
