export type FaqAvailability = 'adapted' | 'partial' | 'unavailable';

export interface FaqInlineListItem {
  text: string;
  items?: string[];
}

export type FaqBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: FaqInlineListItem[] };

export interface FaqEntry {
  id: string;
  sourceIndex: number;
  question: string;
  category: string;
  availability: FaqAvailability;
  baultNote: string;
  blocks: FaqBlock[];
}

export interface FaqDocument {
  reviewed: { date: string; entryCount: number };
  categoryOrder: string[];
  entries: FaqEntry[];
}

type Draft = Omit<FaqEntry, 'sourceIndex'>;

const p = (text: string): FaqBlock => ({ kind: 'p', text });
const ul = (...items: string[]): FaqBlock => ({ kind: 'ul', items: items.map((text) => ({ text })) });

const ENTRIES: Draft[] = [
  {
    id: 'what-is-bault',
    question: 'What is Bault?',
    category: 'getting-started',
    availability: 'adapted',
    baultNote:
      'Bault keeps your collectibles in a vault, keeps the record of who owns each one, and lets you sell, swap, grade or ship them from your account.',
    blocks: [
      p('You send items to a Bault receiving address. When they arrive they are checked, photographed and booked into your vault, each with its own serial number and custody record.'),
      p('From then on you decide what happens to each item:'),
      ul(
        '**Keep it** on the shelf, with its photographs and history in your vault.',
        '**Sell it** on the marketplace, swap it with another collector, consign it, or ask Bault to buy it.',
        '**Have work done on it** — photography, a video review, a condition inspection, third-party grading.',
        '**Ship it** to yourself or to anybody else, insured, with a customs declaration where one is needed.',
      ),
      p('A sale or a swap changes who owns the item in the record; the item itself stays on its shelf until somebody ships it. Every fee is charged to your Bault wallet and shows the rule that priced it.'),
    ],
  },
  {
    id: 'how-do-i-open-an-account',
    question: 'How do I open an account?',
    category: 'getting-started',
    availability: 'adapted',
    baultNote:
      'Sign up with your email, a username, your first and last name and a password, accept the terms, then confirm your email from the link Bault sends you.',
    blocks: [
      p('Every field on the sign-up form is required. The password must be at least 8 characters.'),
      p('Before the account is created you are asked to accept the Terms of Service, the Privacy Policy and the Cookie notice. The version you accepted, and when, is recorded on your account.'),
      p('The account starts unconfirmed and cannot sign in until you open the confirmation link. The link is valid for 24 hours and works once; the sign-in screen offers a new one if yours expired.'),
      p('You can sign in with either your email or your username.'),
    ],
  },
  {
    id: 'can-i-change-my-username',
    question: 'Can I change my username?',
    category: 'getting-started',
    availability: 'partial',
    baultNote:
      'No. Your username is permanent. Bault has no way to change it, and the database refuses the change even if somebody tried. Your first and last name can be edited at any time.',
    blocks: [
      p('The username is how a parcel addressed to you is matched to your account, and it appears on custody records that can never be edited. Letting it change would make those records ambiguous about who they mean.'),
      p('Your name is edited from [[Profile|#/profile/details]].'),
    ],
  },
  {
    id: 'how-do-i-reach-a-person',
    question: 'How do I reach a person?',
    category: 'getting-started',
    availability: 'adapted',
    baultNote:
      'Open a ticket under Support. It works even when your account is suspended, and every reply is kept on the ticket.',
    blocks: [
      p('Start a ticket from [[Support|#/support/new]] and pick the category that fits: a parcel, a shipment, an item, billing, your account, a large private sale, or something else. Name the item, parcel, shipment or request by its code.'),
      p('Replies arrive as notifications and stay on the ticket. The conversation cannot be edited or deleted afterwards, by you or by staff.'),
      p('Bault’s published email, phone and hours are under [[Contact|#/faq/contact]]. A channel that has not been configured is shown as not published rather than with a placeholder.'),
    ],
  },

  {
    id: 'where-do-i-send-my-items',
    question: 'Where do I send my items?',
    category: 'intake',
    availability: 'adapted',
    baultNote:
      'To one of your own receiving addresses, shown under Inbound > Addresses. Each one includes a line reading "Bault C/O" followed by your username — that line is what ties the parcel to you.',
    blocks: [
      p('Your addresses are listed under [[Inbound > Addresses|#/inbound/addresses]]. They are Bault’s facilities, with your username in the address. Use the address exactly as shown.'),
      p('Some addresses store nothing: they receive parcels and forward them to the vault. Forwarding costs a fee and adds a few days; the app marks which addresses forward and what the forwarding fee is. The sales-tax rate shown against each address is the destination state’s, for comparison only — Bault does not collect or pay sales tax on what you buy elsewhere.'),
    ],
  },
  {
    id: 'should-i-register-a-parcel',
    question: 'Do I need to tell Bault a parcel is coming?',
    category: 'intake',
    availability: 'adapted',
    baultNote:
      'No, but it helps. Registering the carrier and tracking number lets the parcel be matched to you on arrival, and lets you follow it.',
    blocks: [
      p('Register it under [[Inbound > Parcels|#/inbound/parcels]]. It does not change how the parcel is handled once it is opened.'),
      p('If the parcel is coming from outside the United States, mark it as international when you register it. You are the importer: customs clearance, duty, tax and any broker or carrier charges are yours, and Bault cannot release a parcel held by customs.'),
    ],
  },
  {
    id: 'what-happens-when-my-parcel-arrives',
    question: 'What happens when my parcel arrives?',
    category: 'intake',
    availability: 'adapted',
    baultNote:
      'It is opened, its condition is recorded before anything is booked in, and each item is photographed and booked into your vault with its own serial. You are notified at each step.',
    blocks: [
      p('The condition finding — sound, packaging damaged, or contents damaged — is written down with a note and a time before any item record exists. If it is not sound you are told straight away, because a claim against a seller or a carrier has a deadline.'),
      p('Two fees apply, both on [[Prices|#/faq/prices]]:'),
      ul(
        '**A processing fee per parcel**, for receiving, opening and cataloguing it.',
        '**An intake fee per item**, which depends on what the item is — a single card and a sealed case are not the same work.',
      ),
      p('Both are charged to your wallet. A membership may include a number of each per month.'),
    ],
  },
  {
    id: 'what-will-bault-accept',
    question: 'What will Bault accept, and what happens to what it refuses?',
    category: 'intake',
    availability: 'adapted',
    baultNote:
      'The accepted item types and the refused categories are on the "What we accept" tab, which is built from the same list intake enforces.',
    blocks: [
      p('See [[What we accept|#/faq/policy]]. Intake will not book in a type that is not on that list, on any path.'),
      p('Some things cannot be stored at all — among them liquids, flammable items, anything containing a lithium battery, and GPS trackers or AirTags. If one arrives addressed to you it is not placed in your vault. A record is written naming what it was, what happened to it and why, and you are notified. You can read those records under [[Shipping & Services > Not accepted|#/shipping-services/not-accepted]]; they cannot be edited by anyone.'),
    ],
  },
  {
    id: 'what-is-a-lot',
    question: 'Can I send a bundle of cards as one lot?',
    category: 'intake',
    availability: 'partial',
    baultNote:
      'Yes, above a minimum size. A lot is booked and billed as one item until it is broken up; a small bundle of cards is booked as individual items instead.',
    blocks: [
      p('The minimum lot size for cards is shown on [[What we accept|#/faq/policy]]. Below it, each card gets its own serial, label and record, because a card inside an unbroken lot cannot be sold, graded or shipped on its own.'),
      p('A lot has its own intake price on [[Prices|#/faq/prices]]. Breaking a lot into individual items is a service you can ask for from the vault.'),
    ],
  },
  {
    id: 'parcel-without-my-username',
    question: 'What if my parcel arrives without my username on it?',
    category: 'intake',
    availability: 'adapted',
    baultNote:
      'It is recorded as unclaimed and held unopened until somebody works out whose it is. Open a ticket with the carrier and tracking number.',
    blocks: [
      p('Without the "Bault C/O" line, or with a username that does not exist, there is nothing to tie the parcel to an account. It is not opened, because it is somebody’s property and Bault does not know whose. Whatever was written on the label is kept as recorded.'),
      p('Registering the parcel in advance is the easiest way to avoid this: a registered tracking number can be matched before anyone opens anything.'),
    ],
  },

  {
    id: 'what-does-storage-cost',
    question: 'What does storage cost?',
    category: 'storage',
    availability: 'adapted',
    baultNote:
      'A period of storage is included in each item’s intake fee. After it, storage is charged per period as a share of that item’s own intake fee. The current terms are on the price list and on every item.',
    blocks: [
      p('Storage is not billed by the day. The included period, the length of each period after it, and the share of the intake fee charged per period are pricing rules, shown on [[Prices|#/faq/prices]].'),
      p('Oversized items are on shorter, steeper terms, because shelf space is what a vault runs out of. Whether an item counts as oversized is decided from its type when it is booked in and does not change afterwards.'),
      p('Open any item in [[your vault|#/vault/active]] to see its own terms, what storage has cost it so far and when the next charge falls. Each charge appears on your ledger and records the terms it was billed under.'),
      p('A membership includes storage for a number of items; see "What does a membership include?".'),
    ],
  },
  {
    id: 'remove-commons',
    question: 'Can I get rid of cards that are not worth storing?',
    category: 'storage',
    availability: 'partial',
    baultNote:
      'Yes, free, within 30 days of an item arriving: tick them in the vault with Remove commons, choose donate or discard, and confirm. It cannot be undone.',
    blocks: [
      p('Remove commons is in [[your vault|#/vault/active]]. After the 30-day window an item can no longer be removed this way; it still appears in the list, greyed, with the reason on it.'),
    ],
  },
  {
    id: 'are-my-items-ever-deleted',
    question: 'Can an item disappear from my account?',
    category: 'storage',
    availability: 'adapted',
    baultNote:
      'No item is ever deleted. Its custody log — who owned it, where it sat, what state it was in, and when each changed — is permanent and cannot be edited, by staff either.',
    blocks: [
      p('A mistake is corrected by adding a new record that offsets the old one, never by rewriting it. A suspended or closed account still owns everything in its vault.'),
    ],
  },

  {
    id: 'how-does-the-wallet-work',
    question: 'How does my Bault wallet work?',
    category: 'fees',
    availability: 'adapted',
    baultNote:
      'Every fee is charged to your wallet. Its balance is the sum of your ledger entries and nothing else can change it.',
    blocks: [
      p('Every movement of money is a ledger entry: money in, money out, every fee, every sale. Entries are never edited; a refund or correction is a new entry. You can read yours under [[Wallet > Transactions|#/wallet/transactions]].'),
      p('Each charge records the pricing rule that was in force when it was made, so a later price change never alters what you were already billed.'),
    ],
  },
  {
    id: 'how-do-i-add-money',
    question: 'How do I add money?',
    category: 'fees',
    availability: 'partial',
    baultNote:
      'The Wallet shows which ways of paying are available right now. A bank transfer or a PayPal Friends & Family payment is a cash-in request that a person checks before your balance moves.',
    blocks: [
      p('Open [[Wallet > Cash in|#/wallet/cash-in]]. The account details for a bank transfer and the PayPal handle for Friends & Family are shown there when Bault has published them; a route with nothing published is shown as unavailable rather than with a placeholder.'),
      p('Put your username in the payment reference. It is the only thing that ties an arriving payment to your account.'),
      p('Submitting a cash-in request moves nothing. A person checks that the money arrived, approves the request and completes it, and only then is your wallet credited. The smallest and largest cash-in are shown on the form.'),
      p('Card and PayPal Goods & Services payments, which the provider confirms itself, credit the wallet without review where they are offered. **Not every deployment offers them yet**; the Wallet says which routes you can use.'),
    ],
  },
  {
    id: 'how-do-i-cash-out',
    question: 'How do I take money out, and what does it cost?',
    category: 'fees',
    availability: 'adapted',
    baultNote:
      'Ask for a cash-out under Wallet. A person reviews and completes it. The fee is 6% (at least $0.99) up to $100, and $5 plus 1% above that; the form quotes it before you ask.',
    blocks: [
      p('Open [[Wallet > Cash out|#/wallet/cash-out]]. The quote shows the fee and what lands in your account before you submit, using the same calculation that charges it.'),
      p('The fee is its own entry on your ledger, next to the amount paid out, so both numbers are visible. A membership may waive it.'),
      p('Your balance has to cover the amount and the fee when the request is completed, not only when it is submitted.'),
    ],
  },
  {
    id: 'negative-balance',
    question: 'What happens if my balance goes negative?',
    category: 'fees',
    availability: 'adapted',
    baultNote:
      'A fee is never refused because you are short, but while you are negative new shipments and service requests are blocked. After a grace period interest accrues daily, and below a threshold the account is suspended. The current figures are shown under Legal Terms.',
    blocks: [
      p('The grace period, the daily interest rate and the suspension threshold are configuration, shown under [[FAQ & Legal > Legal Terms|#/faq/legal]] as the current figures.'),
      ul(
        '**Grace period.** A debt costs nothing at first.',
        '**Interest.** After the grace period, interest is added every day as an entry on your ledger. It is charged on the whole debt, including interest already added, until the debt clears.',
        '**Suspension.** Below the threshold, the account is suspended automatically.',
      ),
      p('A suspended account can still sign in and use Support and Profile — nothing else. A suspension caused by the balance lifts by itself once the balance is back above the threshold, for example when Bault credits the account or one of your listings sells.'),
    ],
  },
  {
    id: 'reversed-payment',
    question: 'What happens if a card or PayPal payment into my wallet is reversed?',
    category: 'fees',
    availability: 'adapted',
    baultNote:
      'The amount comes back off your balance, and a $25 handling fee is charged unless the provider charged Bault nothing. Both appear on your ledger.',
    blocks: [
      p('The balance is a record of money Bault actually holds, so money the payer took back has to come off it. If that takes the balance negative, the negative-balance rules apply to it like any other debt.'),
      p('If something is wrong with a charge, open a support ticket instead: a correcting credit is immediate, and a chargeback takes weeks and costs the handling fee.'),
    ],
  },

  {
    id: 'how-do-i-ship-items-home',
    question: 'How do I ship items to myself?',
    category: 'shipping',
    availability: 'adapted',
    baultNote:
      'Pick the items and one of your saved addresses under Shipping & Services; the services that can carry the parcel are priced live, and nothing is charged until you choose one.',
    blocks: [
      p('Start under [[Shipping & Services > Shipping|#/shipping-services/shipping]]. Delivery addresses are saved under [[Profile > Addresses|#/profile/addresses]].'),
      p('Services that cannot carry your parcel are still shown, with the rule they failed, so you can see why the cheapest option is not available. Choose a service yourself, or let Bault choose the best balance of price and time.'),
      p('The charge is the carrier’s rate plus Bault’s handling fee, plus insurance, add-ons and rush packing if you chose them. Handling and rush are on [[Prices|#/faq/prices]]. Rush means Bault picks and packs the same day; it does not make the carrier faster.'),
      p('If your wallet cannot cover a service when you choose it, the shipment waits for payment for 7 days. After that it is cancelled and the items go back on the shelf.'),
    ],
  },
  {
    id: 'change-or-cancel-a-shipment',
    question: 'Can I change or cancel a shipment?',
    category: 'shipping',
    availability: 'partial',
    baultNote:
      'Until a service has been paid for you can add or remove items, merge it with another request to the same address, or cancel it for nothing. After that, cancelling costs a $25 restocking fee.',
    blocks: [
      p('Requests are listed under [[Shipping & Services > Tracking|#/shipping-services/tracking]]. The restocking fee covers the checking and packing that were already done once a service was paid for.'),
    ],
  },
  {
    id: 'insurance-and-signatures',
    question: 'How does shipping insurance work?',
    category: 'shipping',
    availability: 'adapted',
    baultNote:
      'A parcel can be insured for up to $5,000. The premium is 1.5% of the insured value, at least $2. Anything insured above $500 must be signed for.',
    blocks: [
      p('The signature is a condition of the cover: a parcel worth more than that, left on a doorstep, is not insured, so the two are not offered separately.'),
      p('A GPS tracker can travel inside the parcel. It is only sold with insurance of at least $500, and its price is on [[Prices|#/faq/prices]].'),
    ],
  },
  {
    id: 'international-shipping-and-customs',
    question: 'What goes on the customs form?',
    category: 'shipping',
    availability: 'adapted',
    baultNote:
      'The value you declare. Bault does not change, reduce or leave out a declared value, and duty and tax at the destination are paid by whoever receives the parcel.',
    blocks: [
      p('An international shipment needs a customs value for its contents. A commercial invoice is generated from the shipment, one line per item, with a tariff code and the country of origin.'),
      p('Under-declaring a value to reduce duty would be done in your name. Bault will not do it.'),
    ],
  },
  {
    id: 'ship-together',
    question: 'Can I share one parcel with other collectors?',
    category: 'shipping',
    availability: 'adapted',
    baultNote:
      'Yes. Everyone creates their own request to exactly the same address; one person opens a shared parcel, becomes the payer and gets a code the others join with.',
    blocks: [
      p('See [[Shipping & Services > Shared parcels|#/shipping-services/shared]]. Nobody can be added without joining with the code, and each person still owns exactly their own items the whole way.'),
    ],
  },
  {
    id: 'other-ways-to-collect',
    question: 'Are there other ways to get my items?',
    category: 'shipping',
    availability: 'partial',
    baultNote:
      'Yes: collection at a card show Bault is attending, and hand delivery by a person. Both are under Shipping & Services > In person.',
    blocks: [
      ul(
        '**Show pickup.** Collect your items at a show Bault is attending. The fee is shown with each show; the show calendar is under [[Show calendar|#/faq/shows]].',
        '**Hand delivery.** A person carries the items to you. Bault quotes each journey; the starting price is shown before you ask, and travel is quoted on top. Nothing is charged until you accept the quote.',
      ),
      p('A parcel waiting at a forwarding-only address can also be shipped straight to you before it is opened, if it is small enough. It never enters the vault, so no intake or storage is charged on it. The app offers this on the parcel when it applies, with its price.'),
    ],
  },

  {
    id: 'what-services-are-there',
    question: 'What can Bault do with an item in my vault?',
    category: 'services',
    availability: 'partial',
    baultNote:
      'Professional photography, a video review, a condition inspection, third-party grading, cracking a slab, splitting a lot, consignment, a buyout offer, donation, and custom requests. Prices are on the price list.',
    blocks: [
      p('Every service is ordered from the item in [[your vault|#/vault/active]] and priced on [[Prices|#/faq/prices]]. A service without its own price is charged the flat service fee.'),
      p('Only the owner of an item can order work on it. A buyer cannot order an inspection of somebody else’s listing.'),
      p('New service requests are refused while your balance is negative.'),
    ],
  },
  {
    id: 'grading',
    question: 'How does grading work?',
    category: 'services',
    availability: 'adapted',
    baultNote:
      'Choose a tier and state what the item is worth. Items go to the grader in batches; while away the item shows as "At the grader" and cannot be sold, swapped or shipped.',
    blocks: [
      p('A tier is a turnaround and a ceiling on declared value. The value you state decides which tiers you can use, and the top tier is refused for an item below its threshold. Each tier’s price is on [[Prices|#/faq/prices]].'),
      p('When the grade comes back it is written onto the item with its certificate number, and the item goes back on the shelf.'),
    ],
  },
  {
    id: 'consignment-and-buyout',
    question: 'Can Bault sell an item for me, or buy it?',
    category: 'services',
    availability: 'adapted',
    baultNote:
      'Yes. Consignment sells it through a card show, an auction house or an eBay partner, for a commission; a buyout is Bault quoting a price to buy it outright, which you accept or decline.',
    blocks: [
      p('Each consignment channel has its own commission, payout window and eligibility rules, shown when you choose it. Bault’s commission per channel is on [[Prices|#/faq/prices]].'),
      p('A buyout pays less than the market, because Bault then carries the risk of selling the item.'),
    ],
  },

  {
    id: 'how-does-selling-work',
    question: 'How does selling on the marketplace work?',
    category: 'marketplace',
    availability: 'adapted',
    baultNote:
      'List an item with a price. Buyers can buy it outright or make an offer you accept, reject or counter. On a sale Bault takes a commission from the seller.',
    blocks: [
      p('Listings and offers are under [[Marketplace|#/marketplace/browse]]. A listing shows the item’s condition grade and photographs.'),
      p('A sale moves the money and the ownership in one step: the buyer is debited, you are credited the price less the commission, and the item is yours or theirs — never half of each. The commission rate is on [[Prices|#/faq/prices]]; a membership may waive it on part of your sales.'),
    ],
  },
  {
    id: 'are-purchases-final',
    question: 'Can a purchase be undone?',
    category: 'marketplace',
    availability: 'partial',
    baultNote:
      'No. A purchase is final once it executes. If what you bought is not what its record said, open a support ticket; a correction is made with a new, offsetting record.',
    blocks: [
      p('For a private deal with somebody you do not know, use escrow: the item is inspected before either side is asked to release anything.'),
    ],
  },
  {
    id: 'swaps-and-gifts',
    question: 'Can I swap items with another collector, or give one away?',
    category: 'marketplace',
    availability: 'adapted',
    baultNote:
      'Yes, with their username and the serial number of the item you want. Both sides must accept; then every item in the swap changes owner at once.',
    blocks: [
      p('Propose a swap under [[Marketplace > Trade|#/marketplace/trade]]. There is no browsing of another collector’s vault: you can only ask about an item whose serial you already know.'),
      p('A swap charges the flat service fee to each side; a gift charges only the giver. A gift asks you to confirm twice, because it cannot be undone.'),
    ],
  },
  {
    id: 'escrow',
    question: 'How does escrow work?',
    category: 'marketplace',
    availability: 'adapted',
    baultNote:
      'For a private deal of at least $500: the buyer’s money is held, the item is sent to Bault and inspected, and only then is the money released to the seller. The fee is 1% of the agreed value, at least $25, paid by whoever raised the deal.',
    blocks: [
      p('Raise a deal under [[Marketplace > Escrow|#/marketplace/escrow]]. The other side can be a Bault account or somebody outside Bault, named by their name and email.'),
      p('When the deal settles the item goes into the buyer’s vault, or is shipped to a buyer who has none. If the deal is called off, held money goes back to the buyer’s wallet. A membership may waive the fee.'),
    ],
  },

  {
    id: 'memberships',
    question: 'What does a membership include?',
    category: 'account',
    availability: 'adapted',
    baultNote:
      'A monthly fee covers a fixed allowance of services — intakes, parcel processing, storage for a number of items, insured shipments and more, depending on the tier. Allowances do not roll over, and there is no overage rate.',
    blocks: [
      p('The tiers, what each includes and the monthly price are under [[Membership|#/membership]].'),
      p('When an allowance runs out, the service is charged at its ordinary price, and only when you ask for it. A membership renews each month at the price in force at renewal. A move to a cheaper tier takes effect at the end of the current month.'),
    ],
  },
  {
    id: 'what-records-are-kept',
    question: 'What does Bault keep about me?',
    category: 'account',
    availability: 'adapted',
    baultNote:
      'Your account details, addresses, items, money movements, support conversations and sign-in history. Several of these records are permanent by design. The Privacy Policy lists all of it and who else receives it.',
    blocks: [
      p('The custody log of every item, the ledger your balance comes from, the history of every cash-in and cash-out request, support conversations and every sign-in attempt are append-only: nobody can edit or delete them, including Bault staff.'),
      p('Read the Privacy Policy and the Cookie notice under [[FAQ & Legal > Legal Terms|#/faq/legal]].'),
    ],
  },
  {
    id: 'close-my-account',
    question: 'How do I close my account?',
    category: 'account',
    availability: 'partial',
    baultNote:
      'There is no self-service closure yet. Ask through a support ticket. A closed account cannot sign in, and its records are kept.',
    blocks: [
      p('Before asking, ship or sell what is in your vault and cash out your balance: a closed account can no longer do either itself. Closing an account does not delete its items or its records.'),
    ],
  },
  {
    id: 'which-terms-apply',
    question: 'Which terms apply to me?',
    category: 'account',
    availability: 'partial',
    baultNote:
      'The Terms of Service, the Privacy Policy and the Cookie notice you accepted at sign-up, and the Account Use & Balance Policy. The first three are drafts that have not yet been reviewed by a lawyer.',
    blocks: [
      p('All four are under [[FAQ & Legal > Legal Terms|#/faq/legal]], each with its version. The version you accepted is recorded on your account.'),
    ],
  },
];

export const FAQ: FaqDocument = {
  reviewed: { date: '2026-10-15', entryCount: ENTRIES.length },
  categoryOrder: ['getting-started', 'intake', 'storage', 'fees', 'shipping', 'services', 'marketplace', 'account'],
  entries: ENTRIES.map((entry, sourceIndex) => ({ ...entry, sourceIndex })),
};
