/**
 * Workflow guides — how each thing in Bault is actually done.
 *
 * The audit scored "video tutorials for each workflow" and "buying guides" as
 * missing, and this module is the answer to both, with one thing stated plainly
 * because it is the honest part:
 *
 *   **There are no videos.** Nothing here links to one, and no entry pretends
 *   otherwise. Every guide carries a `video` field that is `null`, and the page
 *   says so where a player would be. A fabricated YouTube URL that 404s is worse
 *   than an empty state that tells the truth.
 *
 * What IS here is the written half: ordered steps, each naming the screen it
 * happens on, with a real hash route the reader can follow. That is the part a
 * video would be a recording OF, and it is the part that can be kept correct —
 * a guide that names `#/shipping-services/shipping` is checkable against the router in a
 * way a two-minute screen capture never is.
 *
 * The rule this module holds itself to is the FAQ's rule, and for the same
 * reason. Every sentence is a factual statement about what Bault does. Nothing
 * is market advice, nothing is a claim about what cards are worth, and nothing
 * describes a capability that does not exist. When a workflow has a constraint
 * that surprises people, the guide says the constraint rather than routing
 * around it.
 */

export type GuideCategory = 'getting_started' | 'inbound' | 'vault' | 'selling' | 'outbound' | 'money';

export interface GuideStep {
  /** One action, in the imperative. */
  text: string;
  /** The hash route this step happens on, when it happens on one. */
  route?: string;
  /**
   * A constraint worth knowing BEFORE the step rather than after it. Present
   * only where there genuinely is one.
   */
  note?: string;
}

export interface Guide {
  /** Stable slug used by deep links (`#/faq/guides?g=<id>`). */
  id: string;
  title: string;
  category: GuideCategory;
  /** One sentence: what this gets you. */
  summary: string;
  /** How long the READING takes. Not how long the workflow takes. */
  minutes: number;
  steps: GuideStep[];
  /**
   * A recorded walkthrough, if one exists. It is `null` on every guide, and the
   * page renders that as "no recording yet" rather than hiding the field —
   * because the absence is a fact about Bault, not a gap in the data model.
   */
  video: string | null;
  /** Guides that answer the obvious next question. */
  related?: string[];
}

export const GUIDES: readonly Guide[] = [
  {
    id: 'first-week',
    title: 'Your first week',
    category: 'getting_started',
    summary: 'From a new account to a card on the shelf that you can sell, grade or ship.',
    minutes: 4,
    video: null,
    related: ['send-us-a-parcel', 'what-it-costs'],
    steps: [
      {
        text: 'Confirm your email address from the link we send you. Until you do, the account exists but cannot sign in.',
        note: 'The link is valid for 24 hours and can be used once. You can ask for another from the sign-in screen.',
      },
      {
        text: 'Add a delivery address. This is where cards go when you ship them home — it is not where you send them to us.',
        route: '#/profile/addresses',
      },
      {
        text: 'Find your inbound addresses. Every collector gets their own, addressed C/O your username.',
        route: '#/inbound/addresses',
        note: 'Your username is permanent and cannot be changed. It is how a parcel is matched to you, so a package addressed to anything else may arrive unattributable.',
      },
      {
        text: 'Tell us a parcel is coming before it arrives. It is not required, but an expected parcel is matched on arrival instead of being opened blind.',
        route: '#/inbound/parcels',
      },
      {
        text: 'When it arrives we open it, check it, photograph it and book each item into your vault. You are notified at each step.',
        route: '#/vault/active',
      },
    ],
  },
  {
    id: 'send-us-a-parcel',
    title: 'Sending a parcel to the vault',
    category: 'inbound',
    summary: 'Which of the two addresses to use, and what happens after it lands.',
    minutes: 3,
    video: null,
    related: ['first-week', 'what-it-costs'],
    steps: [
      {
        text: 'Open your inbound addresses. There are two, and they are not interchangeable.',
        route: '#/inbound/addresses',
      },
      {
        text: 'The New Jersey address is the vault. Anything sent there stays there.',
      },
      {
        text: 'The Delaware address is a receiving point that stores nothing. Delaware levies no sales tax, so a purchase delivered there is not taxed by the destination state — and everything that lands there is forwarded on to the vault, which costs a forwarding fee and takes a few days.',
        note: 'Whether that is worth it is arithmetic: the tax you would have paid against the forwarding fee plus the wait. The app shows both figures on the address.',
      },
      {
        text: 'Register the parcel so we know it is coming. Carrier and tracking number are enough.',
        route: '#/inbound/parcels',
      },
      {
        text: 'Once it is at Delaware and before it is opened, you can have it shipped straight to you overnight instead of forwarding it — five cards or fewer, $100 flat, and it never enters the vault so no intake or storage is charged on it.',
        route: '#/inbound/parcels',
      },
    ],
  },
  {
    id: 'what-it-costs',
    title: 'What it costs to keep something here',
    category: 'money',
    summary: 'Intake, the included storage period, and what happens after it ends.',
    minutes: 3,
    video: null,
    related: ['cull-the-commons', 'wallet'],
    steps: [
      {
        text: 'Every item is charged an intake fee once, when it is booked in. What it costs depends on what it is — a card and a sealed case are not the same work.',
      },
      {
        text: 'The intake fee includes the first 180 days of storage. Nothing further is charged during that window.',
        note: 'Oversized items are on much shorter terms — 90 days included, and the full intake fee again every 90 days after that. Shelf space is the scarce resource.',
      },
      {
        text: 'After the included period, storage is 10% of that item’s own intake fee every 90 days. A cheap card costs little to keep; a sealed case costs what a sealed case costs.',
      },
      {
        text: 'Open any card to see exactly where it stands: what has been charged, when the next period falls, and how much it will be.',
        route: '#/vault/active',
      },
    ],
  },
  {
    id: 'cull-the-commons',
    title: 'Getting rid of cards that are not worth keeping',
    category: 'vault',
    summary: 'The free bulk cull, and the window it has to happen in.',
    minutes: 2,
    video: null,
    related: ['what-it-costs'],
    steps: [
      {
        text: 'A shoebox of commons becomes a vault of commons, and every one of them starts costing storage when the included period ends.',
      },
      {
        text: 'Open the vault and turn on Remove commons. Tick what you want gone.',
        route: '#/vault/active',
      },
      {
        text: 'Choose whether they are donated or thrown away, and confirm. It is free — charging you to stop charging you would be indefensible.',
      },
      {
        text: 'It only works within 30 days of a card arriving. After that it has been stored, storage was billed, and the arrangement has changed.',
        note: 'Cards past the window still appear in the list, greyed, with the reason on them — so you can see it is a rule and not a bug.',
      },
    ],
  },
  {
    id: 'grading',
    title: 'Sending a card to be graded',
    category: 'vault',
    summary: 'Choosing a tier, what the declared value is for, and where the card is while it is away.',
    minutes: 3,
    video: null,
    related: ['what-it-costs'],
    steps: [
      {
        text: 'Open the card in your vault and choose Third-party grading.',
        route: '#/vault/active',
      },
      {
        text: 'Pick a tier. A grader prices on two things: how much they will insure the card for, and how long they take. Everything else follows from those.',
      },
      {
        text: 'State what the card is worth. This is the figure the grader insures, and it is what decides which tiers you may use — a card above a tier’s ceiling has to go up a tier.',
        note: 'The top tier is refused for a card below its threshold, because you would be paying several times over for cover you cannot use.',
      },
      {
        text: 'Cards accumulate into a batch and go to the grader together. When the batch ships, your card moves to "At the grader" and cannot be sold, swapped or shipped until it comes back.',
      },
      {
        text: 'When the grade returns it is written onto the card with the certificate number, and the card goes back on the shelf.',
      },
    ],
  },
  {
    id: 'sell-it',
    title: 'Selling a card',
    category: 'selling',
    summary: 'Listing, offers, and the four routes to a sale.',
    minutes: 4,
    video: null,
    related: ['grading', 'ship-it-home'],
    steps: [
      {
        text: 'List it on the marketplace and set a price. Buyers can buy outright or make an offer.',
        route: '#/marketplace/browse',
      },
      {
        text: 'Offers land in My offers, where you accept, reject or counter. Nothing happens to the card until somebody accepts.',
        route: '#/marketplace/offers',
      },
      {
        text: 'Consignment is the other route: Bault sells it for you through a card show, an auction house or an eBay partner. Each has its own commission, its own payout window and its own rules — a card show has a date and a deadline; some channels take graded cards only.',
        route: '#/vault/active',
      },
      {
        text: 'A buyout is Bault buying it outright. You ask, an operator quotes, and you accept or decline. It pays less than the market because Bault then carries the risk of selling it.',
        route: '#/vault/active',
      },
      {
        text: 'Selling never moves a card physically. It changes who owns it; it stays on the same shelf until somebody ships it.',
      },
    ],
  },
  {
    id: 'trade-with-somebody',
    title: 'Swapping with another collector',
    category: 'selling',
    summary: 'How a swap is proposed, and what you need to know to propose one.',
    minutes: 2,
    video: null,
    related: ['sell-it'],
    steps: [
      {
        text: 'You need two things: their username, and the serial number of the card you want.',
        route: '#/marketplace/trade',
        note: 'The serial is the privacy control. There is no browsing of somebody else’s vault — you can only ask about a card you already know exists.',
      },
      {
        text: 'Offer one or more of your own cards against theirs and send the proposal.',
      },
      {
        text: 'Both sides have to accept. When they do, ownership of every card in the swap changes in one transaction — either all of it happens or none of it does.',
      },
      {
        text: 'A gift transfer is the same machinery with nothing asked in return, and it asks you to confirm twice, because it cannot be undone.',
      },
    ],
  },
  {
    id: 'ship-it-home',
    title: 'Shipping cards to yourself',
    category: 'outbound',
    summary: 'Pricing a parcel before you commit, and the options that matter.',
    minutes: 4,
    video: null,
    related: ['insurance-and-customs', 'share-a-parcel'],
    steps: [
      {
        text: 'Tick the cards you want and choose a saved address. The price appears as soon as both are set — nothing is created and nothing is charged until you pick a service.',
        route: '#/shipping-services/shipping',
      },
      {
        text: 'Services that cannot legally carry your parcel are shown anyway, with the rule they failed. If the cheap option will not insure a $3,000 card, you find that out here rather than after a claim.',
      },
      {
        text: 'Choose a service yourself, or press Choose for me and Bault takes the best balance of price and time among the ones that can carry it.',
      },
      {
        text: 'Rush is Bault picking and packing the same day. It does not make the carrier faster and is not presented as though it does.',
      },
      {
        text: 'While a request still says Requested you can add or remove cards, merge it with another request to the same address, or cancel it for nothing. Once a service is paid for, cancelling costs a restocking fee.',
        route: '#/shipping-services/tracking',
      },
    ],
  },
  {
    id: 'insurance-and-customs',
    title: 'Insurance, signatures and customs',
    category: 'outbound',
    summary: 'What is covered if a parcel vanishes, and what goes on the form at the border.',
    minutes: 3,
    video: null,
    related: ['ship-it-home'],
    steps: [
      {
        text: 'Insurance covers up to $5,000 on one parcel, priced as a percentage of what you insure.',
        route: '#/shipping-services/shipping',
      },
      {
        text: 'Anything insured above $500 is signed for. That is the condition the cover is written on — a parcel worth more than that left on a doorstep is not insured, so the two are not offered separately.',
      },
      {
        text: 'A tracker can travel inside the parcel, and is only sold alongside insurance, because it exists to help recover a parcel somebody is going to claim on.',
      },
      {
        text: 'An international parcel needs a customs value, and it is the figure YOU declare. Bault does not adjust, reduce or omit it — under-declaring to lower your duty would be done in your name and signed for by you.',
      },
      {
        text: 'A commercial invoice is generated from the shipment, one line per card, with an HS code and country of origin. Duty and tax at the far end are paid by whoever receives it.',
      },
    ],
  },
  {
    id: 'share-a-parcel',
    title: 'Shipping together with other collectors',
    category: 'outbound',
    summary: 'Several people, one parcel, one address, one payer.',
    minutes: 2,
    video: null,
    related: ['ship-it-home'],
    steps: [
      {
        text: 'Everybody creates their own shipment request, to exactly the same address.',
        route: '#/shipping-services/shipping',
      },
      {
        text: 'One of you opens a shared parcel and becomes the payer. They get a code.',
        route: '#/shipping-services/shared',
      },
      {
        text: 'The others join with the code and their own request. Nobody can be added without doing this — a parcel that could carry your cards without your say-so would be somebody else moving your property.',
      },
      {
        text: 'The payer closes it to new members when everybody is in. Each of you still owns exactly your own cards the whole way.',
      },
    ],
  },
  {
    id: 'wallet',
    title: 'Money in and money out',
    category: 'money',
    summary: 'Why a wallet request is reviewed, and what a negative balance does.',
    minutes: 3,
    video: null,
    related: ['what-it-costs'],
    steps: [
      {
        text: 'Raise a cash-in request naming how the money is coming and a reference. Submitting it moves nothing.',
        route: '#/wallet/requests',
      },
      {
        text: 'A person reviews it, marks it processing, and completes it. Only completion writes to the ledger — the balance is the sum of ledger rows and nothing else can move it.',
      },
      {
        text: 'Cashing out is the same shape in reverse.',
      },
      {
        text: 'A negative balance blocks new shipments and service requests. Past a threshold it suspends the account, and interest accrues on the debt after a grace period.',
        note: 'A suspended account can still sign in far enough to reach the helpdesk and its own profile. Locking somebody out of the only route to fixing it would be a lock with no key on the inside.',
      },
    ],
  },
  {
    id: 'ask-a-person',
    title: 'Getting a person to look at it',
    category: 'getting_started',
    summary: 'What the helpdesk is for, and what to put in a ticket.',
    minutes: 2,
    video: null,
    related: ['wallet'],
    steps: [
      {
        text: 'Open Support and start a ticket. Pick the category that fits — it is what decides who sees it.',
        route: '#/support/tickets',
      },
      {
        text: 'Say which item, parcel, shipment or request you mean, by its code. Every one of them has a code precisely so a conversation can name it.',
      },
      {
        text: 'Replies arrive as notifications and stay on the ticket. The thread is append-only: nothing said on it is edited or removed afterwards, by you or by staff.',
        route: '#/support/tickets',
      },
      {
        text: 'A large private sale is a ticket rather than a form, because it is a conversation with a specialist rather than something a screen can price.',
      },
    ],
  },
];

const BY_ID = new Map(GUIDES.map((g) => [g.id, g]));

export function guide(id: string): Guide | undefined {
  return BY_ID.get(id);
}

export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  'getting_started',
  'inbound',
  'vault',
  'selling',
  'outbound',
  'money',
];

/** Free-text search across a guide's title, summary and step text. */
export function matchesGuideSearch(g: Guide, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [g.title, g.summary, ...g.steps.map((s) => s.text), ...g.steps.map((s) => s.note ?? '')]
    .join(' ')
    .toLowerCase()
    .includes(q);
}
