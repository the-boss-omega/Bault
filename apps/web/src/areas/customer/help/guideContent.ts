/**
 * Workflow guides — how each thing in Bault is actually done, in both languages.
 *
 * Ordered steps, each naming the screen it happens on, with a real hash route the
 * reader can follow. A guide that names `#/shipping-services/shipping` is
 * checkable against the router in a way a screen recording never is, which is
 * why these are written rather than filmed.
 *
 * The rule this module holds itself to is the FAQ's rule, and for the same
 * reason. Every sentence is a factual statement about what Bault does. Nothing
 * is market advice, nothing is a claim about what cards are worth, and nothing
 * describes a capability that does not exist. When a workflow has a constraint
 * that surprises people, the guide says the constraint rather than routing
 * around it.
 *
 * Both languages live side by side in each entry. The guides were English-only,
 * so a collector reading the app in Hebrew met a page of English at exactly the
 * moment they were asking how something works.
 */

export type GuideLocale = 'en' | 'he';
type Loc = Record<GuideLocale, string>;

export type GuideCategory = 'getting_started' | 'inbound' | 'vault' | 'selling' | 'outbound' | 'money';

export interface GuideStep {
  /** One action, in the imperative. */
  text: Loc;
  /** The hash route this step happens on, when it happens on one. */
  route?: string;
  /**
   * A constraint worth knowing BEFORE the step rather than after it. Present
   * only where there genuinely is one.
   */
  note?: Loc;
}

export interface Guide {
  /** Stable slug used by deep links (`#/faq/guides?g=<id>`). */
  id: string;
  title: Loc;
  category: GuideCategory;
  /** One sentence: what this gets you. */
  summary: Loc;
  /** How long the READING takes. Not how long the workflow takes. */
  minutes: number;
  steps: GuideStep[];
  /** Guides that answer the obvious next question. */
  related?: string[];
}

export const GUIDES: readonly Guide[] = [
  {
    id: 'first-week',
    title: { en: 'Your first week', he: 'השבוע הראשון שלכם' },
    category: 'getting_started',
    summary: {
      en: 'From a new account to a card on the shelf that you can sell, grade or ship.',
      he: 'מחשבון חדש ועד קלף על המדף שאפשר למכור, לדרג או לשלוח.',
    },
    minutes: 4,
    related: ['send-us-a-parcel', 'what-it-costs'],
    steps: [
      {
        text: {
          en: 'Confirm your email address from the link we send you. Until you do, the account exists but cannot sign in.',
          he: 'אשרו את כתובת הדוא״ל מהקישור שנשלח אליכם. עד שתעשו זאת, החשבון קיים אך אי אפשר להתחבר אליו.',
        },
        note: {
          en: 'The link is valid for 24 hours and can be used once. You can ask for another from the sign-in screen.',
          he: 'הקישור בתוקף ל־24 שעות וניתן לשימוש פעם אחת. אפשר לבקש קישור חדש ממסך ההתחברות.',
        },
      },
      {
        text: {
          en: 'Add a delivery address. This is where cards go when you ship them home — it is not where you send them to us.',
          he: 'הוסיפו כתובת למשלוח. לשם יישלחו הקלפים כשתשלחו אותם הביתה — זו לא הכתובת שאליה שולחים אלינו.',
        },
        route: '#/profile/addresses',
      },
      {
        text: {
          en: 'Find your inbound addresses. Every collector gets their own, addressed C/O your username.',
          he: 'מצאו את כתובות הקבלה שלכם. לכל אספן יש כתובות משלו, הממוענות C/O שם המשתמש שלו.',
        },
        route: '#/inbound/addresses',
        note: {
          en: 'Your username is permanent and cannot be changed. It is how a parcel is matched to you, so a package addressed to anything else may arrive unattributable.',
          he: 'שם המשתמש קבוע ולא ניתן לשינוי. דרכו חבילה משויכת אליכם, ולכן חבילה שממוענת אחרת עלולה להגיע בלי שאפשר לשייך אותה.',
        },
      },
      {
        text: {
          en: 'Tell us a parcel is coming before it arrives. It is not required, but an expected parcel is matched on arrival instead of being opened blind.',
          he: 'עדכנו אותנו שחבילה בדרך לפני שהיא מגיעה. זה לא חובה, אבל חבילה צפויה משויכת כבר בהגעה במקום להיפתח בלי לדעת של מי היא.',
        },
        route: '#/inbound/parcels',
      },
      {
        text: {
          en: 'When it arrives we open it, check it, photograph it and book each item into your vault. You are notified at each step.',
          he: 'כשהיא מגיעה אנחנו פותחים, בודקים, מצלמים ורושמים כל פריט בכספת שלכם. תקבלו התראה בכל שלב.',
        },
        route: '#/vault/active',
      },
    ],
  },
  {
    id: 'send-us-a-parcel',
    title: { en: 'Sending a parcel to the vault', he: 'שליחת חבילה לכספת' },
    category: 'inbound',
    summary: {
      en: 'Which of the two addresses to use, and what happens after it lands.',
      he: 'באיזו משתי הכתובות להשתמש, ומה קורה אחרי שהחבילה מגיעה.',
    },
    minutes: 3,
    related: ['first-week', 'what-it-costs'],
    steps: [
      {
        text: {
          en: 'Open your inbound addresses. There are two, and they are not interchangeable.',
          he: 'פתחו את כתובות הקבלה שלכם. יש שתיים, והן לא מחליפות זו את זו.',
        },
        route: '#/inbound/addresses',
      },
      {
        text: {
          en: 'The New Jersey address is the vault. Anything sent there stays there.',
          he: 'הכתובת בניו ג׳רזי היא הכספת. כל מה שנשלח לשם נשאר שם.',
        },
      },
      {
        text: {
          en: 'The Delaware address is a receiving point that stores nothing. Delaware levies no sales tax, so a purchase delivered there is not taxed by the destination state — and everything that lands there is forwarded on to the vault, which costs a forwarding fee and takes a few days.',
          he: 'הכתובת בדלאוור היא נקודת קבלה שלא מאחסנת דבר. בדלאוור אין מס מכירה, ולכן רכישה שנמסרת לשם לא ממוסה על ידי מדינת היעד — וכל מה שמגיע לשם מועבר לכספת, מה שעולה עמלת העברה ולוקח כמה ימים.',
        },
        note: {
          en: 'Whether that is worth it is arithmetic: the tax you would have paid against the forwarding fee plus the wait. The app shows both figures on the address.',
          he: 'אם זה משתלם זה עניין של חשבון: המס שהייתם משלמים מול עמלת ההעברה וההמתנה. האפליקציה מציגה את שני הנתונים ליד הכתובת.',
        },
      },
      {
        text: {
          en: 'Register the parcel so we know it is coming. Carrier and tracking number are enough.',
          he: 'רשמו את החבילה כדי שנדע שהיא בדרך. מספיקים שם חברת השילוח ומספר המעקב.',
        },
        route: '#/inbound/parcels',
      },
      {
        text: {
          en: 'Once it is at Delaware and before it is opened, you can have it shipped straight to you overnight instead of forwarding it — five cards or fewer, $100 flat, and it never enters the vault so no intake or storage is charged on it.',
          he: 'כשהיא בדלאוור ולפני שנפתחה, אפשר לשלוח אותה ישירות אליכם בלילה במקום להעביר אותה — עד חמישה קלפים, $100 קבוע, והיא לא נכנסת לכספת כך שאין עליה עמלת קליטה או אחסון.',
        },
        route: '#/inbound/parcels',
      },
    ],
  },
  {
    id: 'what-it-costs',
    title: { en: 'What it costs to keep something here', he: 'כמה עולה להחזיק כאן פריט' },
    category: 'money',
    summary: {
      en: 'Intake, the included storage period, and what happens after it ends.',
      he: 'קליטה, תקופת האחסון הכלולה, ומה קורה כשהיא מסתיימת.',
    },
    minutes: 3,
    related: ['cull-the-commons', 'wallet'],
    steps: [
      {
        text: {
          en: 'Every item is charged an intake fee once, when it is booked in. What it costs depends on what it is — a card and a sealed case are not the same work.',
          he: 'כל פריט מחויב בעמלת קליטה פעם אחת, כשהוא נרשם. הסכום תלוי בסוג הפריט — קלף וארגז סגור הם לא אותה עבודה.',
        },
      },
      {
        text: {
          en: 'The intake fee includes the first 180 days of storage. Nothing further is charged during that window.',
          he: 'עמלת הקליטה כוללת את 180 ימי האחסון הראשונים. בתקופה הזו לא מחויב דבר נוסף.',
        },
        note: {
          en: 'Oversized items are on much shorter terms — 90 days included, and the full intake fee again every 90 days after that. Shelf space is the scarce resource.',
          he: 'לפריטים גדולים יש תנאים קצרים בהרבה — 90 יום כלולים, ואחר כך עמלת הקליטה המלאה שוב כל 90 יום. מקום על המדף הוא המשאב המוגבל.',
        },
      },
      {
        text: {
          en: 'After the included period, storage is 10% of that item’s own intake fee every 90 days. A cheap card costs little to keep; a sealed case costs what a sealed case costs.',
          he: 'אחרי התקופה הכלולה, האחסון עולה 10% מעמלת הקליטה של אותו פריט כל 90 יום. קלף זול עולה מעט לשמור; ארגז סגור עולה כמו ארגז סגור.',
        },
      },
      {
        text: {
          en: 'Open any card to see exactly where it stands: what has been charged, when the next period falls, and how much it will be.',
          he: 'פתחו כל קלף כדי לראות בדיוק איפה הוא עומד: מה חויב, מתי התקופה הבאה, וכמה היא תעלה.',
        },
        route: '#/vault/active',
      },
    ],
  },
  {
    id: 'cull-the-commons',
    title: { en: 'Getting rid of cards that are not worth keeping', he: 'להיפטר מקלפים שלא שווה לשמור' },
    category: 'vault',
    summary: {
      en: 'The free bulk cull, and the window it has to happen in.',
      he: 'הסרה מרוכזת בחינם, וחלון הזמן שבו היא אפשרית.',
    },
    minutes: 2,
    related: ['what-it-costs'],
    steps: [
      {
        text: {
          en: 'A shoebox of commons becomes a vault of commons, and every one of them starts costing storage when the included period ends.',
          he: 'קופסת נעליים של קלפים זולים הופכת לכספת של קלפים זולים, וכל אחד מהם מתחיל לעלות אחסון כשהתקופה הכלולה נגמרת.',
        },
      },
      {
        text: {
          en: 'Open the vault and turn on Remove commons. Tick what you want gone.',
          he: 'פתחו את הכספת והפעילו את הסרת הפריטים הזולים. סמנו את מה שתרצו להסיר.',
        },
        route: '#/vault/active',
      },
      {
        text: {
          en: 'Choose whether they are donated or thrown away, and confirm. It is free.',
          he: 'בחרו אם לתרום אותם או להשליך אותם, ואשרו. זה בחינם.',
        },
      },
      {
        text: {
          en: 'It only works within 30 days of a card arriving. After that it has been stored, storage was billed, and the arrangement has changed.',
          he: 'זה אפשרי רק בתוך 30 יום מהגעת הקלף. אחרי זה הוא כבר אוחסן, האחסון חויב, וההסדר השתנה.',
        },
        note: {
          en: 'Cards past the window still appear in the list, greyed, with the reason on them — so you can see it is a rule and not a bug.',
          he: 'קלפים שעברו את החלון עדיין מופיעים ברשימה, באפור, עם הסיבה לצידם — כדי שיהיה ברור שזה כלל ולא תקלה.',
        },
      },
    ],
  },
  {
    id: 'grading',
    title: { en: 'Sending a card to be graded', he: 'שליחת קלף לדירוג' },
    category: 'vault',
    summary: {
      en: 'Choosing a tier, what the declared value is for, and where the card is while it is away.',
      he: 'בחירת דרגה, למה משמש השווי המוצהר, ואיפה הקלף בזמן שהוא לא כאן.',
    },
    minutes: 3,
    related: ['what-it-costs'],
    steps: [
      {
        text: {
          en: 'Open the card in your vault and choose Third-party grading.',
          he: 'פתחו את הקלף בכספת ובחרו דירוג על ידי גוף חיצוני.',
        },
        route: '#/vault/active',
      },
      {
        text: {
          en: 'Pick a tier. A grader prices on two things: how much they will insure the card for, and how long they take. Everything else follows from those.',
          he: 'בחרו דרגה. גוף הדירוג מתמחר לפי שני דברים: על כמה הוא יבטח את הקלף, וכמה זמן זה ייקח. כל השאר נגזר מהם.',
        },
      },
      {
        text: {
          en: 'State what the card is worth. This is the figure the grader insures, and it is what decides which tiers you may use — a card above a tier’s ceiling has to go up a tier.',
          he: 'ציינו כמה הקלף שווה. זה הסכום שגוף הדירוג מבטח, והוא קובע באילו דרגות אפשר להשתמש — קלף מעל התקרה של דרגה צריך לעלות דרגה.',
        },
        note: {
          en: 'The top tier is refused for a card below its threshold, because you would be paying several times over for cover you cannot use.',
          he: 'הדרגה העליונה נדחית לקלף מתחת לסף שלה, כי הייתם משלמים פי כמה על כיסוי שלא תוכלו לנצל.',
        },
      },
      {
        text: {
          en: 'Cards accumulate into a batch and go to the grader together. When the batch ships, your card moves to "At the grader" and cannot be sold, swapped or shipped until it comes back.',
          he: 'הקלפים מצטברים למשלוח מרוכז ויוצאים לגוף הדירוג יחד. כשהמשלוח יוצא, הקלף עובר למצב ״אצל גוף הדירוג״ ואי אפשר למכור, להחליף או לשלוח אותו עד שהוא חוזר.',
        },
      },
      {
        text: {
          en: 'When the grade returns it is written onto the card with the certificate number, and the card goes back on the shelf.',
          he: 'כשהציון חוזר הוא נרשם על הקלף יחד עם מספר התעודה, והקלף חוזר למדף.',
        },
      },
    ],
  },
  {
    id: 'sell-it',
    title: { en: 'Selling a card', he: 'מכירת קלף' },
    category: 'selling',
    summary: {
      en: 'Listing, offers, and the four routes to a sale.',
      he: 'הצעה למכירה, הצעות מחיר, וארבע הדרכים למכור.',
    },
    minutes: 4,
    related: ['grading', 'ship-it-home'],
    steps: [
      {
        text: {
          en: 'List it on the marketplace and set a price. Buyers can buy outright or make an offer.',
          he: 'הציעו אותו בשוק וקבעו מחיר. קונים יכולים לקנות מיד או להגיש הצעה.',
        },
        route: '#/marketplace/browse',
      },
      {
        text: {
          en: 'Offers land in My offers, where you accept, reject or counter. Nothing happens to the card until somebody accepts.',
          he: 'הצעות מגיעות ל״ההצעות שלי״, שם אפשר לקבל, לדחות או להציע נגדית. לקלף לא קורה דבר עד שמישהו מקבל.',
        },
        route: '#/marketplace/offers',
      },
      {
        text: {
          en: 'Consignment is the other route: Bault sells it for you through a card show, an auction house or an eBay partner. Each has its own commission, its own payout window and its own rules — a card show has a date and a deadline; some channels take graded cards only.',
          he: 'קונסיגנציה היא הדרך השנייה: Bault מוכרת אותו בשבילכם בתערוכה, בבית מכירות פומביות או דרך שותף ב־eBay. לכל ערוץ יש עמלה, זמן תשלום וכללים משלו — לתערוכה יש תאריך ומועד אחרון; חלק מהערוצים מקבלים רק קלפים מדורגים.',
        },
        route: '#/vault/active',
      },
      {
        text: {
          en: 'A buyout is Bault buying it outright. You ask, an operator quotes, and you accept or decline. It pays less than the market because Bault then carries the risk of selling it.',
          he: 'רכישה על ידי Bault פירושה ש־Bault קונה אותו מכם. אתם מבקשים, איש צוות מציע מחיר, ואתם מקבלים או דוחים. זה משלם פחות מהשוק, כי מעכשיו Bault נושאת בסיכון של מכירתו.',
        },
        route: '#/vault/active',
      },
      {
        text: {
          en: 'Selling never moves a card physically. It changes who owns it; it stays on the same shelf until somebody ships it.',
          he: 'מכירה לעולם לא מזיזה קלף פיזית. היא משנה את הבעלים; הקלף נשאר על אותו מדף עד שמישהו שולח אותו.',
        },
      },
    ],
  },
  {
    id: 'trade-with-somebody',
    title: { en: 'Swapping with another collector', he: 'החלפה עם אספן אחר' },
    category: 'selling',
    summary: {
      en: 'How a swap is proposed, and what you need to know to propose one.',
      he: 'איך מציעים החלפה, ומה צריך לדעת כדי להציע אחת.',
    },
    minutes: 2,
    related: ['sell-it'],
    steps: [
      {
        text: {
          en: 'You need two things: their username, and the serial number of the card you want.',
          he: 'צריך שני דברים: שם המשתמש של הצד השני, והמספר הסידורי של הקלף שאתם רוצים.',
        },
        route: '#/marketplace/trade',
        note: {
          en: 'The serial is the privacy control. There is no browsing of somebody else’s vault — you can only ask about a card you already know exists.',
          he: 'המספר הסידורי הוא אמצעי הפרטיות. אי אפשר לדפדף בכספת של מישהו אחר — אפשר לשאול רק על קלף שאתם כבר יודעים שקיים.',
        },
      },
      {
        text: {
          en: 'Offer one or more of your own cards against theirs and send the proposal.',
          he: 'הציעו קלף אחד או יותר שלכם מול שלהם ושלחו את ההצעה.',
        },
      },
      {
        text: {
          en: 'Both sides have to accept. When they do, ownership of every card in the swap changes in one transaction — either all of it happens or none of it does.',
          he: 'שני הצדדים צריכים לאשר. כשהם מאשרים, הבעלות על כל הקלפים בהחלפה עוברת בפעולה אחת — או שהכול קורה או ששום דבר לא קורה.',
        },
      },
      {
        text: {
          en: 'A gift transfer is the same machinery with nothing asked in return, and it asks you to confirm twice, because it cannot be undone.',
          he: 'העברה במתנה עובדת באותו אופן בלי לבקש דבר בתמורה, והיא מבקשת אישור פעמיים, כי אי אפשר לבטל אותה.',
        },
      },
    ],
  },
  {
    id: 'ship-it-home',
    title: { en: 'Shipping cards to yourself', he: 'שליחת קלפים אליכם' },
    category: 'outbound',
    summary: {
      en: 'Pricing a parcel before you commit, and the options that matter.',
      he: 'תמחור חבילה לפני שמתחייבים, והאפשרויות שחשובות.',
    },
    minutes: 4,
    related: ['insurance-and-customs', 'share-a-parcel'],
    steps: [
      {
        text: {
          en: 'Tick the cards you want and choose a saved address. The price appears as soon as both are set — nothing is created and nothing is charged until you pick a service.',
          he: 'סמנו את הקלפים ובחרו כתובת שמורה. המחיר מופיע ברגע ששניהם נבחרו — שום דבר לא נוצר ושום דבר לא מחויב עד שבוחרים שירות.',
        },
        route: '#/shipping-services/shipping',
      },
      {
        text: {
          en: 'Services that cannot legally carry your parcel are shown anyway, with the rule they failed. If the cheap option will not insure a $3,000 card, you find that out here rather than after a claim.',
          he: 'שירותים שלא יכולים להוביל את החבילה מוצגים בכל זאת, עם הכלל שבו נכשלו. אם האפשרות הזולה לא תבטח קלף של $3,000, תגלו את זה כאן ולא אחרי תביעה.',
        },
      },
      {
        text: {
          en: 'Choose a service yourself, or press Choose for me and Bault takes the best balance of price and time among the ones that can carry it.',
          he: 'בחרו שירות בעצמכם, או לחצו ״בחרו בשבילי״ ו־Bault תבחר את האיזון הטוב ביותר בין מחיר לזמן מבין אלה שיכולים להוביל אותה.',
        },
      },
      {
        text: {
          en: 'Rush is Bault picking and packing the same day. It does not make the carrier faster and is not presented as though it does.',
          he: 'משלוח דחוף פירושו ש־Bault מלקטת ואורזת באותו יום. זה לא מזרז את חברת השילוח, ולא מוצג כאילו כן.',
        },
      },
      {
        text: {
          en: 'While a request still says Requested you can add or remove cards, merge it with another request to the same address, or cancel it for nothing. Once a service is paid for, cancelling costs a restocking fee.',
          he: 'כל עוד בקשה במצב ״התבקש״ אפשר להוסיף או להסיר קלפים, לאחד אותה עם בקשה אחרת לאותה כתובת, או לבטל אותה בחינם. אחרי ששירות שולם, ביטול עולה עמלת החזרה למלאי.',
        },
        route: '#/shipping-services/tracking',
      },
    ],
  },
  {
    id: 'insurance-and-customs',
    title: { en: 'Insurance, signatures and customs', he: 'ביטוח, חתימות ומכס' },
    category: 'outbound',
    summary: {
      en: 'What is covered if a parcel vanishes, and what goes on the form at the border.',
      he: 'מה מכוסה אם חבילה נעלמת, ומה נכתב בטופס בגבול.',
    },
    minutes: 3,
    related: ['ship-it-home'],
    steps: [
      {
        text: {
          en: 'Insurance covers up to $5,000 on one parcel, priced as a percentage of what you insure.',
          he: 'הביטוח מכסה עד $5,000 לחבילה אחת, ומתומחר כאחוז מהסכום שמבטחים.',
        },
        route: '#/shipping-services/shipping',
      },
      {
        text: {
          en: 'Anything insured above $500 is signed for. That is the condition the cover is written on — a parcel worth more than that left on a doorstep is not insured, so the two are not offered separately.',
          he: 'כל מה שמבוטח מעל $500 נמסר בחתימה. זה התנאי שעליו נכתב הכיסוי — חבילה ששווה יותר מזה ונשארת על מפתן הדלת אינה מבוטחת, ולכן השניים לא מוצעים בנפרד.',
        },
      },
      {
        text: {
          en: 'A tracker can travel inside the parcel, and is only sold alongside insurance, because it exists to help recover a parcel somebody is going to claim on.',
          he: 'מכשיר מעקב יכול לנסוע בתוך החבילה, והוא נמכר רק יחד עם ביטוח, כי הוא נועד לעזור לאתר חבילה שמישהו עומד לתבוע עליה.',
        },
      },
      {
        text: {
          en: 'An international parcel needs a customs value, and it is the figure YOU declare. Bault does not adjust, reduce or omit it — under-declaring to lower your duty would be done in your name and signed for by you.',
          he: 'חבילה בינלאומית צריכה שווי למכס, וזה הסכום שאתם מצהירים עליו. Bault לא משנה, מקטינה או משמיטה אותו — הצהרת חסר כדי להפחית מכס הייתה נעשית בשמכם ובחתימתכם.',
        },
      },
      {
        text: {
          en: 'A commercial invoice is generated from the shipment, one line per card, with an HS code and country of origin. Duty and tax at the far end are paid by whoever receives it.',
          he: 'חשבונית מסחרית מופקת מהמשלוח, שורה לכל קלף, עם קוד HS וארץ מקור. מכס ומס ביעד משולמים על ידי מי שמקבל את החבילה.',
        },
      },
    ],
  },
  {
    id: 'share-a-parcel',
    title: { en: 'Shipping together with other collectors', he: 'משלוח משותף עם אספנים אחרים' },
    category: 'outbound',
    summary: {
      en: 'Several people, one parcel, one address, one payer.',
      he: 'כמה אנשים, חבילה אחת, כתובת אחת, משלם אחד.',
    },
    minutes: 2,
    related: ['ship-it-home'],
    steps: [
      {
        text: {
          en: 'Everybody creates their own shipment request, to exactly the same address.',
          he: 'כל אחד יוצר בקשת משלוח משלו, לאותה כתובת בדיוק.',
        },
        route: '#/shipping-services/shipping',
      },
      {
        text: {
          en: 'One of you opens a shared parcel and becomes the payer. They get a code.',
          he: 'אחד מכם פותח חבילה משותפת והופך למשלם. הוא מקבל קוד.',
        },
        route: '#/shipping-services/shared',
      },
      {
        text: {
          en: 'The others join with the code and their own request. Nobody can be added without doing this — a parcel that could carry your cards without your say-so would be somebody else moving your property.',
          he: 'האחרים מצטרפים עם הקוד ועם הבקשה שלהם. אי אפשר לצרף מישהו בלי זה — חבילה שיכולה לשאת את הקלפים שלכם בלי הסכמתכם הייתה מישהו אחר שמזיז את הרכוש שלכם.',
        },
      },
      {
        text: {
          en: 'The payer closes it to new members when everybody is in. Each of you still owns exactly your own cards the whole way.',
          he: 'המשלם סוגר אותה לחברים חדשים כשכולם בפנים. כל אחד מכם נשאר הבעלים של הקלפים שלו בלבד לאורך כל הדרך.',
        },
      },
    ],
  },
  {
    id: 'wallet',
    title: { en: 'Money in and money out', he: 'הכנסת כסף ומשיכתו' },
    category: 'money',
    summary: {
      en: 'Which payments settle at once, why the others are reviewed, and what a negative balance does.',
      he: 'אילו תשלומים נכנסים מיד, למה האחרים נבדקים, ומה עושה יתרה שלילית.',
    },
    minutes: 3,
    related: ['what-it-costs'],
    steps: [
      {
        text: {
          en: 'A card or PayPal Goods & Services payment, where offered, credits the balance as soon as it clears.',
          he: 'תשלום בכרטיס אשראי או ב־PayPal Goods & Services, כשהם זמינים, מזכה את היתרה ברגע שהוא עובר.',
        },
        route: '#/wallet/cash-in',
      },
      {
        text: {
          en: 'A bank transfer or PayPal Friends & Family is a cash-in request naming how the money is coming and a reference. Submitting it moves nothing.',
          he: 'העברה בנקאית או PayPal Friends & Family הן בקשת הפקדה שמציינת איך הכסף מגיע ואסמכתה. השליחה עצמה לא מזיזה דבר.',
        },
        route: '#/wallet/requests',
      },
      {
        text: {
          en: 'A person reviews it, marks it processing, and completes it. Only completion writes to the ledger — the balance is the sum of ledger rows and nothing else can move it.',
          he: 'אדם בודק אותה, מסמן אותה בטיפול ומשלים אותה. רק ההשלמה נרשמת ביומן — היתרה היא סכום שורות היומן ושום דבר אחר לא יכול לשנות אותה.',
        },
      },
      {
        text: {
          en: 'Cashing out is the same shape in reverse, and the fee is shown before you submit.',
          he: 'משיכה היא אותו תהליך בכיוון ההפוך, והעמלה מוצגת לפני השליחה.',
        },
        route: '#/wallet/cash-out',
      },
      {
        text: {
          en: 'A negative balance blocks new shipments and service requests. Past a threshold it suspends the account, and interest accrues on the debt after a grace period.',
          he: 'יתרה שלילית חוסמת משלוחים ובקשות שירות חדשים. מעבר לסף היא משעה את החשבון, ואחרי תקופת חסד נצברת ריבית על החוב.',
        },
        note: {
          en: 'A suspended account can still sign in far enough to reach the helpdesk and its own profile, because that is the route to fixing it.',
          he: 'חשבון מושעה עדיין יכול להתחבר ולהגיע לתמיכה ולפרופיל שלו, כי זו הדרך לתקן את המצב.',
        },
      },
    ],
  },
  {
    id: 'ask-a-person',
    title: { en: 'Getting a person to look at it', he: 'לקבל מענה מאדם' },
    category: 'getting_started',
    summary: {
      en: 'What the helpdesk is for, and what to put in a ticket.',
      he: 'למה נועדה התמיכה, ומה לכתוב בפנייה.',
    },
    minutes: 2,
    related: ['wallet'],
    steps: [
      {
        text: {
          en: 'Open Support and start a ticket. Pick the category that fits — it is what decides who sees it.',
          he: 'פתחו את התמיכה והתחילו פנייה. בחרו את הקטגוריה המתאימה — היא קובעת מי יראה אותה.',
        },
        route: '#/support/new',
      },
      {
        text: {
          en: 'Say which item, parcel, shipment or request you mean, by its code. Every one of them has a code precisely so a conversation can name it.',
          he: 'ציינו לאיזה פריט, חבילה, משלוח או בקשה אתם מתכוונים, לפי הקוד שלו. לכל אחד מהם יש קוד בדיוק כדי ששיחה תוכל לציין אותו.',
        },
      },
      {
        text: {
          en: 'Replies arrive as notifications and stay on the ticket. The thread is append-only: nothing said on it is edited or removed afterwards, by you or by staff.',
          he: 'תשובות מגיעות כהתראות ונשמרות בפנייה. השרשור נכתב בהוספה בלבד: שום דבר שנאמר בו לא נערך או נמחק אחר כך, לא על ידיכם ולא על ידי הצוות.',
        },
        route: '#/support/tickets',
      },
      {
        text: {
          en: 'A large private sale is a ticket rather than a form, because it is a conversation with a specialist rather than something a screen can price.',
          he: 'מכירה פרטית גדולה היא פנייה ולא טופס, כי זו שיחה עם מומחה ולא משהו שמסך יכול לתמחר.',
        },
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

/** Everything a guide says in one locale, for search. */
export function guideText(g: Guide, locale: GuideLocale): string {
  return [
    g.title[locale],
    g.summary[locale],
    ...g.steps.map((s) => s.text[locale]),
    ...g.steps.map((s) => s.note?.[locale] ?? ''),
  ].join(' ');
}

/** Free-text search across a guide's title, summary and step text, in either language. */
export function matchesGuideSearch(g: Guide, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return `${guideText(g, 'en')} ${guideText(g, 'he')}`.toLowerCase().includes(q);
}
