/**
 * Legal documents shown in FAQ & Legal > Legal Terms.
 *
 * This module carries only legal text that genuinely governs Bault. Nothing in
 * it is drafted, paraphrased or filled in to make the page look complete:
 * writing a plausible-sounding Terms of Service would create a document that
 * reads as binding while having been authored by nobody.
 *
 * Bault has not yet published its own Terms of Service, Privacy Policy or
 * Cookie Policy. The Legal tab says so in one sentence and points to support;
 * it no longer lists them as rows of "Not published", which read as a set of
 * documents that were somehow missing rather than as one fact.
 *
 *   1. ACCOUNT USE & BALANCE POLICY — authored by Bault, and the one customer
 *      document in `LEGAL_DOCUMENTS`. Every clause in it states a rule the code
 *      actually enforces, and the enforcement points are named in the text so a
 *      reader can check the claim: username immutability is a database trigger,
 *      the debt thresholds are the values the daily sweep reads from
 *      configuration, and the account statuses are the ones the session guard
 *      acts on. Nothing in it is aspirational. A clause may only be added here
 *      once the behaviour it describes exists.
 *
 *   2. SIL OPEN FONT LICENSE 1.1, which governs the bundled Libertinus Math
 *      font and whose reproduction is a condition of using it. Copied verbatim
 *      from the licence file distributed with the font (also served at
 *      /fonts/OFL.txt). It is an open-source notice, not an agreement with the
 *      customer, so it lives in `OPEN_SOURCE_NOTICES` and the page shows it
 *      under that heading instead of as a legal document beside the policy.
 *
 * Body text is English in both, and is not translated. Rendering a legal text in
 * a language its author did not write it in creates a second version that can
 * disagree with the first; the surrounding page chrome is localised, the
 * governing words are not.
 */

export interface LegalSection {
  /** Stable anchor id, used by the table of contents and deep links. */
  id: string;
  heading: string;
  /** Verbatim body text. Rendered pre-wrapped — line breaks are meaningful. */
  body: string;
}

export interface LegalDocument {
  id: string;
  title: string;
  /** Where the text comes from, shown under the title. */
  provenance: string;
  /** ISO date this document was last revised by its author. */
  lastUpdated: string;
  /** A plain-text file the viewer can offer for download, or null. */
  downloadPath: string | null;
  sections: LegalSection[];
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    "id": "account-use-policy",
    "title": "Account Use & Balance Policy",
    "provenance": "legal.provenance.bault",
    "lastUpdated": "2026-08-18",
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
        "body": "An account is in exactly one of four states:\n\n  Pending    Created, but the email address has not been confirmed yet.\n             Sign-in is refused until it is.\n  Active     Normal use.\n  Suspended  You can sign in and use Support — nothing else. A suspension is\n             imposed by an administrator, or imposed automatically by the\n             balance policy in section 6.\n  Closed     Terminal. Sign-in and every action are refused.\n\nItems are never deleted in any of these states. A suspended or closed account\nstill owns whatever is in its vault, and the custody record remains intact."
      },
      {
        "id": "funded-balance",
        "heading": "4. A funded balance is required",
        "body": "Fees are charged to your Bault wallet: a per-package fee when a parcel is\nreceived and unpacked, an intake fee per item, storage as described in section 5,\na fee for each service you request, and shipping when you send items out. The\nexact amounts come from Bault's pricing rules, and the rule in force at the\nmoment of a charge is recorded with that charge, so a later price change never\nalters what you were billed.\n\nYour balance is allowed to go negative — a fee is not refused because you are\nshort. But while it is negative, new shipment requests and new service requests\nare refused until the balance is positive again."
      },
      {
        "id": "storage-charges",
        "heading": "5. What storage costs",
        "body": "Storage is not billed by the day. A period of storage is INCLUDED in the intake\nfee you already paid for the item, and only after that period does storage start\ncosting anything.\n\n  Standard items    180 days included. After that, 10% of that item's own\n                    intake fee every 90 days.\n  Oversized items    90 days included. After that, the full intake fee again\n                    every 90 days.\n\nThe charge is a proportion of what the item cost to take in, so storing a common\ncard costs a fraction of what storing a sealed case costs. Whether an item counts\nas oversized is decided from its type when it is received, and does not change\nafterwards even if we later reclassify that type.\n\nThe oversized terms are deliberately steep. Shelf space is the limiting resource\nin a vault, and a large item occupies far more of it than its value suggests. If\nyou are storing something oversized, ship it or sell it before the included\nperiod ends.\n\nEvery item shows its own terms, what storage has cost it so far, and when the\nnext charge falls, in the card's detail panel. Charges appear on your ledger as\nordinary entries, one per period, each recording the terms it was billed under.\n\nThe figures above are the platform's current configuration. Where they change,\nthis section changes with them."
      },
      {
        "id": "debt",
        "heading": "6. Negative balances, interest and suspension",
        "body": "A negative balance escalates in two steps.\n\n  Grace period    A debt costs nothing for the first 14 days.\n  Interest        After that, interest accrues daily at 0.05% of the\n                  outstanding debt, added as an ordinary entry on your ledger\n                  where you can see it. It compounds until the debt clears.\n  Suspension      If your balance falls below -$20.00, your account is\n                  suspended automatically until the debt clears.\n\nA suspended account cannot add funds itself, because cash-in is one of the actions suspension closes. You CAN still sign in and open a support ticket, which is the way to ask us to settle the balance and lift the suspension — it is the only part of Bault that stays open to you. The\nsuspension lifts automatically once the balance is back above the threshold —\nfor example when an administrator credits the account, or when one of your\nlistings sells. Support is reached from the Support section in the app, and stays open to you while you are suspended.\n\nThe three figures above are the platform's current configuration. Where they\nchange, this section changes with them."
      },
      {
        "id": "inbound-parcels",
        "heading": "7. Parcels sent to a Bault address",
        "body": "You are given one or more U.S. receiving addresses. Each includes a line\nreading \"Bault C/O <your username>\". That line is not decorative: it is the only\nthing that ties an arriving parcel to your account. A parcel that arrives without\nit, or with a username that does not exist, cannot be attributed to anybody.\n\nWhat happens to an unattributable parcel: it is recorded, held unopened, and\nmarked unclaimed. We do not open it — it is somebody's property and we do not\nknow whose. If you believe a parcel of yours is being held this way, contact us\nwith the carrier and tracking number and we will attribute it.\n\nAn unclaimed parcel is held for 12 months. After that it may be disposed of. We\ncannot store an unidentifiable parcel indefinitely, and the holding period is\nthere so that a genuine mistake has a long time to be corrected.\n\nRegistering a parcel in advance is optional. It does not change how the parcel is\nhandled; it lets you follow it, and it gives the operator receiving it a tracking\nnumber to match against, which is what allows a parcel to be attributed to you\nbefore anyone opens it.\n\nForwarding addresses. Some addresses store nothing and forward everything they\nreceive to the main warehouse. That is what makes a sales-tax-free receiving\nstate useful, and it costs a forwarding fee and several days. The app tells you\nwhich of your addresses forwards, and roughly how long the onward leg takes.\n\nSales tax. Bault is not the seller of anything you buy elsewhere and neither\ncollects nor remits sales tax on it. The tax rates shown against each address are\nthe destination state's, provided so you can compare; what you are actually\ncharged is decided by the seller and by where the goods ship."
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
        "body": "Certain records in Bault are append-only and cannot be edited or deleted by\nanyone, including Bault staff:\n\n  - the custody log for every item (who owned it, where it sat, what state it\n    was in, and when each of those changed);\n  - the ledger that your wallet balance is derived from;\n  - the audit trail of every cash-in and cash-out request.\n\nCorrections are made by adding a new, offsetting record — never by rewriting an\nold one. This means your own history is equally permanent: an item that has\nleft your vault stays visible in your history, and a fee you were charged stays\non your ledger even after it is refunded by a compensating credit."
      },
      {
        "id": "all-sales-final",
        "heading": "11. Purchases are final",
        "body": "Everything bought through Bault is bought outright, and a purchase is not reversed once it has executed.\n\nThis is not a hard line for its own sake. A marketplace purchase moves ownership of a physical object in a custody record that is append-only by design, and it does so atomically with the money: the seller is credited and the item changes hands in one transaction that either happens completely or not at all. There is no state in which the money has moved and the card has not, which is what makes the record trustworthy — and it is also why there is no button that quietly puts it back.\n\nWhat exists instead:\n\n  Before you buy    Every listing shows the item's own record: its condition\n                    grade, its photographs, its full history in the vault. You\n                    can also pay for a condition inspection or a video review\n                    of a card before committing to it.\n  Escrow            For a private deal with somebody you do not know, escrow\n                    exists precisely so that the card is inspected and reported\n                    on before either side is asked to release. Use it.\n  A dispute         If what arrived is not what the record said, open a support\n                    ticket. Disputes are handled by people, on the evidence,\n                    and a correction is made by adding an offsetting record —\n                    never by rewriting the original one.\n\nA fee that has already been charged is not refunded because you changed your mind about the service it paid for. Where a service was not delivered, say so and it will be corrected."
      },
      {
        "id": "chargebacks",
        "heading": "12. Reversed payments",
        "body": "If you fund your wallet by card or by PayPal Goods & Services and then ask your bank or PayPal to reverse that payment, two things happen on your Bault account.\n\n  The reversal    The amount is taken back off your balance. It has to be: the\n                  balance is derived from a ledger of real movements, and money\n                  that has been recalled is not money Bault holds.\n  A handling fee  $25.00, which is what the payment provider charges Bault to\n                  handle a disputed payment, whichever way the dispute goes.\n\nBoth appear on your ledger as ordinary entries, so you can see exactly what happened and when. If the reversal takes your balance negative, the balance policy in section 6 applies to it like any other debt — including the grace period before interest starts, and the suspension threshold.\n\nRaising a chargeback is not the way to resolve a problem with Bault, and it is slower than the alternative: it takes weeks, it costs you the handling fee, and it does not put your cards anywhere. Open a support ticket instead. If we are wrong we will fix it, and a correcting credit is immediate.\n\nWhere a chargeback is raised on a payment that funded goods already shipped, Bault reserves the right to suspend the account until the balance is settled. Items in the vault are never seized: a suspended account still owns everything in it, and the custody record is unaffected."
      }
    ]
  },
];

/** Licences for software bundled with Bault — shown as notices, not as terms. */
export const OPEN_SOURCE_NOTICES: readonly LegalDocument[] = [
  {
    "id": "ofl-1-1",
    "title": "SIL Open Font License, Version 1.1",
    "provenance": "legal.provenance.ofl",
    "lastUpdated": "2007-02-26",
    "downloadPath": "/fonts/OFL.txt",
    "sections": [
      {
        "id": "notice",
        "heading": "Notice",
        "body": "Copyright © 2012-2024 The Libertinus Project Authors,\nwith Reserved Font Name \"Linux Libertine\", \"Biolinum\", \"STIX Fonts\".\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\nThis license is copied below, and is also available with a FAQ at:\nhttp://scripts.sil.org/OFL\n\n\n-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------"
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
