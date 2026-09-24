/**
 * Bault's FAQ — what Bault does, in its own words, in both languages.
 *
 * This replaced a catalogue copied verbatim from another company's FAQ, quoted
 * in English with a badge on every entry saying whether Bault did the same.
 * That was honest about provenance and useless as help: a collector asking how
 * storage works was shown someone else's storage policy and a note explaining
 * how Bault's differed.
 *
 * The rule this file holds itself to is the guides' rule. Every sentence is a
 * statement about how Bault behaves today, and every figure in it is one the
 * code charges or enforces — the intake and service fees are the seeded pricing
 * rules, the storage terms are the storage sweep's parameters, the cash-out
 * schedule is `money-terms.ts`, the shipping figures are `shipping-options.ts`,
 * the grading tiers are `grading-tiers.ts` and the memberships are `tiers.ts`.
 * When one of those changes, the entry that quotes it changes with it. The price
 * list on the Prices tab is read from the API and is always current; the answers
 * here link to it rather than trying to be a second price list.
 *
 * Inline markers inside `text`: `**bold**` and `[[label|#/route]]` for a link to
 * a screen in the app. See `renderInline` in FaqLegalPage.tsx.
 */

export type FaqLocale = 'en' | 'he';

export type FaqBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

export interface FaqEntry {
  /** Stable slug used by deep links (`#/faq/faq?q=<id>`) and by Ask's results. */
  id: string;
  category: FaqCategory;
  question: Record<FaqLocale, string>;
  answer: Record<FaqLocale, FaqBlock[]>;
}

export type FaqCategory =
  | 'getting-started'
  | 'addresses'
  | 'intake'
  | 'fees'
  | 'shipping'
  | 'services'
  | 'marketplace'
  | 'wallet'
  | 'account';

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  'getting-started',
  'addresses',
  'intake',
  'fees',
  'shipping',
  'services',
  'marketplace',
  'wallet',
  'account',
];

const p = (text: string): FaqBlock => ({ kind: 'p', text });
const ul = (...items: string[]): FaqBlock => ({ kind: 'ul', items });

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  /* ---------------- Getting started ---------------- */
  {
    id: 'what-is-bault',
    category: 'getting-started',
    question: { en: 'What is Bault?', he: 'מה זה Bault?' },
    answer: {
      en: [
        p('Bault is a custody vault for collectibles in the United States. You buy from any U.S. seller and have it sent to your own Bault receiving address. We receive the parcel, open it, book every item into your vault with its own serial number and label, and keep it on a shelf.'),
        p('From your vault you can sell on the marketplace, trade, send an item for grading or another service, or ship it home — and every one of those steps is written to a permanent custody record. Fees are paid from your Bault wallet.'),
      ],
      he: [
        p('Bault היא כספת משמורת לפריטי אספנות בארצות הברית. קונים מכל מוכר אמריקאי ושולחים לכתובת הקבלה האישית שלכם ב־Bault. אנחנו מקבלים את החבילה, פותחים אותה, רושמים כל פריט בכספת שלכם עם מספר סידורי ותווית משלו, ומאחסנים אותו על מדף.'),
        p('מהכספת אפשר למכור בשוק, להחליף, לשלוח פריט לדירוג או לשירות אחר, או לשלוח אותו הביתה — וכל צעד כזה נרשם ברישום משמורת קבוע. העמלות משולמות מהארנק שלכם ב־Bault.'),
      ],
    },
  },
  {
    id: 'getting-started',
    category: 'getting-started',
    question: { en: 'How do I get started?', he: 'איך מתחילים?' },
    answer: {
      en: [
        ul(
          'Create an account and confirm your email address from the link we send (it is valid for 24 hours).',
          'Add a delivery address in [[Profile > Addresses|#/profile/addresses]] — that is where items go when you ship them home.',
          'Add money to your [[wallet|#/wallet/cash-in]], so receiving and intake fees can be paid.',
          'Copy your receiving address from [[Inbound > My addresses|#/inbound/addresses]] and use it as the shipping address when you buy.',
        ),
        p('The [[first-week guide|#/faq/guides?g=first-week]] walks through the same steps screen by screen.'),
      ],
      he: [
        ul(
          'פותחים חשבון ומאשרים את כתובת הדוא״ל מהקישור שנשלח (הוא בתוקף ל־24 שעות).',
          'מוסיפים כתובת למשלוח ב[[פרופיל > כתובות|#/profile/addresses]] — לשם יישלחו פריטים כשתשלחו אותם הביתה.',
          'טוענים כסף ל[[ארנק|#/wallet/cash-in]], כדי שאפשר יהיה לשלם עמלות קבלה וקליטה.',
          'מעתיקים את כתובת הקבלה מ[[נכנס > הכתובות שלי|#/inbound/addresses]] ומשתמשים בה ככתובת המשלוח בכל רכישה.',
        ),
        p('[[המדריך לשבוע הראשון|#/faq/guides?g=first-week]] עובר על אותם שלבים, מסך אחר מסך.'),
      ],
    },
  },
  {
    id: 'custody-record',
    category: 'getting-started',
    question: { en: 'What is the custody record, and can it be changed?', he: 'מהו רישום המשמורת, ואפשר לשנות אותו?' },
    answer: {
      en: [
        p('Every item has a history: who owned it, which shelf it sat on, what state it was in, and when each of those changed. That log, your wallet ledger and the history of every cash-in and cash-out request are **append-only** — nobody can edit or delete them, including Bault staff.'),
        p('A mistake is corrected by adding a new, offsetting record, never by rewriting an old one. An item that leaves your vault stays in your history, and a refunded fee stays on your ledger next to the credit that refunded it.'),
      ],
      he: [
        p('לכל פריט יש היסטוריה: מי היה הבעלים, על איזה מדף הוא עמד, באיזה מצב היה, ומתי כל אחד מאלה השתנה. היומן הזה, יומן הארנק שלכם וההיסטוריה של כל בקשת הפקדה ומשיכה **נכתבים בהוספה בלבד** — אף אחד לא יכול לערוך או למחוק אותם, כולל צוות Bault.'),
        p('טעות מתוקנת ברישום חדש ומקזז, לעולם לא בשכתוב של רישום קודם. פריט שיצא מהכספת נשאר בהיסטוריה שלכם, ועמלה שהוחזרה נשארת ביומן לצד הזיכוי שהחזיר אותה.'),
      ],
    },
  },

  /* ---------------- Addresses ---------------- */
  {
    id: 'receiving-address',
    category: 'addresses',
    question: { en: 'Which address do I give a seller?', he: 'איזו כתובת נותנים למוכר?' },
    answer: {
      en: [
        p('Your own receiving address, from [[Inbound > My addresses|#/inbound/addresses]]. Copy the whole block into the seller’s checkout. It includes the line **Bault C/O <your username>**, and that line is what ties an arriving parcel to your account.'),
        p('A parcel without it, or with a username that does not exist, cannot be attributed to anyone. It is recorded and held unopened as unclaimed for 12 months; contact us with the carrier and tracking number and we will attribute it to you.'),
      ],
      he: [
        p('את כתובת הקבלה האישית שלכם, מ[[נכנס > הכתובות שלי|#/inbound/addresses]]. מעתיקים את הבלוק כולו לקופה של המוכר. הוא כולל את השורה **Bault C/O <שם המשתמש שלכם>**, והיא זו שמקשרת חבילה שמגיעה לחשבון שלכם.'),
        p('חבילה בלי השורה הזו, או עם שם משתמש שלא קיים, לא ניתנת לשיוך לאף אחד. היא נרשמת ונשמרת סגורה כ״לא נתבעה״ במשך 12 חודשים; פנו אלינו עם שם חברת השילוח ומספר המעקב ונשייך אותה אליכם.'),
      ],
    },
  },
  {
    id: 'two-addresses',
    category: 'addresses',
    question: { en: 'Why do I have two addresses, and which should I use?', he: 'למה יש לי שתי כתובות, ובאיזו כדאי להשתמש?' },
    answer: {
      en: [
        p('**New Jersey** is the vault itself: a parcel sent there arrives straight at the warehouse. **Delaware** is a receiving point that stores nothing — everything that lands there is forwarded to New Jersey, which adds a forwarding fee ($4.00 per parcel) and about 4 days.'),
        p('The trade-off is sales tax against time. The rate shown against each address is the destination state’s: 6.625% in New Jersey, none in Delaware. Bault is not the seller of what you buy elsewhere and neither collects nor remits sales tax on it — what you are charged is decided by the seller and by where the goods ship.'),
      ],
      he: [
        p('**ניו ג׳רזי** היא הכספת עצמה: חבילה שנשלחת לשם מגיעה ישר למחסן. **דלאוור** היא נקודת קבלה שלא מאחסנת דבר — כל מה שמגיע אליה מועבר לניו ג׳רזי, וזה מוסיף עמלת העברה ($4.00 לחבילה) וכ־4 ימים.'),
        p('הבחירה היא בין מס מכירה לזמן. השיעור שמוצג ליד כל כתובת הוא של מדינת היעד: 6.625% בניו ג׳רזי, ללא מס בדלאוור. Bault אינה המוכרת של מה שאתם קונים במקום אחר, ואינה גובה או מעבירה עליו מס מכירה — הסכום שתחויבו נקבע על ידי המוכר ולפי יעד המשלוח.'),
      ],
    },
  },
  {
    id: 'register-parcel',
    category: 'addresses',
    question: { en: 'Do I have to register a parcel before it arrives?', he: 'צריך לרשום חבילה לפני שהיא מגיעה?' },
    answer: {
      en: [
        p('No — it is optional, and it does not change how the parcel is handled. Registering it in [[Inbound > Parcels|#/inbound/parcels]] lets you follow it, and gives the person receiving it a tracking number to match, which is what lets a parcel be attributed to you before anyone opens it.'),
        p('If a parcel is coming from outside the United States, mark it as international when you register it. You are the importer of record: customs clearance and any duty, tax or brokerage charge are yours, and Bault cannot release a parcel held by customs.'),
      ],
      he: [
        p('לא — זה רשות, וזה לא משנה את אופן הטיפול בחבילה. רישום ב[[נכנס > חבילות|#/inbound/parcels]] מאפשר לכם לעקוב אחריה, ונותן למי שמקבל אותה מספר מעקב להתאים אליו — וכך אפשר לשייך את החבילה אליכם עוד לפני שמישהו פותח אותה.'),
        p('אם החבילה מגיעה מחוץ לארצות הברית, סמנו אותה כבינלאומית ברישום. אתם היבואנים הרשומים: שחרור מהמכס וכל מכס, מס או עמלת עמילות הם באחריותכם, ו־Bault לא יכולה לשחרר חבילה שמוחזקת במכס.'),
      ],
    },
  },

  /* ---------------- Intake ---------------- */
  {
    id: 'parcel-arrives',
    category: 'intake',
    question: { en: 'What happens when my parcel arrives?', he: 'מה קורה כשהחבילה שלי מגיעה?' },
    answer: {
      en: [
        ul(
          '**Received** — the parcel is logged against your account.',
          '**Opened and checked** — its condition is recorded, with photos when there is damage.',
          '**Booked in** — each item gets a serial number and a printed label, and is put on a shelf in your vault.',
          '**Closed out** — the parcel is checked against the count of what came out of it.',
        ),
        p('You are notified at each step. Receiving and opening a parcel costs $2.00, and each item is charged its intake fee when it is booked in.'),
      ],
      he: [
        ul(
          '**התקבלה** — החבילה נרשמת על החשבון שלכם.',
          '**נפתחה ונבדקה** — מצבה נרשם, עם תמונות כשיש נזק.',
          '**נקלטה** — כל פריט מקבל מספר סידורי ותווית מודפסת, ומונח על מדף בכספת שלכם.',
          '**נסגרה** — החבילה מושווית למספר הפריטים שיצאו ממנה.',
        ),
        p('תקבלו התראה בכל שלב. קבלה ופתיחה של חבילה עולות $2.00, וכל פריט מחויב בעמלת הקליטה שלו כשהוא נרשם.'),
      ],
    },
  },
  {
    id: 'intake-fees',
    category: 'intake',
    question: { en: 'How much does intake cost?', he: 'כמה עולה קליטה?' },
    answer: {
      en: [
        p('Intake is charged once per item, by what the item is:'),
        ul(
          'Single card or graded slab: $1.00',
          'Oversized card, sealed pack, sealed box, comic (raw or graded), small collectible: $5.00',
          'Collection box: $10.00',
          'Sealed case, memorabilia: $20.00',
        ),
        p('Six or more cards can be received together as **one lot** for $5.00; five or fewer are always received individually, each with its own label. The intake fee also buys the item’s included storage period. The [[price list|#/faq/prices]] is always current.'),
      ],
      he: [
        p('קליטה מחויבת פעם אחת לכל פריט, לפי סוג הפריט:'),
        ul(
          'קלף בודד או קלף מדורג בסלאב: $1.00',
          'קלף גדול, חבילת קלפים סגורה, קופסה סגורה, קומיקס (רגיל או מדורג), פריט אספנות קטן: $5.00',
          'קופסת אוסף: $10.00',
          'ארגז סגור, מזכרות: $20.00',
        ),
        p('שישה קלפים ומעלה אפשר לקלוט יחד **כלוט אחד** ב־$5.00; חמישה ומטה נקלטים תמיד בנפרד, כל אחד עם תווית משלו. עמלת הקליטה כוללת גם את תקופת האחסון הכלולה של הפריט. [[מחירון|#/faq/prices]] תמיד מעודכן.'),
      ],
    },
  },
  {
    id: 'not-accepted',
    category: 'intake',
    question: { en: 'Is there anything you won’t accept?', he: 'יש דברים שלא תקבלו?' },
    answer: {
      en: [
        p('For safety, legal and security reasons, these are never placed in a vault:'),
        ul(
          'liquids, glass, oils or gases, and anything flammable',
          'drugs, medicine or supplements; cosmetics or perfume',
          'anything containing a lithium battery',
          'GPS trackers, including Apple AirTags',
          'adult material',
        ),
        p('They are disposed of and cannot be returned, and you are not charged intake or storage for them. Every such case is recorded, you are notified, and the record is under [[Shipping & Services > Not accepted|#/shipping-services/not-accepted]]. The full rules are on [[What we accept|#/faq/policy]].'),
      ],
      he: [
        p('מטעמי בטיחות, חוק ואבטחה, הדברים הבאים לא נכנסים לכספת:'),
        ul(
          'נוזלים, זכוכית, שמנים או גזים, וכל דבר דליק',
          'סמים, תרופות או תוספי תזונה; קוסמטיקה או בשמים',
          'כל דבר שמכיל סוללת ליתיום',
          'מכשירי GPS, כולל Apple AirTag',
          'חומר למבוגרים',
        ),
        p('הם מושמדים ולא ניתן להחזיר אותם, ולא תחויבו עליהם בקליטה או אחסון. כל מקרה כזה נרשם, תקבלו התראה, והרישום נמצא ב[[משלוחים ושירותים > לא התקבל|#/shipping-services/not-accepted]]. הכללים המלאים ב[[מה אנחנו מקבלים|#/faq/policy]].'),
      ],
    },
  },
  {
    id: 'remove-commons',
    category: 'intake',
    question: { en: 'Can I get rid of items I don’t want to keep?', he: 'אפשר להיפטר מפריטים שלא רוצים לשמור?' },
    answer: {
      en: [
        p('Yes. **Remove commons** in your vault lets you discard or donate items that arrived in the last 30 days, several at once, free of charge — so a bulk purchase does not leave you paying to store the cards you never wanted.'),
        p('A discarded item is destroyed; a donated one leaves your ownership. Both stay in your history, and neither can be undone.'),
      ],
      he: [
        p('כן. **הסרת פריטים זולים** בכספת מאפשרת להשליך או לתרום פריטים שהגיעו ב־30 הימים האחרונים, כמה בבת אחת, ללא עלות — כדי שרכישה בכמות לא תשאיר אתכם משלמים על אחסון של קלפים שמעולם לא רציתם.'),
        p('פריט שהושלך מושמד; פריט שנתרם יוצא מהבעלות שלכם. שניהם נשארים בהיסטוריה, ואף אחד מהם לא ניתן לביטול.'),
      ],
    },
  },

  /* ---------------- Fees & balance ---------------- */
  {
    id: 'storage',
    category: 'fees',
    question: { en: 'How is storage charged?', he: 'איך מחויב אחסון?' },
    answer: {
      en: [
        p('Storage is not billed by the day. A storage period is included in the intake fee you already paid, and only after it ends does storage cost anything:'),
        ul(
          '**Standard items** — 180 days included, then 10% of that item’s intake fee every 90 days.',
          '**Oversized items** — 90 days included, then the full intake fee again every 90 days.',
        ),
        p('So storing a single card for a year after its included period costs a few cents. Each item’s panel in your vault shows its terms, what storage has cost it so far and when the next charge falls. A [[membership|#/membership]] covers storage for a set number of items, and periods it covers are never billed later.'),
      ],
      he: [
        p('אחסון לא מחויב לפי יום. תקופת אחסון כלולה בעמלת הקליטה שכבר שילמתם, ורק כשהיא מסתיימת האחסון מתחיל לעלות:'),
        ul(
          '**פריטים רגילים** — 180 יום כלולים, ואחר כך 10% מעמלת הקליטה של אותו פריט כל 90 יום.',
          '**פריטים גדולים** — 90 יום כלולים, ואחר כך עמלת הקליטה המלאה שוב כל 90 יום.',
        ),
        p('כך שאחסון של קלף בודד שנה אחרי התקופה הכלולה עולה סנטים בודדים. בחלון של כל פריט בכספת מוצגים התנאים שלו, כמה עלה לו האחסון עד כה ומתי החיוב הבא. [[מנוי|#/membership]] מכסה אחסון של מספר פריטים קבוע, ותקופות שהוא כיסה לעולם לא יחויבו בדיעבד.'),
      ],
    },
  },
  {
    id: 'membership',
    category: 'fees',
    question: { en: 'What does a membership include?', he: 'מה כולל מנוי?' },
    answer: {
      en: [
        p('Three monthly tiers. Each includes a monthly allowance of Bault’s fees; anything beyond it is charged at the normal price.'),
        ul(
          '**Folio — $39/month.** Storage for 60 items, 4 intakes, 2 parcels received, 2 slabs cracked, 1 insured shipment up to $500, $10 postage credit.',
          '**Registry — $199/month.** Storage for 200 items (including oversized), 10 intakes, 5 parcels, 2 forwarding legs, 2 condition inspections and 2 video reviews, 3 insured shipments up to $1,000, $30 postage credit, no sale commission on the first $1,000 of sales, rush packing and priority handling.',
          '**Trust — $699/month.** Storage for 750 items, 25 intakes, unlimited parcels, forwarding and slab cracking, 8 services, 8 inspections and 8 video reviews, 2 GPS trackers, 6 insured shipments up to $2,500, $100 postage credit, no sale commission on the first $3,000, one escrow deal up to $5,000 without the escrow fee, 2 free cash-outs, 2 show pickups, and a named contact.',
        ),
        p('Compare them side by side, and join or switch, on [[Membership|#/membership]].'),
      ],
      he: [
        p('שלוש דרגות חודשיות. כל אחת כוללת מכסה חודשית של עמלות Bault; מה שמעבר למכסה מחויב במחיר הרגיל.'),
        ul(
          '**Folio — $39 לחודש.** אחסון ל־60 פריטים, 4 קליטות, 2 חבילות, פתיחת 2 סלאבים, משלוח מבוטח אחד עד $500, זיכוי דמי משלוח של $10.',
          '**Registry — $199 לחודש.** אחסון ל־200 פריטים (כולל פריטים גדולים), 10 קליטות, 5 חבילות, 2 העברות, 2 בדיקות מצב ו־2 סקירות וידאו, 3 משלוחים מבוטחים עד $1,000, זיכוי דמי משלוח של $30, ללא עמלת מכירה על $1,000 המכירות הראשונים, אריזה דחופה וטיפול בעדיפות.',
          '**Trust — $699 לחודש.** אחסון ל־750 פריטים, 25 קליטות, חבילות, העברות ופתיחת סלאבים ללא הגבלה, 8 שירותים, 8 בדיקות מצב ו־8 סקירות וידאו, 2 מכשירי מעקב GPS, 6 משלוחים מבוטחים עד $2,500, זיכוי דמי משלוח של $100, ללא עמלת מכירה על $3,000 הראשונים, עסקת נאמנות אחת עד $5,000 ללא עמלת נאמנות, 2 משיכות ללא עמלה, 2 איסופים בתערוכה ואיש קשר קבוע.',
        ),
        p('השוואה מלאה, הצטרפות והחלפת דרגה ב[[מנוי|#/membership]].'),
      ],
    },
  },
  {
    id: 'negative-balance',
    category: 'fees',
    question: { en: 'What happens if my balance goes negative?', he: 'מה קורה אם היתרה שלי שלילית?' },
    answer: {
      en: [
        p('A fee is never refused because you are short, so a balance can go below zero. While it is negative, new shipments and service requests are refused until it is positive again. After that:'),
        ul(
          'The first **14 days** of a debt cost nothing.',
          'After that, interest accrues daily at **0.05%** of the debt, shown on your ledger.',
          'Below **−$20.00** the account is suspended until the debt clears. You can still sign in and open a support ticket, and the suspension lifts automatically once the balance is back above the threshold.',
        ),
        p('Items are never seized: a suspended account still owns everything in its vault.'),
      ],
      he: [
        p('עמלה לא נדחית בגלל חוסר ביתרה, ולכן יתרה יכולה לרדת מתחת לאפס. כל עוד היא שלילית, משלוחים ובקשות שירות חדשים נדחים עד שהיא חוזרת להיות חיובית. מעבר לזה:'),
        ul(
          '**14 הימים** הראשונים של חוב לא עולים כלום.',
          'אחר כך נצברת ריבית יומית של **0.05%** מהחוב, שמוצגת ביומן שלכם.',
          'מתחת ל־**‎−$20.00** החשבון מושעה עד שהחוב מוסדר. עדיין אפשר להתחבר ולפתוח פנייה לתמיכה, וההשעיה מוסרת אוטומטית כשהיתרה חוזרת מעל הסף.',
        ),
        p('פריטים לעולם לא מעוקלים: חשבון מושעה עדיין הבעלים של כל מה שבכספת שלו.'),
      ],
    },
  },
  {
    id: 'price-changes',
    category: 'fees',
    question: { en: 'Can a price change affect what I have already paid?', he: 'שינוי מחיר יכול להשפיע על מה שכבר שילמתי?' },
    answer: {
      en: [p('No. Every charge records the pricing rule that was in force when it was made, so a later price change never alters what you were billed. The current prices are on the [[price list|#/faq/prices]].')],
      he: [p('לא. כל חיוב שומר את כלל התמחור שהיה בתוקף ברגע החיוב, כך ששינוי מחיר מאוחר יותר לעולם לא משנה את מה שחויבתם. המחירים הנוכחיים ב[[מחירון|#/faq/prices]].')],
    },
  },

  /* ---------------- Shipping ---------------- */
  {
    id: 'ship-home',
    category: 'shipping',
    question: { en: 'How do I ship items home?', he: 'איך שולחים פריטים הביתה?' },
    answer: {
      en: [
        p('In [[Shipping & Services > Shipping|#/shipping-services/shipping]], choose the items and a delivery address. Bault quotes each carrier service on the parcel’s real weight, box, destination and value, and says why a service cannot carry it when it can’t. You choose a rate and it is paid from your wallet.'),
        p('If your wallet is short, the shipment is held for 7 days awaiting payment and the items go back on the shelf if it is never paid. Cancelling costs nothing until a rate is selected; after that a $25.00 restocking fee covers the checking and packing already done.'),
      ],
      he: [
        p('ב[[משלוחים ושירותים > משלוח|#/shipping-services/shipping]] בוחרים פריטים וכתובת למשלוח. Bault מתמחרת כל שירות שילוח לפי המשקל, הקופסה, היעד והשווי האמיתיים של החבילה, ומסבירה מדוע שירות מסוים לא יכול להוביל אותה כשזה המצב. בוחרים תעריף והוא משולם מהארנק.'),
        p('אם אין מספיק כסף בארנק, המשלוח ממתין לתשלום 7 ימים, והפריטים חוזרים למדף אם לא שולם. ביטול לא עולה כלום עד שנבחר תעריף; אחרי זה עמלת החזרה למלאי של $25.00 מכסה את הבדיקה והאריזה שכבר בוצעו.'),
      ],
    },
  },
  {
    id: 'insurance-signature',
    category: 'shipping',
    question: { en: 'Can I insure a shipment? Does it need a signature?', he: 'אפשר לבטח משלוח? צריך חתימה?' },
    answer: {
      en: [
        ul(
          '**Insurance** — up to $5,000 per shipment, for 1.5% of the insured value (minimum $2.00).',
          '**Signature** — required by the carrier whenever a parcel is insured for more than $500.',
          '**Rush** — same-day picking and packing, ahead of the queue: $10.00.',
          '**GPS tracker** — a tracker travels inside the parcel and is handed over to you after delivery: $30.00, on parcels insured for at least $500.',
        ),
      ],
      he: [
        ul(
          '**ביטוח** — עד $5,000 למשלוח, ב־1.5% מהסכום המבוטח (מינימום $2.00).',
          '**חתימה** — חברת השילוח דורשת חתימה בכל חבילה שמבוטחת ביותר מ־$500.',
          '**משלוח דחוף** — ליקוט ואריזה באותו יום, לפני התור: $10.00.',
          '**מכשיר מעקב GPS** — מכשיר מעקב נוסע בתוך החבילה ונמסר לכם אחרי המסירה: $30.00, בחבילות שמבוטחות ב־$500 לפחות.',
        ),
      ],
    },
  },
  {
    id: 'international-shipping',
    category: 'shipping',
    question: { en: 'Do you ship outside the United States?', he: 'אתם שולחים מחוץ לארצות הברית?' },
    answer: {
      en: [p('Yes. An international shipment needs a customs value for its contents, and Bault prepares the commercial invoice from it. Duties and taxes in the destination country are the recipient’s. The quote shows only services that can legally carry the parcel to that destination.')],
      he: [p('כן. משלוח בינלאומי דורש הצהרת שווי למכס על התכולה, ו־Bault מכינה ממנה את החשבונית המסחרית. מכסים ומסים בארץ היעד הם באחריות המקבל. בהצעת המחיר מוצגים רק שירותים שמורשים להוביל את החבילה ליעד הזה.')],
    },
  },
  {
    id: 'shared-parcels',
    category: 'shipping',
    question: { en: 'Can friends and I share one parcel?', he: 'אפשר לחלוק חבילה אחת עם חברים?' },
    answer: {
      en: [p('Yes — with [[shared parcels|#/shipping-services/shared]]. Each collector keeps their own shipment with their own items; the group is what says they travel together to one address and who pays the carrier. The person who opens the group is the payer, and joining is always each member’s own choice.')],
      he: [p('כן — עם [[חבילות משותפות|#/shipping-services/shared]]. כל אספן שומר על משלוח משלו עם הפריטים שלו; הקבוצה היא שקובעת שהם נוסעים יחד לכתובת אחת ומי משלם לחברת השילוח. מי שפותח את הקבוצה הוא המשלם, והצטרפות היא תמיד בחירה של כל חבר.')],
    },
  },
  {
    id: 'pickup-hand-delivery',
    category: 'shipping',
    question: { en: 'Can I collect in person, or have items hand-delivered?', he: 'אפשר לאסוף בעצמי, או לקבל מסירה ביד?' },
    answer: {
      en: [
        ul(
          '**Show pickup** — your items travel with Bault to a [[card show we are attending|#/faq/shows]] and you collect them there: $15.00.',
          '**Hand delivery** — a person takes your items to the address you give, within the windows you choose. It is quoted per journey (from $1,000 within the U.S. and $1,500 outside it, before travel), and your wallet is charged only when you accept the quote.',
        ),
      ],
      he: [
        ul(
          '**איסוף בתערוכה** — הפריטים נוסעים עם Bault ל[[תערוכה שבה אנחנו משתתפים|#/faq/shows]] ואתם אוספים אותם שם: $15.00.',
          '**מסירה ביד** — שליח לוקח את הפריטים לכתובת שתתנו, בחלונות הזמן שתבחרו. המחיר נקבע לכל נסיעה (החל מ־$1,000 בתוך ארה״ב ומ־$1,500 מחוצה לה, לפני הוצאות נסיעה), והארנק מחויב רק כשאתם מאשרים את ההצעה.',
        ),
      ],
    },
  },

  /* ---------------- Services ---------------- */
  {
    id: 'grading',
    category: 'services',
    question: { en: 'Can you send my cards for grading?', he: 'אפשר לשלוח קלפים לדירוג?' },
    answer: {
      en: [
        p('Yes. Choose a tier by the card’s declared value:'),
        ul(
          'PSA Value — $25.00, up to $499, 45–65 days',
          'PSA Regular — $75.00, up to $1,499, 20–30 days',
          'PSA Express — $150.00, up to $4,999, 10–15 days',
          'PSA Walkthrough — $300.00, no ceiling, 5–10 days; a manager approves it before it is sent',
          'BGS Standard — $65.00, up to $1,499, 25–40 days',
        ),
        p('Cards go to the grader in a batch. While a card is away it cannot be listed, sold or shipped; it comes back to the same vault with its grade recorded.'),
      ],
      he: [
        p('כן. בוחרים דרגה לפי השווי המוצהר של הקלף:'),
        ul(
          'PSA Value — $25.00, עד $499, ‏45–65 ימים',
          'PSA Regular — $75.00, עד $1,499, ‏20–30 ימים',
          'PSA Express — $150.00, עד $4,999, ‏10–15 ימים',
          'PSA Walkthrough — $300.00, ללא תקרה, 5–10 ימים; מנהל מאשר לפני השליחה',
          'BGS Standard — $65.00, עד $1,499, ‏25–40 ימים',
        ),
        p('הקלפים נשלחים לגוף הדירוג במשלוח מרוכז. כל עוד קלף נמצא שם, אי אפשר להציע אותו למכירה, למכור או לשלוח אותו; הוא חוזר לאותה כספת עם הציון שקיבל.'),
      ],
    },
  },
  {
    id: 'other-services',
    category: 'services',
    question: { en: 'What other services can I ask for?', he: 'אילו שירותים נוספים אפשר לבקש?' },
    answer: {
      en: [
        ul(
          '**Professional photography** — $20.00.',
          '**Condition inspection** — a report on the areas you choose, against a fixed severity scale: $15.00.',
          '**Video review** — a short video of the item turned under a light: $10.00.',
          '**Crack a slab** — the card is taken out of its holder and its grade replaced by a condition note: $5.00. This cannot be undone.',
          '**Lot split** — $20.00; the lot is broken into individual items, each with its own label and intake fee.',
          '**Custom request** — describe what you need; an operator replies with what they will do and a price, and you pay only if you accept.',
        ),
        p('All of them start from an item’s panel in your vault, and their progress is in [[Shipping & Services > Service requests|#/shipping-services/requests]].'),
      ],
      he: [
        ul(
          '**צילום מקצועי** — $20.00.',
          '**בדיקת מצב** — דוח על האזורים שתבחרו, לפי סולם חומרה קבוע: $15.00.',
          '**סקירת וידאו** — סרטון קצר של הפריט מסתובב מול תאורה: $10.00.',
          '**פתיחת סלאב** — הקלף מוצא מהמארז, והציון שלו מוחלף בהערת מצב: $5.00. לא ניתן לבטל.',
          '**פיצול לוט** — $20.00; הלוט מפורק לפריטים בודדים, כל אחד עם תווית ועמלת קליטה משלו.',
          '**בקשה מיוחדת** — מתארים מה צריך; איש צוות משיב מה יעשה ובאיזה מחיר, ומשלמים רק אם מאשרים.',
        ),
        p('כולם מתחילים מהחלון של הפריט בכספת, וההתקדמות מוצגת ב[[משלוחים ושירותים > בקשות שירות|#/shipping-services/requests]].'),
      ],
    },
  },
  {
    id: 'consignment-buyout',
    category: 'services',
    question: { en: 'Can Bault sell an item for me outside the marketplace, or buy it from me?', he: 'Bault יכולה למכור פריט בשבילי מחוץ לשוק, או לקנות אותו ממני?' },
    answer: {
      en: [
        p('**Consignment** sells an item through another channel, at a price you set. Bault’s commission is 10% at a card show we attend, and 1% through an auction house (graded items only, minimum $50) or through an eBay partner seller, whose own fees are separate.'),
        p('**Buyout** asks Bault for an offer ($20.00 to ask). An operator examines the item and quotes a figure with how it was reached; if you accept, ownership moves and your wallet is credited in the same step.'),
      ],
      he: [
        p('**קונסיגנציה** מוכרת פריט דרך ערוץ אחר, במחיר שאתם קובעים. העמלה של Bault היא 10% בתערוכה שבה אנחנו משתתפים, ו־1% דרך בית מכירות פומביות (פריטים מדורגים בלבד, מינימום $50) או דרך מוכר שותף ב־eBay, שהעמלות שלו נפרדות.'),
        p('**רכישה על ידי Bault** מבקשת מ־Bault הצעה ($20.00 לבקשה). איש צוות בוחן את הפריט ומציע סכום עם הסבר איך הגיע אליו; אם תאשרו, הבעלות עוברת והארנק שלכם מזוכה באותו צעד.'),
      ],
    },
  },

  /* ---------------- Marketplace ---------------- */
  {
    id: 'selling',
    category: 'marketplace',
    question: { en: 'How does selling on Bault work?', he: 'איך מוכרים ב־Bault?' },
    answer: {
      en: [
        p('List an item from your vault at a price, and it appears in the [[marketplace|#/marketplace/browse]]. Buyers pay from their wallet, or make an offer you can accept, counter or reject. When it sells, ownership and money move in one transaction — the item never leaves the shelf, so there is nothing to post.'),
        p('The seller pays a 5% commission on the sale price. Purchases are final once they have executed; the listing shows the item’s condition, photos and full history before anyone buys.'),
      ],
      he: [
        p('מציעים פריט מהכספת במחיר, והוא מופיע ב[[שוק|#/marketplace/browse]]. קונים משלמים מהארנק, או מגישים הצעה שאפשר לקבל, להשיב עליה בהצעה נגדית או לדחות. כשהפריט נמכר, הבעלות והכסף עוברים בפעולה אחת — הפריט לא זז מהמדף, אז אין מה לשלוח.'),
        p('המוכר משלם עמלה של 5% ממחיר המכירה. רכישה סופית ברגע שבוצעה; לפני הקנייה המודעה מציגה את מצב הפריט, התמונות וההיסטוריה המלאה שלו.'),
      ],
    },
  },
  {
    id: 'trades-escrow',
    category: 'marketplace',
    question: { en: 'Can I trade, or deal safely with someone I don’t know?', he: 'אפשר להחליף, או לבצע עסקה בטוחה עם מישהו שלא מכירים?' },
    answer: {
      en: [
        p('**Trades** swap items between two Bault collectors: propose what you give and what you want, and the swap executes when both sides approve.'),
        p('**Escrow** is for a private deal, including with someone outside Bault. The buyer funds the deal, the seller’s item is received and inspected, and the report is shared before either side releases. The fee is 1% of the agreed value, with a minimum of $25.00.'),
      ],
      he: [
        p('**החלפות** מחליפות פריטים בין שני אספנים ב־Bault: מציעים מה נותנים ומה רוצים, וההחלפה מתבצעת כששני הצדדים מאשרים.'),
        p('**נאמנות (Escrow)** נועדה לעסקה פרטית, גם עם מישהו מחוץ ל־Bault. הקונה מממן את העסקה, הפריט של המוכר מתקבל ונבדק, והדוח משותף לפני ששני הצדדים משחררים. העמלה היא 1% מהסכום המוסכם, ומינימום $25.00.'),
      ],
    },
  },
  {
    id: 'house-store',
    category: 'marketplace',
    question: { en: 'What is the Bault store?', he: 'מהי החנות של Bault?' },
    answer: {
      en: [p('Items Bault sells itself, at fixed prices, in [[Bault store|#/bault-store]]. What you buy is booked into your vault the moment you pay, with its own serial number and no intake fee; you can list or ship it once the warehouse has put it on a shelf.')],
      he: [p('פריטים ש־Bault מוכרת בעצמה, במחירים קבועים, ב[[החנות של Bault|#/bault-store]]. מה שקניתם נרשם בכספת שלכם ברגע התשלום, עם מספר סידורי משלו וללא עמלת קליטה; אפשר להציע אותו למכירה או לשלוח אותו אחרי שהמחסן הניח אותו על מדף.')],
    },
  },

  /* ---------------- Wallet ---------------- */
  {
    id: 'add-money',
    category: 'wallet',
    question: { en: 'How do I add money to my wallet?', he: 'איך מוסיפים כסף לארנק?' },
    answer: {
      en: [
        ul(
          '**Card** or **PayPal Goods & Services**, where offered, settle immediately.',
          '**Bank transfer** or **PayPal Friends & Family** are checked by a person against the statement, so the balance moves once the payment is confirmed. Put your username in the payment reference — it is the only thing that ties the money to your account.',
        ),
        p('A cash-in can be from $10 to $20,000. If you later reverse a card or PayPal payment with your bank, the amount is taken back and a $25.00 handling fee is charged; a support ticket is always the faster way to fix a problem. Start at [[Wallet > Cash in|#/wallet/cash-in]].'),
      ],
      he: [
        ul(
          '**כרטיס אשראי** או **PayPal Goods & Services**, כשהם זמינים, נכנסים מיד.',
          '**העברה בנקאית** או **PayPal Friends & Family** נבדקות על ידי אדם מול הדף, והיתרה מתעדכנת כשהתשלום מאושר. כתבו את שם המשתמש שלכם באסמכתת התשלום — זה הדבר היחיד שמקשר את הכסף לחשבון.',
        ),
        p('הפקדה יכולה להיות בין $10 ל־$20,000. אם תבטלו מאוחר יותר תשלום בכרטיס או ב־PayPal דרך הבנק, הסכום יוחזר ותחויבו בעמלת טיפול של $25.00; פנייה לתמיכה היא תמיד הדרך המהירה יותר לפתור בעיה. מתחילים ב[[ארנק > הפקדה|#/wallet/cash-in]].'),
      ],
    },
  },
  {
    id: 'cash-out',
    category: 'wallet',
    question: { en: 'How do I take money out, and what does it cost?', he: 'איך מושכים כסף, וכמה זה עולה?' },
    answer: {
      en: [
        p('Raise a cash-out request in [[Wallet > Cash out|#/wallet/cash-out]], from $20 to $20,000. A person reviews it and sends the payment. The fee is shown before you submit:'),
        ul('Up to $100: 6%, with a minimum of $0.99.', 'Above $100: $5.00 plus 1%.'),
        p('Your wallet goes down by exactly the amount you asked for; you receive that amount minus the fee.'),
      ],
      he: [
        p('מגישים בקשת משיכה ב[[ארנק > משיכה|#/wallet/cash-out]], בין $20 ל־$20,000. אדם בודק אותה ושולח את התשלום. העמלה מוצגת לפני השליחה:'),
        ul('עד $100: ‏6%, ומינימום $0.99.', 'מעל $100: ‏$5.00 ועוד 1%.'),
        p('הארנק יורד בדיוק בסכום שביקשתם; אתם מקבלים את הסכום הזה פחות העמלה.'),
      ],
    },
  },

  /* ---------------- Account ---------------- */
  {
    id: 'username',
    category: 'account',
    question: { en: 'Can I change my username?', he: 'אפשר לשנות את שם המשתמש?' },
    answer: {
      en: [p('No. Your username is chosen once and is permanent: it is how the warehouse routes parcels to your vault, and it appears on custody records that cannot be edited. Your first and last name can be changed at any time in [[Profile|#/profile/details]].')],
      he: [p('לא. שם המשתמש נבחר פעם אחת והוא קבוע: באמצעותו המחסן מנתב חבילות לכספת שלכם, והוא מופיע ברישומי משמורת שלא ניתנים לעריכה. את השם הפרטי ושם המשפחה אפשר לשנות בכל עת ב[[פרופיל|#/profile/details]].')],
    },
  },
  {
    id: 'security',
    category: 'account',
    question: { en: 'How do I keep my account secure?', he: 'איך שומרים על החשבון מאובטח?' },
    answer: {
      en: [p('A Bault account belongs to one person — never share your sign-in. In [[Profile > Security|#/profile/security]] you can change your password, which also signs out every other device, or sign out all other devices on their own. A sign-in lasts up to 7 days on a device.')],
      he: [p('חשבון Bault שייך לאדם אחד — לעולם אל תשתפו את פרטי ההתחברות. ב[[פרופיל > אבטחה|#/profile/security]] אפשר לשנות סיסמה, מה שגם מנתק את כל שאר המכשירים, או לנתק את כל שאר המכשירים בנפרד. התחברות נשמרת במכשיר עד 7 ימים.')],
    },
  },
  {
    id: 'reach-a-person',
    category: 'account',
    question: { en: 'How do I reach a person?', he: 'איך מגיעים לאדם?' },
    answer: {
      en: [p('[[Open a support ticket|#/support/new]]. It arrives with your account, items and codes attached, which is why it is the fastest way to get an answer, and you are notified when someone replies. Support stays open to you even if your account is suspended.')],
      he: [p('[[פתחו פנייה לתמיכה|#/support/new]]. היא מגיעה עם החשבון, הפריטים והקודים שלכם, ולכן היא הדרך המהירה ביותר לקבל תשובה, ותקבלו התראה כשמישהו עונה. התמיכה נשארת פתוחה לכם גם אם החשבון מושעה.')],
    },
  },
];

/** Flatten an answer to plain text: links keep their label, markers are dropped. */
export function plainText(text: string): string {
  return text.replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, '$1').replace(/\*\*/g, '');
}

/** Everything an entry says in one locale, for search. */
export function entryText(entry: FaqEntry, locale: FaqLocale): string {
  const parts = [entry.question[locale]];
  for (const block of entry.answer[locale]) {
    if (block.kind === 'p') parts.push(plainText(block.text));
    else parts.push(...block.items.map(plainText));
  }
  return parts.join('\n');
}
