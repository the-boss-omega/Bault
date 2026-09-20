/**
 * Hebrew for the intake policy the API publishes.
 *
 * `GET /content/intake-policy` is built from the modules that ENFORCE the rules,
 * which is what keeps the page from drifting — and those modules hold their
 * prose in English. A Hebrew reader met a page of English in the middle of the
 * one screen that says what Bault will and will not take.
 *
 * So the English stays the source of truth and this is its translation, keyed by
 * the same ids. A key that is missing here falls back to the server's English
 * rather than to nothing: a rule shown in the wrong language is a nuisance, and
 * a rule not shown at all is a rule somebody breaks.
 */

/** Why each refusal category exists, keyed by `DISPOSAL_CATEGORIES.key`. */
export const REFUSAL_REASON_HE: Record<string, string> = {
  gps_tracker:
    'מכשיר מעקב הוא משדר רדיו מופעל. חברות השילוח מגבילות אותו בהובלה אווירית, וכספת לא יכולה לאחסן מכשיר שממשיך לשדר את מיקומו של מישהו.',
  lithium_battery: 'תאי ליתיום הם חומר מסוכן בהובלה אווירית, ואי אפשר להחזיק או להעביר אותם.',
  liquid_or_glass:
    'מיכל שנשבר בתוך חבילה פוגע בכל שאר הפריטים שנוסעים איתה, כולל רכוש של אספנים אחרים.',
  flammable: 'חומרים דליקים הם חומרים מסוכנים, ואי אפשר לאחסן או להעביר אותם.',
  medical: 'תרופות ותוספי תזונה הם מוצרים מפוקחים ש־Bault אינה מורשית להחזיק.',
  cosmetics: 'קוסמטיקה ובשמים לרוב דליקים ומוגבלים בהובלה אווירית.',
  adult_material: 'לא מתקבל לאחסון או להעברה.',
  other_prohibited:
    'במחסן מגיעים דברים ששום רשימה לא צפתה. כל פריט שנדחה תחת הכותרת הזו נרשם עם הערה מחייבת שמתארת מה הוא היה.',
  no_value:
    'זו לא דחייה. חלק מהמשלוחים עולים יותר לטפל ולאחסן ממה שהם שווים, ולהניח אותם על מדף היה מחייב אתכם ביותר ממה שהפריטים יכולים להחזיר. תמיד תדעו מה נמצא ומה עלה בגורלו.',
};

/** The rules that are sentences rather than a list, keyed by `rules[].id`. */
export const POLICY_RULE_HE: Record<string, { heading: string; body: string }> = {
  'closed-list': {
    heading: 'רשימת הפריטים המתקבלים סגורה',
    body: 'הקליטה לא תרשום סוג שאינו ברשימה הזו. הבדיקה מתבצעת בכל נתיב שיכול ליצור פריט — קליטה בודדת, קליטה מרוכזת ופיצול לוט — כך שאין דרך פנימה לדבר שהרשימה לא מונה.',
  },
  trackers: {
    heading: 'אל תשימו מכשיר מעקב בחבילה שנשלחת אלינו',
    body: 'מכשיר GPS או AirTag שנמצא בחבילה נכנסת מוסר ומושמד, ואתם מקבלים על כך הודעה. זה אותו כלל שחברות השילוח מחילות עלינו, והוא עומד בעינו גם ש־Bault מוכרת מכשיר מעקב בדרך החוצה: מכשיר יוצא נוסע בחבילה ש־Bault ארזה, הצהירה עליה וביטחה, ונמסר לכם עם המסירה. מכשיר נכנס מגיע בלי הצהרה בתוך משלוח של מישהו אחר.',
  },
  'refusal-record': {
    heading: 'שום דבר שממוען אליכם לא נעלם בשקט',
    body: 'כשמגיע דבר שלא יכול להיכנס לכספת, נכתב רישום סילוק שמציין מה זה היה, איזו מארבע התוצאות התרחשה ומדוע — והודעה נשלחת אליכם ברגע שהרישום נסגר. הרישום קבוע.',
  },
  unattributable: {
    heading: 'חבילה שאי אפשר לשייך לחשבון נשמרת סגורה',
    body: 'אם התווית לא מציינת חשבון שאפשר לזהות, החבילה נרשמת כלא נתבעה, מה שנכתב עליה נשמר כלשונו, והיא נשמרת בלי להיפתח. היא חוזרת לתהליך הרגיל ברגע שמתברר של מי היא.',
  },
  condition: {
    heading: 'בדיקת המצב מתבצעת לפני שנרשם משהו',
    body: 'כל חבילה נפתחת מול ממצא מתועד — תקינה, אריזה פגומה או תכולה פגומה — עם הערה בכתב, והממצא מקבל חותמת זמן לפני שקיים רישום פריט כלשהו. אם הממצא אינו ״תקינה״ תדעו על כך מיד ולא אחרי שהתכולה נרשמה, כי לתביעה מול המוכר או חברת השילוח יש מועד אחרון.',
  },
  lots: {
    heading: 'חופן קלפים הוא לא לוט',
    body: 'לוט מאוחסן ומחויב כפריט אחד עד שהוא מפורק. מתחת לשישה קלפים זה גרוע יותר עבורכם מאשר עבורנו — אי אפשר למכור, לדרג או לשלוח קלף בודד מתוך לוט שלא פורק — ולכן לוט קלפים קטן מזה נקלט כמספר הפריטים הבודדים שבו, כל אחד עם מספר סידורי, תווית ורישום משלו.',
  },
  oversized: {
    heading: 'תנאי האחסון נקבעים ברגע הקבלה',
    body: 'השאלה אם פריט מאוחסן בתנאי הפריטים הגדולים נקבעת לפי הסוג שלו ברגע הקליטה, ולעולם לא מחושבת מחדש אחר כך. שינוי בטקסונומיה בשנה הבאה לא יכול לשנות רטרואקטיבית את מה שאתם משלמים על קופסה שעומדת על אותו מדף כל הזמן הזה.',
  },
};
