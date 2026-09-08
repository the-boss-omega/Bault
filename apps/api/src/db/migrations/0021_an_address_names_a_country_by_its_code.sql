-- 0021 — An address names its country by the code the carriers read.
--
-- `shipping_address.country` was written by a free-text field whose pre-filled
-- value was the word "Israel". Every rule in `carriers.ts` compares this column
-- against an ISO 3166-1 alpha-2 code:
--
--     const international = parcel.destination.country !== 'US';
--     if (!service.countries.includes(parcel.destination.country)) …
--
-- so an address holding a display name was routed as international and then
-- refused by the very service its country IS contracted to — Israel is `IL`,
-- `IL` is on ePacket's list, and "Israel" is not. The collector lost the
-- cheapest international service they qualified for, and the refusal read
-- "ePacket International is not contracted to ISRAEL", which blames a carrier
-- for a text box.
--
-- The column is now written through `toCountryCode`, and the field is a select.
-- The rows already saved are translated here so an address created before the
-- fix starts quoting the right rates instead of waiting for somebody to notice
-- and re-type it.
UPDATE "shipping_address"
   SET "country" = CASE lower(trim("country"))
     WHEN 'united states'  THEN 'US' WHEN 'usa'            THEN 'US'
     WHEN 'united kingdom' THEN 'GB' WHEN 'great britain'  THEN 'GB'
     WHEN 'israel'         THEN 'IL' WHEN 'ישראל'          THEN 'IL'
     WHEN 'australia'      THEN 'AU' WHEN 'austria'        THEN 'AT'
     WHEN 'belgium'        THEN 'BE' WHEN 'brazil'         THEN 'BR'
     WHEN 'canada'         THEN 'CA' WHEN 'switzerland'    THEN 'CH'
     WHEN 'china'          THEN 'CN' WHEN 'czechia'        THEN 'CZ'
     WHEN 'germany'        THEN 'DE' WHEN 'denmark'        THEN 'DK'
     WHEN 'spain'          THEN 'ES' WHEN 'finland'        THEN 'FI'
     WHEN 'france'         THEN 'FR' WHEN 'greece'         THEN 'GR'
     WHEN 'hong kong'      THEN 'HK' WHEN 'hungary'        THEN 'HU'
     WHEN 'ireland'        THEN 'IE' WHEN 'italy'          THEN 'IT'
     WHEN 'japan'          THEN 'JP' WHEN 'south korea'    THEN 'KR'
     WHEN 'luxembourg'     THEN 'LU' WHEN 'mexico'         THEN 'MX'
     WHEN 'malaysia'       THEN 'MY' WHEN 'netherlands'    THEN 'NL'
     WHEN 'norway'         THEN 'NO' WHEN 'new zealand'    THEN 'NZ'
     WHEN 'poland'         THEN 'PL' WHEN 'portugal'       THEN 'PT'
     WHEN 'sweden'         THEN 'SE' WHEN 'singapore'      THEN 'SG'
     ELSE upper(trim("country"))
   END
 WHERE length(trim("country")) <> 2;
