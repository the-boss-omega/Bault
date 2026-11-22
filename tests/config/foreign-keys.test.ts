import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../../apps/api/src/db/migrations', import.meta.url));

const CONSTRAINED: ReadonlyArray<readonly [table: string, column: string, references: string]> = [
  ['verification_token', 'user_id', 'user_account'],
  ['login_session', 'user_id', 'user_account'],
  ['login_attempt', 'user_id', 'user_account'],
  ['mfa_factor', 'user_id', 'user_account'],
  ['mfa_email_code', 'user_id', 'user_account'],
  ['mfa_recovery_code', 'user_id', 'user_account'],
  ['mfa_challenge', 'user_id', 'user_account'],
  ['shipping_address', 'user_id', 'user_account'],
  ['confirmation_token', 'user_id', 'user_account'],
  ['idempotency_key', 'user_id', 'user_account'],
  ['notification', 'user_id', 'user_account'],
  ['notification_preference', 'user_id', 'user_account'],
  ['audit_record', 'actor_id', 'user_account'],
  ['media_upload', 'uploaded_by', 'user_account'],
  ['pricing_rule', 'updated_by', 'user_account'],

  ['ledger_record', 'user_id', 'user_account'],
  ['external_payment', 'user_id', 'user_account'],
  ['charge', 'user_id', 'user_account'],
  ['withdrawal', 'user_id', 'user_account'],
  ['wallet_request', 'user_id', 'user_account'],
  ['wallet_request', 'reviewed_by', 'user_account'],
  ['wallet_request', 'settled_ledger_id', 'ledger_record'],
  ['wallet_request', 'payout_payment_id', 'external_payment'],
  ['wallet_request_event', 'request_id', 'wallet_request'],
  ['wallet_request_event', 'actor_id', 'user_account'],
  ['membership', 'user_id', 'user_account'],
  ['membership_period', 'membership_id', 'membership'],
  ['membership_period', 'user_id', 'user_account'],

  ['batch', 'owner_id', 'user_account'],
  ['item', 'owner_id', 'user_account'],
  ['item', 'source_batch_id', 'batch'],
  ['item', 'source_parcel_id', 'parcel'],
  ['item_image', 'item_id', 'item'],
  ['item_change_history', 'item_id', 'item'],
  ['item_change_history', 'actor_id', 'user_account'],
  ['bin_transfer', 'item_id', 'item'],
  ['bin_transfer', 'actor_id', 'user_account'],
  ['custody_event', 'item_id', 'item'],
  ['custody_event', 'prev_owner_id', 'user_account'],
  ['custody_event', 'new_owner_id', 'user_account'],
  ['custody_event', 'actor_id', 'user_account'],
  ['storage_cover', 'item_id', 'item'],
  ['bin', 'facility_id', 'facility'],
  ['facility', 'forwards_to_facility_id', 'facility'],
  ['parcel', 'owner_id', 'user_account'],
  ['parcel', 'facility_id', 'facility'],
  ['parcel', 'forwarded_from_facility_id', 'facility'],
  ['parcel', 'received_by', 'user_account'],
  ['parcel', 'opened_by', 'user_account'],
  ['parcel_event', 'parcel_id', 'parcel'],
  ['parcel_event', 'actor_id', 'user_account'],
  ['parcel_event', 'facility_id', 'facility'],
  ['parcel_photo', 'parcel_id', 'parcel'],
  ['parcel_photo', 'uploaded_by', 'user_account'],
  ['arrival_disposal', 'owner_id', 'user_account'],
  ['arrival_disposal', 'actor_id', 'user_account'],

  ['listing', 'item_id', 'item'],
  ['listing', 'seller_id', 'user_account'],
  ['transaction', 'buyer_id', 'user_account'],
  ['transaction', 'seller_id', 'user_account'],
  ['offer', 'listing_id', 'listing'],
  ['offer', 'buyer_id', 'user_account'],
  ['offer', 'parent_offer_id', 'offer'],
  ['swap_proposal', 'proposer_id', 'user_account'],
  ['swap_proposal', 'responder_id', 'user_account'],
  ['house_listing', 'created_by', 'user_account'],
  ['house_order', 'house_listing_id', 'house_listing'],
  ['house_order', 'buyer_id', 'user_account'],
  ['house_order', 'item_id', 'item'],
  ['house_order', 'transaction_id', 'transaction'],
  ['house_order', 'stowed_by', 'user_account'],
  ['dispute', 'transaction_id', 'transaction'],
  ['dispute', 'opened_by', 'user_account'],
  ['dispute', 'assigned_admin_id', 'user_account'],

  ['service_request', 'requester_id', 'user_account'],
  ['service_request', 'item_id', 'item'],
  ['service_request', 'batch_id', 'batch'],
  ['service_request', 'charge_id', 'charge'],
  ['service_request', 'fulfilled_by', 'user_account'],
  ['grading_submission', 'shipped_by', 'user_account'],
  ['escrow_deal', 'raised_by', 'user_account'],
  ['escrow_deal', 'counterparty_user_id', 'user_account'],
  ['escrow_deal', 'funding_attested_by', 'user_account'],
  ['escrow_deal', 'item_id', 'item'],
  ['escrow_deal', 'inspected_by', 'user_account'],
  ['escrow_deal', 'buyer_release_attested_by', 'user_account'],
  ['escrow_deal', 'seller_release_attested_by', 'user_account'],
  ['escrow_event', 'deal_id', 'escrow_deal'],
  ['escrow_event', 'actor_id', 'user_account'],
  ['support_ticket', 'user_id', 'user_account'],
  ['support_ticket', 'resolved_by', 'user_account'],
  ['support_message', 'ticket_id', 'support_ticket'],
  ['support_message', 'author_id', 'user_account'],

  ['shipment', 'user_id', 'user_account'],
  ['shipment', 'quoted_by', 'user_account'],
  ['shipment', 'handed_over_by', 'user_account'],
  ['shipment', 'fulfilled_by', 'user_account'],
  ['shipment', 'pickup_event_id', 'consignment_event'],
  ['shipment', 'merged_into_shipment_id', 'shipment'],
  ['shipment', 'group_id', 'shipment_group'],
  ['shipment_group', 'payer_user_id', 'user_account'],
];

const ident = '"?([a-z_]+)"?';
const qualified = `(?:"?public"?\\.)?${ident}`;

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function declaredForeignKeys(sql: string): Map<string, string> {
  const found = new Map<string, string>();
  const tableBlock = new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?${qualified}([\\s\\S]*?);`, 'gi');
  const fk = new RegExp(`FOREIGN KEY\\s*\\(\\s*${ident}\\s*\\)\\s*REFERENCES\\s+${qualified}\\s*\\(\\s*"?id"?\\s*\\)`, 'gi');
  for (const block of sql.matchAll(tableBlock)) {
    for (const m of block[2]!.matchAll(fk)) found.set(`${block[1]}.${m[1]}`, m[2]!);
  }
  const createBlock = new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${qualified}\\s*\\(([\\s\\S]*?)\\n\\);`, 'gi');
  const inline = new RegExp(`^\\s*${ident}\\s+[a-z]+[^,\\n]*?REFERENCES\\s+${qualified}\\s*\\(\\s*"?id"?\\s*\\)`, 'gim');
  for (const block of sql.matchAll(createBlock)) {
    for (const m of block[2]!.matchAll(inline)) found.set(`${block[1]}.${m[1]}`, m[2]!);
  }
  return found;
}

describe('foreign keys on the tables that hold money and ownership', () => {
  const declared = declaredForeignKeys(withoutComments(migrationSql()));

  it.each(CONSTRAINED.map(([t, c, r]) => [`${t}.${c}`, r]))('%s references %s', (column, references) => {
    expect(declared.get(column), `${column} has no FOREIGN KEY in the migrations`).toBe(references);
  });

  it('names every constrained column once', () => {
    const names = CONSTRAINED.map(([t, c]) => `${t}.${c}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('adds every new key without a full-table lock and with ON DELETE RESTRICT', () => {
    const sql = withoutComments(migrationSql());
    const added = [...sql.matchAll(/ADD CONSTRAINT\s+"?([a-z0-9_]+)"?\s+FOREIGN KEY[^;]*?;/gi)];
    const restricted = added.filter((m) => /ON DELETE RESTRICT/i.test(m[0]));
    expect(restricted.length).toBeGreaterThan(0);
    for (const m of restricted) {
      expect(m[0], `${m[1]} is not added NOT VALID`).toMatch(/NOT VALID/i);
      expect(sql, `${m[1]} is never validated`).toMatch(new RegExp(`VALIDATE CONSTRAINT\\s+"?${m[1]}"?`, 'i'));
    }
  });
});
