export interface LegalSection {
  id: string;
  heading: string;
  body: string;
}

export interface LegalDocument {
  id: string;
  title: string;
  provenance: string;
  lastUpdated: string;
  downloadPath: string | null;
  draft?: boolean;
  version?: string;
  sections: LegalSection[];
}

export const TERMS_VERSION = '2026-10-draft-1';

export const DRAFT_NOTICE = 'DRAFT — must be reviewed by a lawyer before launch';

export const CONSENT_DOCUMENT_IDS = ['terms-of-service', 'privacy-policy', 'cookie-notice'] as const;

const section = (id: string, heading: string, ...paragraphs: string[]): LegalSection => ({
  id,
  heading,
  body: paragraphs.join('\n\n'),
});

const COUNSEL = (what: string) => `[TO BE COMPLETED BY COUNSEL: ${what}]`;

const TERMS_OF_SERVICE: LegalDocument = {
  id: 'terms-of-service',
  title: 'Terms of Service',
  provenance: 'legal.provenance.draft',
  lastUpdated: '2026-10-15',
  downloadPath: null,
  draft: true,
  version: TERMS_VERSION,
  sections: [
    section(
      'about',
      '1. About these terms',
      `These terms are an agreement between you and ${COUNSEL('the legal name, registered address and company number of the entity that operates Bault')} ("Bault", "we").`,
      `You accept them by ticking the box on the sign-up form. Bault records against your account which version you accepted (this one is ${TERMS_VERSION}) and when. An account cannot be created without accepting them.`,
      'They work together with the Account Use & Balance Policy, the Privacy Policy and the Cookie notice, all shown under FAQ & Legal > Legal Terms.',
      COUNSEL('who may open an account — minimum age, countries served, whether business customers are accepted'),
    ),
    section(
      'service',
      '2. What Bault does',
      'Bault receives collectibles sent to its addresses, inspects and photographs them, stores them in its vault, and keeps the record of who owns each one. From your account you can sell items on the marketplace, swap or give them to another collector, consign them, ask Bault to buy them, order services on them, and have them shipped.',
      'You keep ownership of what you send. Bault holds it on your behalf and is not the owner of anything in your vault. The custody record of each item — who owned it, where it sat, what state it was in, and when each changed — cannot be edited by anyone, Bault staff included; a correction is made by adding a new record.',
      COUNSEL('the legal nature of the custody (bailment or otherwise), Bault’s duty of care, and how items in the vault are insured, if at all'),
    ),
    section(
      'account',
      '3. Your account',
      'One account belongs to one person. Keep your password to yourself; you are responsible for what is done through your account.',
      'Your username is chosen at sign-up and can never be changed. Your first and last name can be edited in your profile.',
      'An account is pending until its email address is confirmed, active, suspended or closed, as described in section 3 of the Account Use & Balance Policy.',
    ),
    section(
      'fees',
      '4. Fees and prices',
      'Bault charges fees for receiving parcels, booking items in, storing them after an included period, services, shipping, marketplace sales, consignment, escrow, cash-outs and memberships. Every fee is charged to your Bault wallet.',
      'Prices that are pricing rules are published on the price list (FAQ & Legal > Prices). Fixed fees — the cash-out fee schedule, the chargeback handling fee, the shipping restocking fee, the escrow fee — are shown under "Current figures" above these documents. The rule in force at the moment of a charge is recorded with that charge, so a later price change never alters what you were already billed.',
      'A fee already charged is not refunded because you changed your mind about the service it paid for. Where a service was not delivered, tell us through Support and it will be corrected with a compensating credit.',
      COUNSEL('whether prices include or exclude sales tax or VAT, and the tax treatment of each fee — to be decided with the accountant before launch'),
    ),
    section(
      'wallet',
      '5. Your wallet, a negative balance, interest and suspension',
      'Your wallet balance is the sum of the entries on your ledger. Nothing else can change it.',
      'Your balance may go negative: a fee is not refused because you are short. While it is negative, new shipment requests and new service requests are refused.',
      'If the balance stays negative for longer than the grace period, interest is charged every day on the whole debt, including interest already charged, until the debt clears. Each day’s interest is an entry on your ledger. If the balance falls below the suspension threshold, your account is suspended automatically; that suspension lifts by itself once the balance is back above the threshold. The grace period, the daily interest rate and the threshold are shown under "Current figures".',
      'A suspended account can sign in and use Support and its Profile, and nothing else.',
      COUNSEL('whether charging interest on a consumer debt is permitted, and at what rate, in each jurisdiction Bault serves; any required disclosure of an annual rate'),
    ),
    section(
      'money-in-out',
      '6. Adding and withdrawing money',
      'A bank transfer or a PayPal Friends & Family payment is a cash-in request. Submitting it moves nothing; a person checks that the money arrived and completes the request, and only then is your wallet credited. Put your username in the payment reference.',
      'A card or PayPal Goods & Services payment, where it is offered, credits your wallet when the provider confirms it. If you or your bank later reverse such a payment, the amount is taken back off your balance and a handling fee is charged unless the provider charged Bault none. Both are entries on your ledger.',
      'A cash-out is a request reviewed by a person. The fee is quoted before you submit it, is charged as its own ledger entry, and your balance must cover the amount and the fee when the request is completed. Payouts are made through PayPal.',
      'The smallest and largest cash-in and cash-out are shown on the forms.',
    ),
    section(
      'marketplace',
      '7. Selling, buying, swapping and escrow',
      'A marketplace purchase is final once it executes: the buyer is debited, the seller is credited the price less Bault’s commission, and ownership changes, all at once. A purchase is not reversed; if what you bought is not what its record said, open a support ticket.',
      'A swap needs both sides to accept, and then every item in it changes owner at once. A swap charges the flat service fee to each side; a gift charges only the giver.',
      'Escrow is for a private deal: the buyer’s money is held, the item is received and inspected by Bault, and the money is released to the seller only after that. The fee is paid by whoever raised the deal.',
      COUNSEL('Bault’s role and liability as a marketplace operator and as an escrow agent; whether escrow requires a licence in any jurisdiction served'),
    ),
    section(
      'shipping',
      '8. Shipping, insurance and customs',
      'Shipping is priced from the carrier’s rate plus Bault’s handling fee and any insurance, add-on or rush packing you choose. A shipment you cannot pay for is held for payment for a limited period and then cancelled; cancelling a carrier shipment after its service was paid for costs a restocking fee. There is no restocking fee when the carrier refused the label, or for a show pickup or a hand delivery cancelled before the warehouse starts on it: before the show’s booking deadline, or before the delivery’s pickup window opens.',
      'Insurance is capped per parcel, and a parcel insured above a set value must be signed for; both figures are shown when you ship and under "Current figures".',
      'For an international shipment you declare the customs value of the contents. Bault does not change, reduce or omit it. Duty and tax at the destination are paid by the recipient.',
      'Items sent to Bault from outside the United States are imported by you. Customs clearance, duty, tax and carrier or broker charges are yours.',
      COUNSEL('liability for loss or damage in transit and the claims process'),
    ),
    section(
      'intake',
      '9. What Bault accepts',
      'The item types Bault accepts and the categories it refuses are published under FAQ & Legal > What we accept, built from the same list intake enforces. An item Bault cannot store is not placed in your vault; a record is written saying what it was, what was done with it and why, and you are notified. Those records cannot be edited.',
      COUNSEL('liability for refused and disposed items, and for unclaimed parcels'),
    ),
    section(
      'suspension-closure',
      '10. Suspension and closure',
      'An administrator may suspend an account. A suspension by an administrator stays until an administrator lifts it.',
      'There is no self-service closure. Ask through Support. A closed account cannot sign in or act. Closing an account deletes neither its items nor its records.',
      COUNSEL('the grounds on which Bault may suspend or close an account, notice periods, and how a closed or suspended customer retrieves their items and balance'),
    ),
    section(
      'liability',
      '11. Liability, disputes and governing law',
      COUNSEL('limitation of liability, warranties and their exclusion, indemnities, force majeure'),
      COUNSEL('how disputes are resolved, governing law and jurisdiction'),
    ),
    section(
      'changes',
      '12. Changes to these terms',
      'Each published version of these terms has its own version string, shown at the top. The version accepted at sign-up is recorded on the account.',
      COUNSEL('how existing customers are told about a new version, and whether and how they must accept it before continuing to use Bault — the product does not yet ask an existing account to accept a new version'),
    ),
    section(
      'contact',
      '13. Contact',
      'Open a ticket under Support. Bault’s published email, phone and opening hours are under FAQ & Legal > Contact.',
    ),
  ],
};

const PRIVACY_POLICY: LegalDocument = {
  id: 'privacy-policy',
  title: 'Privacy Policy',
  provenance: 'legal.provenance.draft',
  lastUpdated: '2026-10-15',
  downloadPath: null,
  draft: true,
  version: TERMS_VERSION,
  sections: [
    section(
      'who',
      '1. Who is responsible',
      `${COUNSEL('the legal entity responsible for your data, its address, and a privacy contact or data protection officer if one is required')}`,
      'Questions about your data can be raised through a support ticket in the "account" category.',
    ),
    section(
      'what',
      '2. What Bault keeps',
      'Your account: your email address, username, first and last name, a hash of your password (the password itself is never stored), the account status, and the version of these terms you accepted and when.',
      'Addresses: the delivery addresses you save — recipient, street, city, country and postal code.',
      'Signing in: every sign-in attempt, successful or not, with the identifier typed, the outcome, the IP address and the browser’s user-agent string; and for every session, the IP address, user agent and expiry. Passwords are never recorded in any form.',
      'Money: every entry on your ledger; payments made through a provider, by the provider’s reference (never a card number); cash-in and cash-out requests, including the destination account and beneficiary name you give for a cash-out and any document you attach; and the history of each request.',
      'Your items and parcels: the items in your vault, their photographs and condition records, their custody history, the parcels addressed to you including photographs of them, and records of anything refused at intake.',
      'Shipping: shipments, their destinations and recipients, and the customs declarations you make.',
      'Other activity: listings, offers, purchases, swaps, escrow deals, service requests, memberships, support tickets and their messages, notifications and your notification preferences, and an audit record of each change you or staff make (who, what, when).',
      'People you name: for an escrow deal with somebody outside Bault, the name and email address you give for them.',
    ),
    section(
      'why',
      '3. Why',
      'To provide the service: to match parcels to you, keep your items and their records, charge and pay out, ship, and answer you. To keep accounts secure: the sign-in history exists so that a sign-in you did not make can be seen. To keep records Bault is required to keep.',
      COUNSEL('the lawful basis for each use, in each jurisdiction served'),
    ),
    section(
      'who-else',
      '4. Who else receives it',
      'Bault uses these providers to run the service. Each receives only what its part needs:',
      '  PayPal              payments into your wallet where offered, and cash-out\n                      payouts: amounts, references and the payout destination.\n  EasyPost            shipping rates and labels: sender and recipient names,\n                      addresses, phone or email where given, parcel weight and\n                      size, and for international parcels the contents and\n                      declared values. The carrier that delivers the parcel\n                      receives the label.\n  Email provider      the messages Bault sends you — confirmation and password\n                      reset links, and notifications you chose to receive by\n                      email — with your email address.\n  Object storage      photographs of items and parcels, and documents attached\n  (S3-compatible)     to wallet requests.',
      COUNSEL('name the email provider, the object-storage provider and the hosting provider of the database and servers; whether each is a processor under a written agreement; and where each stores data'),
      'Other customers see your username where a transaction needs it — a swap, a shared parcel, an escrow deal. Bault does not sell your data and does not use advertising or analytics services.',
    ),
    section(
      'retention',
      '5. How long it is kept',
      'Several records are permanent by design and cannot be deleted, by anyone, as the system is built: the custody history of items, the ledger, the history of cash-in and cash-out requests, sign-in attempts, support messages, escrow events, records of refused items, parcel events and the audit log. Accounts are closed, not deleted. There is currently no automatic deletion of any personal data.',
      COUNSEL('retention periods for each category, and how they are reconciled with a right to erasure where one applies — the append-only records above cannot be erased without a change to the system'),
    ),
    section(
      'rights',
      '6. Your choices and rights',
      'You can see and change your name, your addresses and your notification preferences in the app. Your username cannot be changed. For anything else — a copy of your data, a correction, closing your account — open a support ticket.',
      COUNSEL('the rights that apply in each jurisdiction served, how to exercise them, response times, and the right to complain to a regulator'),
    ),
    section(
      'security',
      '7. Security',
      'Passwords are stored only as an argon2 hash. The session cookie cannot be read by scripts on the page, and only a hash of it is stored. Confirmation and password-reset links are single-use and expire (24 hours and one hour). Records that matter for a dispute are append-only at the database.',
    ),
    section(
      'transfers',
      '8. International transfers',
      COUNSEL('where data is stored and processed, and the safeguards for any transfer across borders'),
    ),
    section(
      'changes',
      '9. Changes',
      'Each version of this policy has its own version string, shown at the top, and is accepted together with the Terms of Service.',
    ),
  ],
};

const COOKIE_NOTICE: LegalDocument = {
  id: 'cookie-notice',
  title: 'Cookie notice',
  provenance: 'legal.provenance.draft',
  lastUpdated: '2026-10-15',
  downloadPath: null,
  draft: true,
  version: TERMS_VERSION,
  sections: [
    section(
      'cookie',
      '1. The one cookie Bault sets',
      'Bault sets exactly one cookie: the session cookie that keeps you signed in. Without it you cannot sign in, so it cannot be turned off.',
      '  Name        session (unless the operator has configured another name)\n  Purpose     identifies your signed-in session\n  Lifetime    7 days, or until you sign out\n  Access      httpOnly — scripts on the page cannot read it\n  Sent to     Bault only, never to another site (SameSite=Lax);\n              over HTTPS only, in production',
      'Bault stores only a hash of the cookie’s value, with the IP address and browser of the session (see the Privacy Policy). Signing out ends the session on the server as well as in your browser.',
    ),
    section(
      'storage',
      '2. Preferences kept in your browser',
      'A few preferences are kept in your browser’s local storage, not in cookies. They never leave your device on their own and are not sent to Bault with your requests:',
      '  bault.locale                 the language you chose\n  bault.theme                  light or dark appearance\n  bault.tab                    the last section you had open\n  bault.notificationsSeenAt    when you last looked at your notifications',
      'Clearing your browser’s site data removes them; the app then uses its defaults.',
    ),
    section(
      'none-else',
      '3. Nothing else',
      'Bault uses no analytics, advertising or tracking cookies, and loads no scripts or fonts from other sites: its fonts are served by Bault itself.',
      'If a payment takes you to PayPal’s own pages, PayPal’s cookie policy applies there.',
    ),
    section(
      'consent',
      '4. Consent',
      'Because the only cookie is the one needed to sign in, Bault does not show a cookie banner.',
      COUNSEL('confirm that the session cookie and the local-storage preferences above need no consent in each jurisdiction served'),
    ),
  ],
};

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  COOKIE_NOTICE,
  {
    "id": "account-use-policy",
    "title": "Account Use & Balance Policy",
    "provenance": "legal.provenance.bault",
    "lastUpdated": "2026-10-15",
    "downloadPath": null,
    "sections": [
      {
        "id": "one-account-one-person",
        "heading": "1. One account, one person",
        "body": "A Bault account belongs to one person. Sharing an account — handing your\nsign-in credentials to somebody else, or signing in on behalf of another\nperson — is not permitted.\n\nThis is not an arbitrary rule. Bault is a custody platform: every item in the\nvault has exactly one owner at every moment, and every movement of an item or\nof money is recorded against the account that performed it. A shared account\nmakes that record untrue, and the record is the only thing standing between a\ncollector and a disputed item.\n\nYou are responsible for everything done through your account, including\nanything done by somebody you gave access to. If you believe someone else has\nyour credentials, change your password immediately from Profile > Security."
      },
      {
        "id": "username",
        "heading": "2. Your username is permanent",
        "body": "Your username is chosen once, at registration, and can never be changed.\n\nIt is the identifier warehouse staff use to route goods to your vault, and it\nappears on custody records that are append-only by design. Allowing it to be\nreassigned would make historical records ambiguous about who they refer to.\n\nThis is enforced at the database, by a trigger that rejects any update to the\ncolumn — not merely by the absence of a form. Your display name is separate\nand can be edited at any time."
      },
      {
        "id": "account-statuses",
        "heading": "3. Account statuses",
        "body": "An account is in exactly one of four states:\n\n  Pending    Created, but the email address has not been confirmed yet.\n             Sign-in is refused until it is.\n  Active     Normal use.\n  Suspended  You can sign in and use Support and your Profile — nothing\n             else. A suspension is imposed by an administrator, or imposed\n             automatically by the balance policy in section 6.\n  Closed     Terminal. Sign-in and every action are refused.\n\nItems are never deleted in any of these states. A suspended or closed account\nstill owns whatever is in its vault, and the custody record remains intact."
      },
      {
        "id": "funded-balance",
        "heading": "4. A funded balance is required",
        "body": "Fees are charged to your Bault wallet: a per-package fee when a parcel is\nreceived and unpacked, an intake fee per item, storage as described in section 5,\na fee for each service you request, and shipping when you send items out. The\nexact amounts come from Bault's pricing rules, and the rule in force at the\nmoment of a charge is recorded with that charge, so a later price change never\nalters what you were billed.\n\nYour balance is allowed to go negative — a fee is not refused because you are\nshort. But while it is negative, new shipment requests and new service requests\nare refused until the balance is positive again."
      },
      {
        "id": "storage-charges",
        "heading": "5. What storage costs",
        "body": "Storage is not billed by the day. A period of storage is INCLUDED in the intake\nfee you already paid for the item, and only after that period does storage start\ncosting anything.\n\n  Standard items    An included period. After it, a share of that item's own\n                    intake fee for every period it stays.\n  Oversized items   A shorter included period, and a much larger share of the\n                    intake fee per period.\n\nThe charge is a proportion of what the item cost to take in, so storing a common\ncard costs a fraction of what storing a sealed case costs. Whether an item counts\nas oversized is decided from its type when it is received, and does not change\nafterwards even if we later reclassify that type.\n\nThe oversized terms are deliberately steep. Shelf space is the limiting resource\nin a vault, and a large item occupies far more of it than its value suggests. If\nyou are storing something oversized, ship it or sell it before the included\nperiod ends.\n\nEvery item shows its own terms, what storage has cost it so far, and when the\nnext charge falls, in the card's detail panel. Charges appear on your ledger as\nordinary entries, one per period, each recording the terms it was billed under.\n\nThe included periods, the period length and the shares are pricing rules. Their\ncurrent values are on the price list (FAQ & Legal > Prices) and on every item;\nthey are deliberately not copied here, where they could go out of date."
      },
      {
        "id": "debt",
        "heading": "6. Negative balances, interest and suspension",
        "body": "A negative balance escalates in two steps.\n\n  Grace period    A debt costs nothing for a grace period.\n  Interest        After that, interest accrues daily on the outstanding\n                  debt, added as an ordinary entry on your ledger where you\n                  can see it. It compounds until the debt clears.\n  Suspension      If your balance falls below the suspension threshold, your\n                  account is suspended automatically until the debt clears.\n\nA suspended account cannot add funds itself, because cash-in is one of the actions suspension closes. You CAN still sign in and open a support ticket, which is the way to ask us to settle the balance and lift the suspension — it is the only part of Bault that stays open to you. The\nsuspension lifts automatically once the balance is back above the threshold —\nfor example when an administrator credits the account, or when one of your\nlistings sells. Support is reached from the Support section in the app, and stays open to you while you are suspended.\n\nThe grace period, the daily rate and the threshold are configuration. Their\ncurrent values are shown under \"Current figures\" at the top of this page, read\nfrom the same settings the daily sweeps apply."
      },
      {
        "id": "inbound-parcels",
        "heading": "7. Parcels sent to a Bault address",
        "body": "You are given one or more U.S. receiving addresses. Each includes a line\nreading \"Bault C/O <your username>\". That line is not decorative: it is the only\nthing that ties an arriving parcel to your account. A parcel that arrives without\nit, or with a username that does not exist, cannot be attributed to anybody.\n\nWhat happens to an unattributable parcel: it is recorded, held unopened, and\nmarked unclaimed. We do not open it — it is somebody's property and we do not\nknow whose. If you believe a parcel of yours is being held this way, contact us\nwith the carrier and tracking number and we will attribute it.\n\nAn unclaimed parcel is held for 12 months before it may be disposed of. We\ncannot store an unidentifiable parcel indefinitely, and the holding period is\nthere so that a genuine mistake has a long time to be corrected. The period is\nkept by the staff who handle unclaimed parcels; the system records a disposal\nbut does not itself enforce the wait.\n\nRegistering a parcel in advance is optional. It does not change how the parcel is\nhandled; it lets you follow it, and it gives the operator receiving it a tracking\nnumber to match against, which is what allows a parcel to be attributed to you\nbefore anyone opens it.\n\nForwarding addresses. Some addresses store nothing and forward everything they\nreceive to the main warehouse. That is what makes a sales-tax-free receiving\nstate useful, and it costs a forwarding fee and several days. The app tells you\nwhich of your addresses forwards, and roughly how long the onward leg takes.\n\nSales tax. Bault is not the seller of anything you buy elsewhere and neither\ncollects nor remits sales tax on it. The tax rates shown against each address are\nthe destination state's, provided so you can compare; what you are actually\ncharged is decided by the seller and by where the goods ship."
      },
      {
        "id": "inbound-international",
        "heading": "8. Parcels sent from outside the United States",
        "body": "You may have goods shipped to a Bault address from another country, but the\nimport is yours, not ours.\n\nAs the recipient of record you are responsible for clearing U.S. customs, and for\nany duty, tariff, tax, brokerage or carrier charge that arises. Bault is not the\nimporter, cannot act as one, and cannot release a parcel held by customs on your\nbehalf.\n\nAsk the sender to complete the customs paperwork accurately. A parcel held,\nreturned or abandoned by customs is outside our control, and any charge the\ncarrier passes on for storage, return transport or brokerage falls to you.\n\nMark the parcel as internationally shipped when you register it, so the\nobligation is recorded against the parcel rather than only in this document."
      },
      {
        "id": "items-we-cannot-accept",
        "heading": "9. Items we cannot accept",
        "body": "Some things cannot be stored in a vault, for safety, legal or security\nreasons. If one of these arrives addressed to you, it will not be placed in your\nvault:\n\n  - liquids, glass, oils or gases;\n  - flammable items;\n  - drugs, medicine or supplements;\n  - cosmetics or perfume;\n  - anything containing a lithium battery;\n  - GPS trackers, including Apple AirTags and similar devices;\n  - adult material.\n\nGPS trackers are singled out because collectors sometimes add one to a parcel in\ngood faith. The location of the facility holding other people's property is not\npublished, and a live tracker inside it defeats that for everyone stored there.\nAny tracker found in a parcel is deactivated and disposed of.\n\nItems in this list are disposed of and cannot be returned. You are not charged\nan intake or storage fee for them — nothing entered storage.\n\nSeparately, if something arrives whose processing would cost more than the thing\nis worth, we may give it away or recycle it rather than shelve it and bill you\nfor storing it.\n\nIn every one of these cases a record is written and you are notified. It names\nwhat arrived, why it could not be accepted, what happened to it, and who made\nthe decision. You can read your own records under Shipping & Services >\nNot accepted. Those records are permanent and cannot be edited by anyone,\nincluding us."
      },
      {
        "id": "records",
        "heading": "10. What we keep, and what we cannot change",
        "body": "Certain records in Bault are append-only and cannot be edited or deleted by\nanyone, including Bault staff:\n\n  - the custody log for every item (who owned it, where it sat, what state it\n    was in, and when each of those changed);\n  - the ledger that your wallet balance is derived from;\n  - the audit trail of every cash-in and cash-out request.\n\nCorrections are made by adding a new, offsetting record — never by rewriting an\nold one. This means your own history is equally permanent: the custody log of\nan item that has left your vault is kept, and a fee you were charged stays on\nyour ledger even after it is refunded by a compensating credit."
      },
      {
        "id": "all-sales-final",
        "heading": "11. Purchases are final",
        "body": "Everything bought through Bault is bought outright, and a purchase is not reversed once it has executed.\n\nThis is not a hard line for its own sake. A marketplace purchase moves ownership of a physical object in a custody record that is append-only by design, and it does so atomically with the money: the seller is credited and the item changes hands in one transaction that either happens completely or not at all. There is no state in which the money has moved and the card has not, which is what makes the record trustworthy — and it is also why there is no button that quietly puts it back.\n\nWhat exists instead:\n\n  Before you buy    Every listing shows the item's condition grade and its\n                    photographs. Inspections and video reviews are ordered by\n                    an item's owner, so ask the seller if you want one.\n  Escrow            For a private deal with somebody you do not know, escrow\n                    exists precisely so that the card is inspected and reported\n                    on before either side is asked to release. Use it.\n  A dispute         If what arrived is not what the record said, open a support\n                    ticket. Disputes are handled by people, on the evidence,\n                    and a correction is made by adding an offsetting record —\n                    never by rewriting the original one.\n\nA fee that has already been charged is not refunded because you changed your mind about the service it paid for. Where a service was not delivered, say so and it will be corrected."
      },
      {
        "id": "chargebacks",
        "heading": "12. Reversed payments",
        "body": "If you fund your wallet by card or by PayPal Goods & Services and then ask your bank or PayPal to reverse that payment, two things happen on your Bault account.\n\n  The reversal    The amount is taken back off your balance. It has to be: the\n                  balance is derived from a ledger of real movements, and money\n                  that has been recalled is not money Bault holds.\n  A handling fee  $25.00, which is what the payment provider charges Bault to\n                  handle a disputed payment, whichever way the dispute goes.\n\nBoth appear on your ledger as ordinary entries, so you can see exactly what happened and when. If the reversal takes your balance negative, the balance policy in section 6 applies to it like any other debt — including the grace period before interest starts, and the suspension threshold.\n\nRaising a chargeback is not the way to resolve a problem with Bault, and it is slower than the alternative: it takes weeks, it costs you the handling fee, and it does not put your cards anywhere. Open a support ticket instead. If we are wrong we will fix it, and a correcting credit is immediate.\n\nWhere a chargeback is raised on a payment that funded goods already shipped, Bault reserves the right to suspend the account until the balance is settled. Items in the vault are never seized: a suspended account still owns everything in it, and the custody record is unaffected."
      }
    ]
  },
  {
    "id": "ofl-1-1",
    "title": "Font licence: SIL Open Font License, Version 1.1",
    "provenance": "legal.provenance.ofl",
    "lastUpdated": "2007-02-26",
    "downloadPath": "/fonts/OFL.txt",
    "sections": [
      {
        "id": "notice",
        "heading": "Notice",
        "body": "This application bundles these fonts, served from /fonts:\n\n  IBM Plex Sans, IBM Plex Sans Hebrew, IBM Plex Mono\n    Copyright © 2017 IBM Corp. with Reserved Font Name \"Plex\"\n\n  Frank Ruhl Libre\n    Copyright 2015 The Frank Ruhl Libre Project Authors\n    (https://github.com/fontef/frankruhllibre)\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\nThis license is copied below, and is also available with a FAQ at:\nhttps://openfontlicense.org\n\n\n-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------"
      },
      {
        "id": "preamble",
        "heading": "Preamble",
        "body": "The goals of the Open Font License (OFL) are to stimulate worldwide\ndevelopment of collaborative font projects, to support the font creation\nefforts of academic and linguistic communities, and to provide a free and\nopen framework in which fonts may be shared and improved in partnership\nwith others.\n\nThe OFL allows the licensed fonts to be used, studied, modified and\nredistributed freely as long as they are not sold by themselves. The\nfonts, including any derivative works, can be bundled, embedded,\nredistributed and/or sold with any software provided that any reserved\nnames are not used by derivative works. The fonts and derivatives,\nhowever, cannot be released under any other type of license. The\nrequirement for fonts to remain under this license does not apply\nto any document created using the fonts or their derivatives."
      },
      {
        "id": "definitions",
        "heading": "Definitions",
        "body": "\"Font Software\" refers to the set of files released by the Copyright\nHolder(s) under this license and clearly marked as such. This may\ninclude source files, build scripts and documentation.\n\n\"Reserved Font Name\" refers to any names specified as such after the\ncopyright statement(s).\n\n\"Original Version\" refers to the collection of Font Software components as\ndistributed by the Copyright Holder(s).\n\n\"Modified Version\" refers to any derivative made by adding to, deleting,\nor substituting -- in part or in whole -- any of the components of the\nOriginal Version, by changing formats or by porting the Font Software to a\nnew environment.\n\n\"Author\" refers to any designer, engineer, programmer, technical\nwriter or other person who contributed to the Font Software."
      },
      {
        "id": "permission-conditions",
        "heading": "Permission & Conditions",
        "body": "Permission is hereby granted, free of charge, to any person obtaining\na copy of the Font Software, to use, study, copy, merge, embed, modify,\nredistribute, and sell modified and unmodified copies of the Font\nSoftware, subject to the following conditions:\n\n1) Neither the Font Software nor any of its individual components,\nin Original or Modified Versions, may be sold by itself.\n\n2) Original or Modified Versions of the Font Software may be bundled,\nredistributed and/or sold with any software, provided that each copy\ncontains the above copyright notice and this license. These can be\nincluded either as stand-alone text files, human-readable headers or\nin the appropriate machine-readable metadata fields within text or\nbinary files as long as those fields can be easily viewed by the user.\n\n3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder. This restriction only applies to the primary font name as\npresented to the users.\n\n4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\nSoftware shall not be used to promote, endorse or advertise any\nModified Version, except to acknowledge the contribution(s) of the\nCopyright Holder(s) and the Author(s) or with their explicit written\npermission.\n\n5) The Font Software, modified or unmodified, in part or in whole,\nmust be distributed entirely under this license, and must not be\ndistributed under any other license. The requirement for fonts to\nremain under this license does not apply to any document created\nusing the Font Software."
      },
      {
        "id": "termination",
        "heading": "Termination",
        "body": "This license becomes null and void if any of the above conditions are\nnot met."
      },
      {
        "id": "disclaimer",
        "heading": "Disclaimer",
        "body": "THE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\nOF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\nCOPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nINCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\nDAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\nOTHER DEALINGS IN THE FONT SOFTWARE."
      }
    ]
  },
];
