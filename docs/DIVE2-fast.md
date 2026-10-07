# DIVE2 המהיר, כל בלוק בקוד בפחות מעשר שעות

המדריך הזה נכתב כדי שתוכלו להכיר כל קובץ וכל בלוק משמעותי בקוד של Bault, ולעבוד עליו לבד, בפחות מעשר שעות. הוא מבוסס על הניתוח המלא שנבדק מול הקוד ב `docs/DIVE2.md`, ולא משנה שום קוד בריפו.

## איך המדריך חוסך זמן

- **דפוסים מוסברים פעם אחת.** רוב הקבצים בריפו חוזרים על אחד עשר דפוסים, controller, service עם טרנזקציה, טבלת Drizzle, migration, job של worker, מסך React ועוד. פרק הדפוסים מסביר כל דפוס פעם אחת על קובץ אמיתי. בכל מקום אחר כתוב רק `דפוס P3` ומה שונה.
- **טבלת בלוקים לכל קובץ.** לכל קובץ עם לוגיקה יש טבלה, שורה לכל בלוק, מה הוא עושה, ומה חייבים לדעת לפני שמשנים אותו. העמודה הימנית היא החשובה ביותר.
- **קבצים טריוויאליים בשורה אחת.** קונפיגורציות קטנות, אייקונים, snapshots ורוב קבצי הבדיקות מופיעים כשורה בטבלה.
- **פרק עבודה בסוף.** מתכונים מעשיים, איך מריצים, איך מוסיפים route, טבלה, מסך או job, ואיך נוגעים בכסף בלי לשבור דבר.

## איך לקרוא

- קראו את העמוד הבא ואת פרק הדפוסים ברצף. בלעדיהם שאר המדריך לא יהיה מובן.
- בפרקי הקבצים פתחו את הקובץ בחלון שני. קראו את טבלת הבלוקים, והציצו בקוד רק בשורות שמסומנות בעמודה הימנית.
- מזהה כמו E4 הוא ממצא מאומת. הטבלה בעמוד הבא מסבירה כל אחד בשורה אחת.
- כשצריך עוד עומק בקובץ מסוים, אותו קובץ מוסבר שורה אחרי שורה ב `docs/DIVE2.md`.

## כמה זמן זה לוקח

| חלק | נושא | מילים | זמן |
|---|---|---|---|
| | העמודים הפותחים | 936 | 5 דקות |
| פרק הדפוסים | הדפוסים שחוזרים בכל הקוד | 5,784 | 20 דקות |
| פרק 1 | שלד הריפו, החבילות המשותפות, הסקריפטים, התשתית וה CI | 6,687 | 30 דקות |
| פרק 2 | תהליך ה API, עלייה, תשתית משותפת וה seed | 8,152 | 35 דקות |
| פרק 3 | מודל הנתונים וה migrations | 10,848 | 50 דקות |
| פרק 4 | חשבונות, אימות, אבטחה, מדיה, תמיכה, כסף, תמחור ונאמנות | 15,310 | שעה ו 10 דקות |
| פרק 5 | קליטה, משמורת, הכספת, חברויות וקונסולת הניהול בצד השרת | 12,671 | 55 דקות |
| פרק 6 | השוק, התראות, שירותים על פריט מאוחסן ומשלוחים | 12,750 | 55 דקות |
| פרק 7 | ה worker והבדיקות | 8,303 | 35 דקות |
| פרק 8 | ה SPA, עלייה, רכיבי יסוד, מודולים משותפים ומסכי לקוח ראשונים | 13,771 | שעה |
| פרק 9 | שאר מסכי הלקוח, המחסן והמנהל | 9,237 | 40 דקות |
| פרק העבודה | איך עובדים על הקוד | 6,813 | 30 דקות |
| | הכל | 111,262 | 8 שעות ו 15 דקות |

ההערכה מניחה קריאה של 300 מילים בדקה, ועוד בערך 35 אחוז זמן להצצה בקוד. חלוקה מומלצת היא חמש ישיבות של שעתיים, ישיבה ראשונה לעמודים הפותחים, לדפוסים ולפרקים 1 ו 2, שנייה לפרקים 3 ו 4, שלישית לפרקים 5 ו 6, רביעית לפרקים 7 ו 8, וחמישית לפרק 9 ולפרק העבודה.

## המערכת בעמוד אחד

Bault הוא כספת ושוק לקלפי אספנות. אספן שולח חבילה למחסן, המחסן פותח, מצלם, מקצה מספר סידורי ומאחסן כל קלף בתא. מאותו רגע הקלף הוא רשומה עם בעלים, מיקום, מצב ותקופת אחסון שמחויבת אוטומטית. הבעלים יכול למכור בשוק הפנימי, להחליף, לשלוח לדירוג או לצילום, לבקש משלוח הביתה, או למכור ל Bault עצמה.

המערכת בנויה משלושה תהליכים.

- **ה API** ב `apps/api`. מונוליט NestJS אחד עם 15 מודולים עסקיים ו 245 routes תחת `/api/v1`. כל הלוגיקה העסקית יושבת כאן.
- **ה SPA** ב `apps/web`. אפליקציית React עם Vite, ניתוב לפי hash, עברית ואנגלית, ושלושה אזורים לפי תפקיד, לקוח, מחסן ומנהל.
- **ה worker** ב `apps/worker`. תהליך Node שמריץ שמונה עבודות מתוזמנות עם pg-boss, למשל חיוב אחסון, ריבית על חוב ומעקב משלוחים.

מסביבם יש מסד PostgreSQL יחיד שמחזיק גם את התורים, אחסון S3 לתמונות, PayPal לכסף, EasyPost למשלוחים ו SMTP למייל. שלוש חבילות משותפות ב `packages` מחזיקות את סכמת משתני הסביבה, את ה adapters לספקים החיצוניים, ומקום לטיפוסים משותפים.

```mermaid
flowchart LR
  SPA[React SPA] -->|HTTPS| NG[nginx]
  NG -->|/api/| API[NestJS API]
  API --> PG[(PostgreSQL)]
  WK[worker, pg-boss] --> PG
  API --> S3[(S3, תמונות)]
  API --> PP[PayPal]
  PP -->|webhook| API
  API --> EP[EasyPost]
  API --> SM[SMTP]
  WK --> EP
  WK --> SM
```

### ארבעה דברים שכדאי לזכור לאורך כל הקריאה

1. **שלושה יומנים שאי אפשר לשנות הם הלב.** יומן המשמורת מתעד כל מעבר של פריט בין מצבים ובין בעלים. יומן ההעברות מתעד כל מעבר בין תאים. יומן הכסף מתעד כל תנועה כספית. triggers במסד חוסמים עדכון ומחיקה של שורות בהם. יתרת ארנק לא נשמרת בשום מקום, היא תמיד סכום השורות ביומן הכסף. כל שינוי בבעלות, במיקום או בכסף צריך לעבור דרך `CustodyService` ו `LedgerService` בטרנזקציה אחת.
2. **כל route סגור כברירת מחדל.** הבקשה עוברת קודם הגבלת קצב, אחר כך בדיקת session, ואחר כך בדיקת תפקיד. route פתוח חייב להיות מסומן במפורש.
3. **ה worker לא משתף קוד עם ה API.** הוא כותב SQL גולמי לאותן טבלאות. שינוי בטבלה חייב להיבדק גם מולו.
4. **הערות בקוד מתארות לרוב כוונה ולא מציאות.** איפה שהן סותרות את הקוד, המדריך אומר את זה.

### הממצאים המאומתים בשורה אחת

| מזהה | חומרה | מה הבעיה |
|---|---|---|
| E1 | P0 | קניות מקבילות של אותו קונה מוציאות יותר כסף ממה שיש לו, כי היתרה נבדקת בלי נעילה |
| E2 | P0 | ה migrator המקומפל ב image לא מתקין את ה triggers שמגנים על היומנים |
| E3 | P0 | אין יצירה של הזמנת PayPal בשום מקום, ולכן טעינה מיידית של הארנק לא עובדת |
| E4 | P0 | העברת בעלות לא בודקת מי הבעלים הנוכחי |
| E5 | P0 | אין גיבוי שנבדק ואין PITR |
| E6 | P1 | מסד חדש בלי seed לא יכול לתמחר שום פעולה |
| E7 | P1 | `EXPOSE_API_DOCS=false` דווקא מדליק את תיעוד ה API |
| E8 | P1 | ה API מקבל גוף מקודד כטופס, ולכן login CSRF אפשרי |
| E9 | P1 | כל משתמש מחובר יכול להעלות קבצים, ותוכן הקובץ לא נבדק |
| E10 | P1 | כשל באחסון מחזיר שגיאת 500 כללית |
| E11 | P1 | ה seed שמוחק את כל המסד נמצא בתוך image הייצור |
| E12 | P1 | שש פגיעויות בחומרה גבוהה בתלויות הייצור |
| E13 | P1 | זמן התגובה של ההתחברות חושף אם חשבון קיים |
| E14 | P1 | ברירת המחדל של `TRUST_PROXY` גורמת לכל הלקוחות להיראות כאותו IP |
| E15 | P1 | ל worker אין כיבוי מסודר ואין אות חיים |
| E16 | P2 | חבילות הבדיקות תלויות במצב המסד ובסדר ההרצה |
| E17 | P1 | מעקב המשלוחים ב worker תמיד משתמש ב adapter המזויף |
| E18 | P1 | תשלום משלוח, הצעת white glove ומימון escrow בודקים יתרה מחוץ לטרנזקציה |
| E19 | P1 | הסיסמה של `/docs` לא מגינה על `/docs-json` |
| E20 | P1 | ה FAQ הוא העתק של ה FAQ של ShipMyCards |
| E21 | P1 | אין תנאי שימוש ואין מדיניות פרטיות |
| E22 | P1 | כותרות האבטחה של nginx לא מגיעות לדף ה HTML |

הפירוט המלא של כל ממצא, איך הוא אומת ואיך מתקנים אותו, נמצא בפרק 27 של `docs/DIVE2.md`.

## תוכן העניינים

- פרק הדפוסים. הדפוסים שחוזרים בכל הקוד
- פרק 1. שלד הריפו, החבילות המשותפות, הסקריפטים, התשתית וה CI
- פרק 2. תהליך ה API, עלייה, תשתית משותפת וה seed
- פרק 3. מודל הנתונים וה migrations
- פרק 4. חשבונות, אימות, אבטחה, מדיה, תמיכה, כסף, תמחור ונאמנות
- פרק 5. קליטה, משמורת, הכספת, חברויות וקונסולת הניהול בצד השרת
- פרק 6. השוק, התראות, שירותים על פריט מאוחסן ומשלוחים
- פרק 7. ה worker והבדיקות
- פרק 8. ה SPA, עלייה, רכיבי יסוד, מודולים משותפים ומסכי לקוח ראשונים
- פרק 9. שאר מסכי הלקוח, המחסן והמנהל
- פרק העבודה. איך עובדים על הקוד

## פרק הדפוסים. הדפוסים שחוזרים בכל הקוד

### איך להשתמש בפרק הזה

שאר הפרקים כותבים `דפוס P3` ומתארים רק את מה ששונה. כאן כל דפוס מוסבר פעם אחת, על קובץ אמיתי אחד. לכל דפוס יש קטע קוד עם נתיב ושורות, טבלה שמפרקת אותו לבלוקים, וריאציות שתפגוש בקבצים אחרים, מלכודות, ורשימת בדיקה קצרה למי שכותב קובץ חדש. קרא את P1 עד P4 לפני פרקי ה API, את P5 ו P6 לפני פרק הנתונים, את P7 לפני ה worker, את P8 ו P9 לפני ה SPA, ואת P10 ו P11 לפני הבדיקות וה adapters. כשהקוד סותר הערה שכתובה בו, הטקסט כאן מתאר את הקוד.

### P1. קובץ מודול של Nest

**דוגמה.** `apps/api/src/modules/pay/pay.module.ts`, שורות 1 עד 35. מודול גלובלי עם provider מותאם.

```ts
import { Global, Module } from '@nestjs/common';
import { BILLING_PORT } from '../../shared/billing/billing.port';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { WalletRequestService } from './wallet-request.service';
import { CheckoutService } from './checkout.service';
import { ChargebackService } from './chargeback.service';
import { PayController } from './pay.controller';
import { WalletRequestController } from './wallet-request.controller';

/**
 * PAY module (finance). Global because the ledger/wallet/billing primitives are
 * used by MKT, SHP, DIS. Crucially it provides BILLING_PORT via the REAL
 * BillingService — replacing the Phase-4 no-op adapter without touching callers.
 */
@Global()
@Module({
  controllers: [PayController, WalletRequestController],
  providers: [
    CheckoutService,
    ChargebackService,
    LedgerService,
    WalletService,
    BillingService,
    TopupService,
    WithdrawalService,
    WalletRequestService,
    { provide: BILLING_PORT, useExisting: BillingService },
  ],
  exports: [LedgerService, WalletService, WalletRequestService, BILLING_PORT],
})
export class PayModule {}
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 1 עד 12 | ייבוא של ה decorators, של הטוקן `BILLING_PORT` ושל כל המחלקות של המודול. | ייבוא לבד לא רושם כלום ב DI. מחלקה עם `@Injectable` שלא מופיעה ב `providers` לא קיימת בעיני Nest. |
| 19 | `@Global()` חושף את כל מה שב `exports` לכל מודול באפליקציה, בלי `imports`. | עשרה מודולים גלובליים, DB, SEC, NOT, PRC, PAY, CST, MEM, MED, Shared ו Adapters. לכן `MktModule` מזריק `LedgerService` בלי לייבא את `PayModule`. |
| 21 | `controllers` רושם בקרים. Nest בונה מהם routes תחת הקידומת `api/v1` שנקבעת ב `main.ts`. | בקר שלא רשום כאן פשוט לא חשוף, בלי שגיאה. |
| 22 עד 32 | `providers` רושם שירותים. כל אחד הוא singleton לכל האפליקציה. שורה 31 היא provider מותאם, `useExisting` נותן לטוקן `BILLING_PORT` את אותו מופע של `BillingService`. | `useExisting` הוא כינוי ולא מופע שני. `useClass` היה יוצר מופע נפרד עם state נפרד. מי שמזריק `@Inject(BILLING_PORT)` לא יודע מי מאחוריו. |
| 33 | `exports` קובע מה מודולים אחרים רואים. | שירות שלא מיוצא זמין רק בתוך PAY, גם כשהמודול גלובלי. `TopupService` ו `WithdrawalService` פנימיים. |

**וריאציות שתפגוש.**
- מודול תכונה רגיל, `esc.module.ts` ו `mkt.module.ts`. רק `controllers` ו `providers`, בלי `imports`, כי כל התלויות מגיעות ממודולים גלובליים.
- טוקן `Symbol` עם `useFactory`, ב `db/db.module.ts` עבור `DRIZZLE` וב `shared/adapters/adapters.module.ts`. המפעל רץ פעם אחת באתחול, דפוס P11.
- `app.module.ts` מחבר את כל המודולים. סדר ה `imports` לא משפיע על DI. מה שמשפיע הוא סדר ה `APP_GUARD` בשורות 98 עד 100, דפוס P2.
- `shared/billing/billing.port.ts` מגדיר `BillingModule` עם adapter ריק. אף אחד לא מייבא אותו, ו PAY מספק את הטוקן האמיתי. זה קוד מת.

**מלכודות.**
- כי הכל גלובלי, אין גבול בין מודולים. כל שירות יכול להזריק כל שירות מיוצא, והכלל שמודול נוגע רק בטבלאות שלו לא נאכף בשום מקום.
- טוקן שהוא `Symbol` מחייב `@Inject(TOKEN)` בבנאי. הזרקה לפי interface לא עובדת, כי interface נמחק בקומפילציה.
- `DRIZZLE` הוא מופע אחד על Pool אחד. כל השירותים חולקים אותו pool, ושירות שמחזיק חיבור בטרנזקציה ארוכה גוזל ממנו.

**תיעוד.** [Nest modules](https://docs.nestjs.com/modules), [custom providers](https://docs.nestjs.com/fundamentals/custom-providers).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- רשום כל שירות ב `providers` וייצא רק מה שמודול אחר צריך.
- הוסף `@Global()` רק לגרעין שכמה מודולים צריכים, כמו custody או ledger.
- תלות שאינה מחלקה מקבלת טוקן `Symbol` ו `useFactory` או `useExisting`.
- הוסף את המודול ל `imports` ב `app.module.ts`, אחרת הבקרים שלו לא קיימים.

### P2. בקר, guards ו decorators

**דוגמה.** `apps/api/src/modules/pay/wallet-request.controller.ts`, שורות 83 עד 112, ושרשרת ה guards ב `apps/api/src/app.module.ts`, שורות 98 עד 101.

```ts
  @Get('finance/wallet-requests/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.detail(id, user);
  }

  @Post('finance/wallet-requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.requests.cancel(id, user, dto.reason);
  }

  /* ---- Review (admin only) ---- */

  @Roles('admin')
  @Get('admin/wallet-requests')
  queue(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: WalletRequestType,
    @Query('status') status?: WalletRequestStatus,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.requests.listForReview(user, { type, status, userId, from, to });
  }

  @Roles('admin')
  @Get('admin/wallet-requests/:id')
  reviewDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.detail(id, user);
  }
```

```ts
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
```

סדר הריצה של Nest לכל בקשה הוא middleware, guards לפי סדר הרישום, interceptors לפני ה handler, pipes, ה handler, interceptors אחריו, ולבסוף exception filters.

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| app.module 98 | `ThrottlerGuard` רץ ראשון וסופר בקשות לפי IP בשני דליים, `default` ו `auth`. | הוא לפני ה session כדי שהצפה תידחה בלי לגעת בטבלת sessions. ב `@nestjs/throttler` 6.5 כל throttler עם שם רץ על כל route שלא סומן `@SkipThrottle`, ואין כזה בריפו. לכן דלי `auth`, ברירת מחדל 30 לדקה, חל על כל ה API ולא רק על login. |
| app.module 99 | `SessionAuthGuard` קורא את ה cookie, טוען משתמש ל `req.user`, חוסם `suspended` ו `closed`, ומוותר על חובת משתמש ב route עם `@Public()`. | משתמש מושעה נחסם גם ב route ציבורי, חוץ מ route עם `@AllowSuspended()`. |
| app.module 100 | `RolesGuard` קורא `@Roles` מה method או מהמחלקה ובודק ש `user.role` ברשימה. | `getAllAndOverride` אומר ש `@Roles` על method מחליף את זה של המחלקה ולא מצטרף אליו. אין היררכיה, admin לא עובר route של `warehouse_operator` אם לא נכתב במפורש. |
| app.module 101 | `AuditInterceptor` כותב `audit_record` אחרי handler מוצלח של POST, PUT, PATCH או DELETE. | רץ רק אחרי הצלחה, מחוץ לטרנזקציה של השירות, ובולע כל שגיאה ב `.catch(() => undefined)`. ההערה בקוד אומרת שהכשל נרשם ללוג, וזה לא נכון. בקשה שנכשלה לא משאירה עקבות. |
| 83 עד 86 | GET של בקשה אחת. `@Param('id')` מחזיר מחרוזת גולמית. | אין `ParseUUIDPipe`. id שאינו uuid מגיע ל Postgres, וה `AllExceptionsFilter` הופך את שגיאת 22P02 ל 400. |
| 88 עד 91 | POST עם `@Body() dto: CancelDto`. ה `ValidationPipe` הגלובלי מאמת ומסנן את הגוף לפי הקלאס, דפוס P4. | `@CurrentUser()` זורק 401 כשאין `req.user`. הבקר לא בודק בעלות, השירות בודק. |
| 95 עד 106 | תור הסקירה, `@Roles('admin')`, עם חמישה `@Query`. | query strings לא עוברים ולידציה. `WalletRequestType` הוא רק cast של TypeScript, וכל מחרוזת מגיעה לשירות. |
| 108 עד 112 | אותה מתודת `detail` של השירות דרך route של אדמין. | השירות מקבל את `user` ומחליט לפי התפקיד, כך שמתודה אחת משרתת שני routes. |

**וריאציות שתפגוש.**
- `@Roles` על המחלקה, `inv.controller.ts` שורה 111. כל route יורש אותו. 57 מופעים כותבים `@Roles('warehouse_operator', 'admin')`, 15 כותבים `@Roles('admin')`.
- `@Public()` על routes פתוחים, `mkt.controller.ts` שורות 42, 111 ו 122. `@Throttle(CREDENTIAL_ROUTE)` או `@Throttle(MAIL_ROUTE)` ב `auth.controller.ts` דורס את המגבלה של דלי `auth` ל route אחד.
- Idempotency, `mkt.controller.ts` שורות 143 עד 150. ה header `idempotency-key` עובר לשירות, ואם חסר נבנה key קבוע מהמשתמש וה listing. השירות קורא `IdempotencyService.lookup` לפני הטרנזקציה ו `save` אחריה, דפוס P3.
- אישור בשני שלבים, `listings/:id/remove` מנפיק טוקן דרך `ConfirmationService.issue` ו `listings/remove/confirm` צורך אותו ב `consume`.
- DTO בתוך קובץ הבקר, כאן שורות 23 עד 46, או בקובץ נפרד כמו `acc/acc.dto.ts`.

**מלכודות.**
- `ConfirmationService.consume` עושה SELECT ואז UPDATE בלי תנאי `consumed_at IS NULL`. שני אישורים מקבילים עם אותו טוקן עוברים שניהם.
- `IdempotencyService.lookup` מחפש לפי key ו endpoint בלבד, לא לפי משתמש.
- סדר routes. Express בודק לפי סדר ההגדרה, ולכן route מילולי כמו `listings/mine` חייב לבוא לפני `listings/:id`, אחרת `mine` נתפס כ id.
- E8, ה API מקבל גם גוף מקודד כטופס, כי Nest מפעיל את ה parser של urlencoded כברירת מחדל.

**תיעוד.** [request lifecycle](https://docs.nestjs.com/faq/request-lifecycle), [guards](https://docs.nestjs.com/guards), [interceptors](https://docs.nestjs.com/interceptors), [custom decorators](https://docs.nestjs.com/custom-decorators), [rate limiting](https://docs.nestjs.com/security/rate-limiting).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- החלט במפורש אם route ציבורי. כל route בלי `@Public()` דורש session.
- route של צוות מקבל `@Roles('warehouse_operator', 'admin')` עם שני התפקידים.
- גוף תמיד דרך קלאס DTO. query ו param מפורסרים ידנית עם ברירת מחדל בטוחה.
- פעולה שמזיזה כסף או בעלות מקבלת `idempotency-key` או אישור, והשירות נועל שורה.
- פעולה רגישה כותבת `audit.record(..., tx)` בתוך הטרנזקציה, כמו `wallet-request.service.ts`, ולא סומכת על ה interceptor.

### P3. מתודת שירות שמשנה מצב

**דוגמה.** `apps/api/src/modules/mkt/purchase.service.ts`, שורות 87 עד 98 ו 121 עד 148. הקובץ כולו 183 שורות, והטבלה מכסה את כל המתודה `purchase`.

```ts
    const result: PurchaseResult = await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).for('update').limit(1);
      if (!l) throw AppError.notFound('Listing not found');
      if (l.status !== 'active') {
        throw new AppError(ErrorCode.ITEM_NO_LONGER_AVAILABLE, 'Listing is no longer available', 409);
      }
      if (l.sellerId === buyerId) {
        throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot buy your own listing', 403);
      }

      const [it] = await tx.select().from(item).where(eq(item.id, l.itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');
```

```ts
      const buyerBalance = await this.ledger.balanceOf(buyerId, tx);
      if (buyerBalance.amount < price) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient wallet balance', 409);
      }

      // Money moves on the immutable ledger. Seller is credited gross then debited
      // the fee, so the ledger transparently shows gross + fee = net.
      await this.ledger.record(
        { userId: buyerId, type: 'purchase', amount: price, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      await this.ledger.record(
        { userId: l.sellerId, type: 'sale_credit', amount: price, direction: 'credit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      if (feeMinor > 0) {
        await this.ledger.record(
          { userId: l.sellerId, type: 'fee', amount: feeMinor, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
          tx,
        );
      }

      // Ownership moves; the item stays on its shelf (no physical movement) and
      // returns to `stored` under the new owner.
      await this.custody.transferOwnership(tx, l.itemId, buyerId, buyerId, `sale of listing ${listingId}`);
      await this.custody.changeState(tx, l.itemId, 'stored', buyerId, 'sold');

      await tx.update(listing).set({ status: 'sold', updatedAt: new Date() }).where(eq(listing.id, listingId));
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 52 עד 60 | הבנאי מזריק `DRIZZLE` דרך `@Inject` ואת השירותים הגלובליים לפי מחלקה. | דפוס P1. אין צורך ב `imports` במודול. |
| 71 עד 85 | בדיקת idempotency לפי key ו endpoint. תשובה שמורה חוזרת עם `replayed: true`. | נקראת מחוץ לטרנזקציה, ו `save` בשורה 180 רץ אחרי ה commit. שתי בקשות מקבילות עם אותו key נכנסות שתיהן. מה שמונע מכירה כפולה הוא הנעילה בשורה 88. |
| 87 | `this.db.transaction(async (tx) => ...)`. Drizzle לוקח חיבור אחד מה pool, שולח BEGIN, ועושה COMMIT כשה callback מסתיים או ROLLBACK כשהוא זורק. | כל שאילתה בתוך ה callback חייבת לעבור דרך `tx`. שאילתה דרך `this.db` רצה על חיבור אחר, מחוץ לטרנזקציה, ויכולה לחכות לנעילה שה tx עצמו מחזיק עד timeout. |
| 88 עד 95 | נועל את ה listing ב `.for('update')`, ורק אז בודק קיום, `active` ושהקונה אינו המוכר. | ב READ COMMITTED, ברירת המחדל, קונה שני נחסם על ה SELECT עד ה commit של הראשון ואז קורא את השורה המעודכנת ורואה `sold`. בדיקה לפני הנעילה בודקת מצב ישן. |
| 97 עד 99 | נועל את ה item ובודק `holdFlag`. | לא בודק ש `it.ownerId` שווה ל `l.sellerId`. פריט שעבר בעלים בדרך אחרת יימכר מהבעלים החדש, חלק מ E4. |
| 101 עד 118 | מחיר, עמלה מ `pricing.price(..., tx)`, והנחת מנוי מ `memberships.waive`. | ה snapshot של המחיר נשמר בעסקה, ושינוי מחירון אחר כך לא משנה היסטוריה. `tx as Database` הוא cast, כי הטיפוס של tx ב Drizzle שונה מזה של db. |
| 121 עד 124 | בודק יתרה ב `ledger.balanceOf(buyerId, tx)`. | `balanceOf` הוא SUM בלי נעילה. הנעילה היא על ה listing ולא על הארנק של הקונה. שתי קניות של אותו קונה ברשימות שונות רואות אותה יתרה ושתיהן עוברות, E1. |
| 128 עד 141 | שלוש שורות ledger, חיוב קונה, זיכוי מוכר וחיוב עמלה. | `record` מקבל `tx` אופציונלי. בלי `tx` השורה נכתבת על חיבור אחר ולא מתגלגלת אחורה. `ledger_record` היא append only, ותיקון הוא שורה נגדית. |
| 145 עד 146 | `custody.transferOwnership` ו `changeState`. כל אחד נועל את ה item שוב, מעדכן אותו ומוסיף `custody_event`. | `transferOwnership` לא מקבל בעלים צפוי ולא משווה ל `current.ownerId`, E4. אסור לעדכן `ownerId`, `binId` או `lifecycleState` ישירות, רק דרך `CustodyService`. |
| 148 עד 168 | מסמן את ה listing `sold` ומכניס `transaction` עם `frozenPricing` וקוד `TXN-`. | `updatedAt` מוצב ידנית, Drizzle לא מעדכן אותו לבד, דפוס P5. |
| 170 עד 175 | `outbox.emit(tx, ...)` מכניס `outbox_message` באותה טרנזקציה. ה worker שולח אותו אחר כך, דפוס P7. | אירוע שנכתב מחוץ ל tx יכול לצאת על פעולה שהתגלגלה, או להיעלם על פעולה שהצליחה. |
| 177 עד 181 | מחזיר תוצאה, ואחרי ה commit שומר אותה ל idempotency. | `save` עושה `onConflictDoNothing`, כך שהבקשה השנייה עם אותו key לא נכשלת. |

שגיאות עסקיות הן `AppError` עם `ErrorCode` וסטטוס, מ `shared/errors/app-error.ts`. זריקה בתוך ה callback מגלגלת את כל הטרנזקציה, ו `AllExceptionsFilter` הופך אותה ל `{ error: { code, message, details } }`.

**וריאציות שתפגוש.**
- הגרסה הנכונה של הדפוס, `wallet-request.service.ts` שורות 345 עד 365. טעינה בתוך ה tx עם `.for('update')`, בדיקת מעבר סטטוס אחרי הנעילה, ו `audit.record(..., tx)` בשורה 555 באותה טרנזקציה.
- אתר של E18, `shipment.service.ts` המתודה `pay` בשורות 921 עד 970. `loadFor`, בדיקת סטטוס ובדיקת יתרה רצים לפני `db.transaction`, וה UPDATE הוא לפי `id` בלבד. תשלום כפול או תשלום על משלוח שה worker כבר ביטל אפשריים. אותו מבנה ב `escrow.service.ts` ב `fund` וב `human-fulfilment.service.ts` ב `acceptQuote`.
- `CustodyService` מקבל `tx` כפרמטר ראשון בכל מתודה ולא פותח טרנזקציה משלו, כדי שהקורא ירכיב כמה פעולות ל commit אחד. `lockItem` בשורות 33 עד 43 הוא עזר הנעילה שלו.
- שירות קריאה בלבד, כמו `browse.service.ts`, עובד ישירות על `this.db` בלי טרנזקציה.

**מלכודות.**
- אין בריפו `pg_advisory_xact_lock` ואין SERIALIZABLE. `FOR UPDATE` על השורה העסקית לא מונע משתי פעולות על אובייקטים שונים לרוקן ארנק אחד, וזה השורש של E1 ו E18. התיקון הקטן הוא עזר שקורא ל `pg_advisory_xact_lock(hashtext(userId))` לפני כל בדיקת יתרה שאחריה חיוב, בכל השירותים.
- סדר הנעילות כאן הוא listing ואז item. זרימה אחרת שנועלת item ואז listing יכולה ליצור deadlock. Postgres הורג אחת מהן עם 40P01, וזה מגיע ללקוח כ 500.
- קריאה ל adapter חיצוני בתוך הטרנזקציה, כמו ה payout ב `wallet-request.service.ts`, מחזיקה נעילות בזמן רשת ולא מתגלגלת אחורה אם משהו אחריה נכשל.

**תיעוד.** [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [Postgres FOR UPDATE](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE), [Postgres isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [Nest exception filters](https://docs.nestjs.com/exception-filters).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- `db.transaction` אחד לפעולה, ו `tx` לכל קריאה בתוכה, כולל ledger, custody, outbox, audit ו pricing.
- טען את השורה העסקית בתוך ה tx עם `.for('update')`, ורק אז בדוק סטטוס ובעלים.
- לפני חיוב נעל את הארנק של המשלם, אחרת E1.
- בהעברת בעלות השווה בעצמך `ownerId` לבעלים הצפוי, עד ש `transferOwnership` יקבל אותו, E4.
- זרוק `AppError` עם `ErrorCode`, ואל תחזיר אובייקט שגיאה.

### P4. DTO ובדיקת קלט

**הקוד בפועל שונה מהתיאור בקובץ הסגנון.** ה API לא משתמש ב zod לגופי בקשות. הוא משתמש בקלאסים עם decorators של `class-validator`, ו `ValidationPipe` גלובלי ב `main.ts`. zod מופיע רק ב `packages/config/src/env.ts`, לולידציה של משתני סביבה.

**דוגמה.** `apps/api/src/modules/inv/inv.controller.ts`, שורות 77 עד 107.

```ts
class IntakeUnitsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IntakeItemDto)
  units!: IntakeItemDto[];
}

class CorrectionPatch {
  @IsString() field!: string;
  @IsString() value!: string;
}
class CorrectDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CorrectionPatch) patches!: CorrectionPatch[];
}

class OpenBatchDto {
  @IsOptional() @IsString() ownerUsername?: string;
  /** Legacy, accepted for pre-printed arrivals only. */
  @IsOptional() @IsString() ownerIntakeId?: string;
}
class SplitItemDto {
  @IsString() typeClass!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  @IsOptional() @IsString() binId?: string;
}
class SplitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SplitItemDto) items!: SplitItemDto[];
}
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| main.ts 130 עד 137 | `ValidationPipe` גלובלי עם `whitelist`, `forbidNonWhitelisted`, `transform` ו `exceptionFactory: validationException`. | `transform` הופך את הגוף למופע של הקלאס. `whitelist` מוריד שדה בלי decorator, ו `forbidNonWhitelisted` הופך אותו ל 400. אין `enableImplicitConversion`, ולכן `"5"` נכשל ב `@IsInt()`. |
| 77 עד 84 | מערך לא ריק של עד 50 יחידות, כל אחת מאומתת כ `IntakeItemDto`. | בלי `@Type(() => IntakeItemDto)` ה `class-transformer` לא יוצר מופעים, ו `@ValidateNested` לא מאמת את האיברים. השניים באים יחד תמיד. |
| 86 עד 92 | תיקון גנרי, `field` ו `value` כמחרוזות. | הולידציה לא יודעת אילו שדות מותרים. `CorrectionService` חייב לבדוק את `field` מול רשימה. |
| 94 עד 98 | שני שדות אופציונליים לזיהוי בעלים. | `@IsOptional` מדלג על כל הבדיקות כשהערך `undefined` או `null`. אין בדיקה שלפחות אחד הגיע, השירות בודק. |
| 99 עד 107 | פיצול פריט, מערך של `SplitItemDto`. | אין `ArrayNotEmpty` ואין `ArrayMaxSize`, כך שמערך ריק או ענק עובר. |
| `validation-error.ts` | `validationException` משטח את השגיאות, מתרגם שמות שדות ומחזיר `{ code: 'validation_failed', message, details: { violations } }`. | שם שדה חדש שנראה רע בהודעה נכנס למפה `FIELD_NAMES`. |

**וריאציות שתפגוש.**
- DTO בקובץ נפרד, `acc/acc.dto.ts`. שם `trimmed()` בשורות 18 עד 19 הוא `@Transform` שמסיר רווחים לפני הולידציה, כי ה transform רץ קודם.
- validator מותאם, `shp/country.validator.ts`, שבודק קוד מדינה מול `shippingCountries` מ `shp/countries.ts`.
- כלל שתלוי בשילוב שדות לא כתוב ב decorators. `wallet-request.controller.ts` שורות 18 עד 22 מפנה ל `validateWalletRequestDraft` ב `wallet-request.rules.ts`, שהשירות קורא לה. ל SPA יש עותק ידני, `validateDraft` ב `apps/web/src/shared/walletRequests.ts`, ושני העותקים חייבים להישאר זהים.
- query strings מפורסרים ידנית, `mkt.controller.ts` שורות 44 עד 65, עם `price()` שמחזיר `undefined` על ערך לא תקין ורשימת sort מותרת.
- משתני סביבה, `loadEnv()` מ `packages/config/src/env.ts` עם `z.object`, `z.coerce.number()` ו `booleanFromEnv`.

**מלכודות.**
- שדה חדש בלי decorator בכלל נדחה עם 400, כי `forbidNonWhitelisted` לא מכיר אותו.
- כסף הוא `@IsInt() @IsPositive()` ביחידות מינור. `@IsNumber()` היה מקבל שברים.
- `packages/contracts` ריק. הטיפוסים ב SPA כתובים ביד, ושינוי DTO לא שובר את הבנייה של ה web.
- אובייקט מקונן עם `@IsObject()` בלבד, בלי `@ValidateNested` ו `@Type`, עובר כמו שהוא, בלי ולידציה ובלי סינון של השדות שבתוכו.

**תיעוד.** [Nest validation](https://docs.nestjs.com/techniques/validation), [`class-validator`](https://github.com/typestack/class-validator), [`class-transformer`](https://github.com/typestack/class-transformer), [zod](https://zod.dev).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- כל שדה מקבל לפחות decorator אחד, גם שדה אופציונלי.
- מערך של אובייקטים, `@IsArray() @ArrayMaxSize(n) @ValidateNested({ each: true }) @Type(() => X)`.
- כסף `@IsInt() @IsPositive()`, ומחרוזת חופשית עם `@MaxLength`.
- כלל שתלוי בכמה שדות נכנס לקובץ `*.rules.ts` שהשירות קורא לו, ואם ה SPA אוכף אותו, עדכן גם את העותק ב `apps/web/src/shared`.

### P5. הגדרת טבלה ב Drizzle

**הקוד בפועל שונה מהתיאור בקובץ הסגנון.** הטבלאות לא יושבות תחת `apps/api/src/db`. כל מודול מגדיר את שלו בקובץ `modules/<mod>/<name>.schema.ts`. בתיקייה `db/schema` יש רק `_helpers.ts` עם בוני עמודות ו `index.ts` שמייצא מחדש את כל קבצי ה schema, שורות 9 עד 32.

**דוגמה.** `apps/api/src/modules/mkt/mkt.schema.ts`, שורות 1 עד 37.

```ts
import { pgEnum, pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * MKT tables: Listing, Transaction (final irreversible event), Offer (Phase 7),
 * Swap Proposal (Phase 8). Transactions snapshot the exact price/fee at execution
 * (frozen_pricing) so later pricing changes never alter history (Principle V).
 */
export const listingStatus = pgEnum('listing_status', ['active', 'sold', 'removed']);

export const listing = pgTable('listing', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  sellerId: text('seller_id').notNull(),
  askingPrice: amountMinor('asking_price').notNull(),
  currency: currency().notNull(),
  status: listingStatus('status').notNull().default('active'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
});

export const transactionType = pgEnum('transaction_type', ['sale', 'swap', 'transfer', 'consignment']);

export const transaction = pgTable('transaction', {
  id: pkId(),
  code: text('code'), // human-facing Transaction ID, TXN-XXXXXXXX (Requirement 9.4)
  type: transactionType('type').notNull(),
  itemIds: jsonb('item_ids').notNull(), // string[]
  buyerId: text('buyer_id'),
  sellerId: text('seller_id'),
  price: amountMinor('price'), // null for gift transfer
  fee: amountMinor('fee').notNull().default(0),
  frozenPricing: jsonb('frozen_pricing'), // exact rule/values applied
  currency: currency().notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 1 עד 2 | בוני עמודות מ `drizzle-orm/pg-core` ועזרים מ `_helpers.ts`. | העזרים מחזירים builder חדש בכל קריאה, כדי ששתי טבלאות לא יחלקו אובייקט. |
| 9 | `pgEnum` מגדיר טיפוס enum במסד וגם union בטיפוסים של TypeScript. | ערך חדש דורש migration עם `ALTER TYPE ... ADD VALUE`, דפוס P6. |
| 11 עד 20 | `listing`. `pkId()` הוא uuid עם `defaultRandom`, `amountMinor` הוא bigint במצב number, `currency` הוא char באורך 3. | `itemId` ו `sellerId` הם `text` בלי `.references()`. אין foreign key אחד בשום קובץ schema, והשלמות היא באחריות השירות. כמה FK קיימים רק ב SQL של 0013, 0014 ו 0016. |
| 18 עד 19 | `defaultNow()` על זמני יצירה ועדכון. | `defaultNow` פועל רק ב INSERT. כל UPDATE בקוד מציב `updatedAt: new Date()` בעצמו, ו `$onUpdate` של Drizzle לא בשימוש. |
| 22 עד 37 | `transaction`. `itemIds` ו `frozenPricing` הם jsonb. | jsonb חוזר כ `unknown`, ולכן הקוד עושה cast כמו `s.itemIds as string[]`. המבנה לא נבדק במסד. |

**וריאציות שתפגוש.**
- אינדקסים וייחודיות בארגומנט שלישי, `(t) => ({ ... })`, למשל `acc/acc.schema.ts` שורות 69 עד 73 עם `uniqueIndex`.
- טיפוס שורה נגזר מהטבלה, `typeof shipment.$inferSelect`, ב `shipment.service.ts`, `escrow.service.ts` ואחרים.
- `db/client.ts` מעביר את כל ה schema ל `drizzle(pool, { schema })`. אין `relations()` בריפו, ולכן כל השאילתות הן `select().from()` ולא `db.query` עם `with`.
- טבלאות היסטוריה, `ledger_record`, `custody_event`, `audit_record` ועוד שבע, מוגדרות כאן כרגיל. מה שהופך אותן ל append only הוא ה triggers ב `db/sql/0001_append_only.sql`, לא Drizzle.

**מלכודות.**
- ה schema של Drizzle אינו מקור האמת של המסד. ה migrations הם. CHECK, triggers, FK ואינדקסים חלקיים קיימים רק ב SQL, ושום דבר לא בודק שהשניים תואמים.
- קובץ schema חדש שלא נוסף ל `db/schema/index.ts` לא יופיע ב `drizzle-kit` ולא בטיפוס `Database`.
- `bigint` במצב number בטוח עד 2 בחזקת 53 יחידות מינור. סכומים בדולרים רחוקים מזה, אבל `SUM` במסד חוזר כמחרוזת, ולכן `balanceOf` עושה `::text` ו `Number(...)`.

**תיעוד.** [Drizzle schema](https://orm.drizzle.team/docs/sql-schema-declaration), [Postgres column types](https://orm.drizzle.team/docs/column-types/pg), [indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- טבלה חדשה בקובץ ה schema של המודול שלה, ושורת `export *` ב `db/schema/index.ts`.
- `pkId()`, `createdAt()`, `updatedAt()`, `amountMinor()` ו `currency()` מ `_helpers.ts`. כסף תמיד במינור עם מטבע.
- אותה טבלה בדיוק ב migration כתוב ביד, דפוס P6, עם אותם שמות עמודות ואינדקסים.
- כל UPDATE מציב `updatedAt: new Date()`.

### P6. קובץ migration והרצתו

**דוגמה.** `apps/api/src/db/migrations/0029_who_signed_in.sql`, שורות 13 עד 31, ו `apps/api/src/db/migrate.ts`, שורות 18 עד 31.

```sql
ALTER TABLE "login_session" ADD COLUMN IF NOT EXISTS "ip" text;--> statement-breakpoint
ALTER TABLE "login_session" ADD COLUMN IF NOT EXISTS "user_agent" text;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."login_attempt_outcome" AS ENUM ('success', 'bad_credentials', 'unverified', 'refused');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "login_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "user_id" text,
  "outcome" "login_attempt_outcome" NOT NULL,
  "ip" text,
  "user_agent" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "login_attempt_time_idx" ON "login_attempt" ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempt_user_idx" ON "login_attempt" ("user_id", "occurred_at");
```

```ts
async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DIRECT_DATABASE_URL });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: './src/db/migrations' });

  const appendOnlySql = readFileSync(join(__dirname, 'sql', '0001_append_only.sql'), 'utf8');
  await pool.query(appendOnlySql);

  await pool.end();
  // eslint-disable-next-line no-console
  console.log('✔ migrations applied and append-only guards installed');
}
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 0029, 1 עד 12 | הערה שמסבירה למה השינוי נדרש. | כל ה migrations מ 0004 והלאה כתובים ביד ומתחילים בהסבר כזה. |
| 0029, 13 עד 14 | `ADD COLUMN IF NOT EXISTS`. | כל משפט idempotent, כדי שהרצה על מסד שכבר יש בו חלק מהשינוי לא תיכשל. |
| 0029, 16 עד 18 | `CREATE TYPE` בתוך בלוק `DO` שתופס `duplicate_object`. | ל `CREATE TYPE` אין `IF NOT EXISTS`. |
| 0029, 20 עד 31 | טבלה ושני אינדקסים, תואמים להגדרה ב `acc/acc.schema.ts` שורות 141 עד 143. | `--> statement-breakpoint` הוא המפריד ש Drizzle מפצל לפיו את הקובץ למשפטים. קובץ בלי מפרידים נשלח כשאילתה אחת. |
| migrate 20 עד 21 | Pool על `DIRECT_DATABASE_URL`, לא דרך PgBouncer. | DDL צריך session אמיתי. |
| migrate 23 | `migrate` של Drizzle קורא את `migrations/meta/_journal.json` ומריץ לפי הסדר שלו את כל הקבצים החדשים, בטרנזקציה אחת להרצה כולה. | הוא משווה את `when` של כל רשומה ל `created_at` האחרון ב `drizzle.__drizzle_migrations`. רשומה עם `when` קטן מהאחרון שהורץ מדולגת בשקט. קובץ שלא רשום ב journal לא ירוץ לעולם. |
| migrate 25 עד 26 | מריץ את `sql/0001_append_only.sql` בכל הרצה, מחוץ ל journal. | הקובץ מתקין מחדש triggers נגד UPDATE ו DELETE ו REVOKE לתפקיד `bault_app`. הנתיב נבנה מ `__dirname`, ו E2 מתאר שה migrator המקומפל ב image לא מתקין אותם. |

**וריאציות שתפגוש.**
- `0000_natural_stryfe.sql` נוצר ב `drizzle-kit generate`, עם מפריד אחרי כל משפט ובלי `IF NOT EXISTS`.
- הוספת ערך ל enum, `0013` שורות 48 עד 54 ו `0014` שורה 48, עם `ADD VALUE IF NOT EXISTS` ולפעמים `BEFORE`.
- מילוי נתונים בתוך migration, `0008_item_class_backfill.sql`.
- אינדקסים בלבד, `0024_the_queries_that_run_on_every_request.sql`.
- CHECK שמוחלף בבטחה, `DROP CONSTRAINT IF EXISTS` ואז `ADD CONSTRAINT`, ב `0022` שורות 31 עד 33.

**מלכודות.**
- ה snapshots ב `migrations/meta` נעצרים ב 0003. `pnpm db:generate` ישווה את ה schema ל 0003 ויפיק migration שיוצר מחדש את כל מה שנוסף מאז. כותבים ביד ומוסיפים רשומה ל journal.
- כל ה migrations החדשים רצים בטרנזקציה אחת. ערך enum שנוסף ב migration אחד לא שמיש ב migration מאוחר יותר באותה הרצה, ו Postgres 16 נכשל עם `unsafe use of new value`.
- רשימת טבלאות ההיסטוריה מופיעה פעמיים ב `0001_append_only.sql`, בשורה 42 לטריגרים ובשורה 87 ל REVOKE. טבלה שנוספה רק לאחת מהן מוגנת חלקית.

**תיעוד.** [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [Postgres ALTER TYPE](https://www.postgresql.org/docs/16/sql-altertype.html).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- קובץ `00NN_<שם>.sql` ורשומה ב `_journal.json` עם `idx` הבא, `tag` כשם הקובץ ו `when` גדול מהאחרון.
- כל משפט idempotent, ו `--> statement-breakpoint` אחרי כל משפט.
- עדכן את קובץ ה schema של Drizzle באותו commit, דפוס P5.
- טבלת היסטוריה חדשה נכנסת לשתי הרשימות ב `0001_append_only.sql`.
- הרץ `pnpm --filter @bault/api db:migrate` פעמיים על מסד מקומי, כדי לוודא שהקובץ idempotent.

### P7. job של ה worker

**דוגמה.** `apps/worker/src/jobs/shipment-expiry.ts`, שורות 21 עד 60, והרישום ב `apps/worker/src/index.ts`, שורות 27 עד 71.

```ts
export async function expireUnpaidShipments(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: string;
      code: string | null;
      user_id: string;
      item_ids: unknown;
    }>(
      `SELECT id, code, user_id, item_ids
         FROM shipment
        WHERE status = 'awaiting_payment'
          AND payment_due_at IS NOT NULL
          AND payment_due_at <= now()
        FOR UPDATE`,
    );

    for (const row of rows) {
      await client.query(
        `UPDATE shipment
            SET status = 'cancelled',
                cancelled_at = now(),
                cancel_reason = 'Not paid within the holding period',
                payment_due_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [row.id],
      );

      const itemCount = Array.isArray(row.item_ids) ? row.item_ids.length : 0;
      await client.query(
        `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('shipment', $1, 'shipment_expired', $2::jsonb)`,
        [row.id, JSON.stringify({ userId: row.user_id, shipmentCode: row.code, itemCount })],
      );
    }

    await client.query('COMMIT');
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| index 29 עד 30 | Pool של `pg` ומופע `PgBoss`, שניהם על `DIRECT_DATABASE_URL`. | `pg-boss` צריך LISTEN ו advisory locks, ש PgBouncer במצב transaction לא מעביר. |
| index 37 | `boss.start()` יוצר את הסכמה של `pg-boss` ומפעיל את מנגנון ה cron. | |
| index 40 עד 61 | רשימת jobs, שם מ `registry.ts`, ביטוי cron ופונקציה שמקבלת את ה pool. | cron מחושב ב UTC, ברירת המחדל של `pg-boss`. הסדר בין jobs, למשל ריבית ב `03:00` ואז השעיה ב `03:15`, נשען רק על השעות. |
| index 63 עד 71 | לכל job, `createQueue`, `work` ו `schedule`. | בגרסה 10 התור חייב להתקיים לפני `schedule`. ה cron שולח job אחד לכל tick עם `singletonKey` לפי שם, כך שכמה workers לא יוצרים כפילות. ה handler מתעלם מתוכן ה job. שגיאה שנזרקת מסמנת אותו כנכשל, ו `retry_limit` במסד הוא 2 כברירת מחדל. |
| index 77 עד 81 | שגיאה באתחול הורגת את התהליך. | אין טיפול ב SIGTERM ואין `boss.stop()`, E15. |
| 22 עד 24 | חיבור ייעודי מה pool ו BEGIN. | טרנזקציה ב `pg` דורשת `client` אחד. `pool.query` שולח כל משפט לחיבור אחר, ו BEGIN שנשלח כך לא עוטף כלום. |
| 26 עד 38 | בוחר משלוחים שמועד התשלום שלהם עבר, `FOR UPDATE`. | הנעילה גורמת ל `ShipmentService.pay` ב API לחכות. אבל `pay` בדק סטטוס לפני הטרנזקציה שלו ומעדכן לפי `id` בלבד, ולכן אחרי ההמתנה הוא דורס את `cancelled` וגובה, E18. |
| 40 עד 58 | UPDATE ל `cancelled` ו INSERT ל `outbox_message` באותו client. | זה ה SQL שמקביל ל `ShipmentService.expireUnpaid` ב API, שורות 977 עד 1006, שאף אחד לא קורא לה. שתי הגרסאות כבר שונות, `cancel_reason` אחר, וה API לא מאפס `payment_due_at`. |
| 60 עד 69 | COMMIT, ROLLBACK בשגיאה ו `release` ב finally. | בלי `release` החיבור דולף, וה pool נתקע אחרי כמה הרצות. |

**וריאציות שתפגוש.**
- `tracking-refresh.ts` בלי טרנזקציה, עם `pool.query` ישיר ו `new SandboxShippingAdapter()` קבוע, E17.
- `storage-fee.ts` הוא CTE אחד גדול. הוא קורא `pricing_rule` עם WHERE משלו בשורות 66 עד 74 וכותב `charge` ו `ledger_record` ישירות. בחירת הכלל חייבת להתאים ל `PricingService`, והכיוון והסוג של שורות ה ledger ל `LedgerService`.
- `outbox-dispatch.ts` קורא שורות `outbox_message` שלא נשלחו והופך אותן להודעות.
- `ledger-invariant-check.ts` קורא בלבד ומדווח על סטייה בין יתרה ליומן.

**מלכודות.**
- ה worker לא מייבא שירותים מה API. כל כלל עסקי משוכפל כ SQL במחרוזת, ו TypeScript לא בודק שמות עמודות או ערכי enum. שינוי שם עמודה ב API נשבר ב worker רק בזמן ריצה.
- SQL גולמי עוקף את `CustodyService`. job ששינה `item` חייב לכתוב `custody_event` בעצמו, באותה טרנזקציה.
- הרצה שנמשכת יותר מהמרווח יכולה לחפוף להרצה הבאה ב worker אחר. רק `FOR UPDATE` מגן על זה, ול `tracking-refresh.ts` אין.

**תיעוד.** [`pg-boss`](https://github.com/timgit/pg-boss/tree/master/docs), [`node-postgres` transactions](https://node-postgres.com/features/transactions).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- פונקציה `async (pool: Pool)` בקובץ משלה, שם ב `registry.ts`, ושורה ברשימה ב `index.ts`.
- `pool.connect()`, BEGIN, COMMIT, ROLLBACK ב catch ו `release` ב finally.
- `FOR UPDATE` על השורות שאתה משנה, ותנאי המצב גם ב WHERE של ה UPDATE.
- שינוי ב item דרך `custody_event`, תנועת כסף דרך `ledger_record`, והודעה דרך `outbox_message`, הכל באותו client.
- מצא את הקוד המקביל ב API וודא שהכלל זהה, או מחק את העותק המת.

### P8. עמוד ב SPA

**דוגמה.** `apps/web/src/areas/warehouse/SupportQueue.tsx`, שורות 34 עד 73. אין בריפו ספריית ניתוב, ספריית שאילתות או ספריית i18n. הכל בנוי על hooks של React וקבצים ב `apps/web/src/shared`.

```tsx
export function SupportQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);

  const [rows, setRows] = useState<SupportQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<SupportQueueRow[]>('/support/queue'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function take(id: string) {
    try {
      await api.post(`/support/tickets/${id}/assign`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Panel title={t('supportQueue.title')} subtitle={t('supportQueue.subtitle')} flush>
        {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

        {rows === null ? (
          <SkeletonTable rows={4} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('supportQueue.empty')} text={t('supportQueue.emptyText')} icon={<IconAsk />} />
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 35 | `useI18n()` מחזיר `t`, `locale`, `setLocale` ו `toggleLocale` מתוך context של `I18nProvider`. | `t` מקבל רק `MessageKey`, שנגזר מהקטלוג העברי ב `i18n.tsx`. מפתח שלא קיים הוא שגיאת קומפילציה. |
| 36 עד 37 | `useRoute` ו `useNavigation` מ `shared/routing.ts`, נתב מבוסס hash שבנוי על `useSyncExternalStore`. | `openRecord` מוסיף param ל hash, וה drawer בשורות 136 עד 146 נפתח לפי `route.params.ticket`. רענון דף או קישור משותף פותחים את אותו drawer. |
| 39 עד 40 | state. `rows` מתחיל ב `null`. | משתנה אחד נושא שלושה מצבים, `null` טוען, מערך ריק, מערך מלא. אין `loading` נפרד. |
| 42 עד 50 | `load` עטוף ב `useCallback`, קורא `api.get`, ובשגיאה שומר את `message`. | ההודעה מגיעה מה API באנגלית גם בממשק עברי. `apiErrorKey` ב `api.ts` מתרגם רק חמישה סוגי שגיאה, ורוב העמודים לא משתמשים בו. |
| 52 עד 54 | `useEffect` שקורא ל `load` בהרכבה. | `StrictMode` ב `main.tsx` מריץ כל effect פעמיים בפיתוח, ולכן כל GET נשלח פעמיים. POST בתוך effect יישלח פעמיים. אין `AbortController`, ותשובה ישנה יכולה לדרוס חדשה. |
| 56 עד 63 | פעולה, POST ואז טעינה מחדש. | אין `busy`, ולחיצה כפולה שולחת שתי בקשות. |
| 65 עד 73 | רינדור. `ErrorState` עם כפתור נסה שוב, `SkeletonTable` בזמן טעינה, `EmptyState` כשאין שורות. | אלה רכיבי P9 מ `shared/ui/primitives.tsx`. |

`shared/api.ts` שורות 91 עד 121 הוא הלקוח היחיד. הוא שולח `credentials: 'include'` כדי שה cookie של ה session יעבור, ממזג headers מעל `Content-Type: application/json`, ובשגיאה מפרק את המעטפה `{ error: { code, message } }` ל `ApiError` עם `kind`, `status` ו `code`. כשל רשת הופך ל `kind: 'unreachable'` עם סטטוס 0.

**וריאציות שתפגוש.**
- טופס, `areas/customer/vault/CustomRequestForm.tsx`. state לכל שדה, `busy` ו `error`, בדיקה מקומית שמשקפת את המינימום של ה API, ו `Button` עם `loading={busy}` ו `disabled`. התוצאה עולה להורה ב `onDone` ו `onError`.
- hook משותף לטעינה, `useNotificationFeed` ב `shared/hooks.ts` שורות 52 עד 88, עם `loading` ו `error` נפרדים.
- קבצי תחום ב `shared`, כמו `support.ts` ו `walletRequests.ts`, מחזיקים טיפוסי תשובה, תוויות וצבעי סטטוס.
- רישום עמוד, `App.tsx` שורות 542 עד 555 מרנדר לפי `section`, עם בדיקת `isStaff` או `isAdmin`. עמוד חדש צריך שם section, מפתחות כותרת ותפריט, וכניסה ב rail.
- קטלוג התרגום, `he` מוגדר `as const` ו `MessageKey = keyof typeof he` בשורה 2325. `en` בשורה 2327 הוא `Record<MessageKey, string>`, ולכן תרגום חסר שובר את הבנייה. משתנים נכתבים `{name}` ומוחלפים ב `t(key, vars)`.

**מלכודות.**
- `api.get<T>` הוא cast בלבד. אין בדיקה בזמן ריצה, ו `packages/contracts` ריק. שינוי צורת תשובה ב API לא נתפס בקומפילציה של ה web.
- בדיקת תפקיד ב `App.tsx` היא חוויית משתמש בלבד. ההגנה היא `@Roles` בשרת.
- `api.post` מקבל headers בפרמטר שלישי. פעולת כסף שלא שולחת `idempotency-key` נשענת על ה key הקבוע שהשרת בונה, אם בכלל.

**תיעוד.** [useEffect](https://react.dev/reference/react/useEffect), [StrictMode](https://react.dev/reference/react/StrictMode), [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore), [useCallback](https://react.dev/reference/react/useCallback).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- טען דרך `api.get` בתוך `useCallback` ו `useEffect`, עם `null` כמצב טעינה.
- הצג שלד טעינה, `ErrorState` עם retry ו `EmptyState`.
- כל טקסט דרך `t('...')`, ומפתח חדש בשני הקטלוגים ב `i18n.tsx`.
- כפתור שליחה עם `loading={busy}`, ו `disabled` לפי אותם כללים שה API בודק.
- פעולה שמזיזה כסף שולחת `idempotency-key` ב `api.post`.

### P9. רכיב UI בסיסי

**דוגמה.** `apps/web/src/shared/ui/primitives.tsx`, שורות 118 עד 156, גוף הרכיב `Field`. הקובץ מכיל את כל הרכיבים הבסיסיים, `Button`, `Field`, `MoneyField`, `Panel`, `StatusBadge`, `EmptyState`, `ErrorState`, שלדי טעינה, `MetricCard`, `ContextTabs` ו `DetailRow`.

```tsx
  const generated = useId();
  const id = htmlFor ?? generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /**
   * When the id is ours, put it on the control — otherwise the label points at
   * nothing and the whole exercise is decoration. `describedBy` goes on with it,
   * so the hint is announced as a DESCRIPTION rather than becoming part of the
   * field's name, which is the bug this component exists to fix.
   *
   * Only a single element child can be given an id; anything else (a fragment, a
   * group of radios) is left alone and should pass `htmlFor` itself.
   */
  const control =
    htmlFor === undefined && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children.props as { id?: string }).id ?? id,
          'aria-describedby':
            (children.props as { 'aria-describedby'?: string })['aria-describedby'] ?? describedBy,
        })
      : children;

  return (
    <div className={`field ${className}`.trim()} data-describes={describedBy}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {control}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| 90 עד 117 | props, `label`, `hint`, `error`, `htmlFor` אופציונלי ו `children`. | הרכיב מקבל טקסט מוכן. אין בו `useI18n`, והתרגום הוא של הקורא. |
| 118 עד 120 | `useId` מייצר id ייחודי למופע, אלא אם הועבר `htmlFor`. `describedBy` מצביע על השגיאה או על הרמז. | `useId` יציב בין רינדורים ושונה בין מופעים, ולכן `Field` בתוך רשימה לא משכפל id. |
| 131 עד 138 | `cloneElement` מוסיף לילד `id` ו `aria-describedby`, רק כשאין `htmlFor` והילד הוא אלמנט אחד. | ערך שהילד כבר נתן מנצח, בגלל `??`. fragment או קבוצת radio לא מקבלים id, והתווית לא מצביעה על כלום עד שמעבירים `htmlFor`. |
| 140 עד 155 | `label` עם `htmlFor`, הפקד, ואז שגיאה עם `role="alert"` או רמז. | ההערה בשורות 86 עד 88 אומרת שהשגיאה מציבה `aria-invalid`. הקוד לא עושה את זה. הקורא מעביר `aria-invalid` בעצמו, כמו ב `CustomRequestForm.tsx`. |
| 25 עד 69 | `Button`. variant ו size הופכים ל class, `loading` מציג spinner, מוסיף `aria-busy` ומנטרל את הכפתור. | `type` ברירת מחדל `button`. בתוך `<form onSubmit>` לחיצה או Enter לא שולחים טופס עד שמעבירים `type="submit"`. |

**וריאציות שתפגוש.**
- `MoneyField` בשורה 182, שדה סכום עם סימן מטבע, `dir="ltr"` ו `inputMode="decimal"`.
- `StatusBadge` עם `StatusTone`, שבע גוונים. קבצי התחום ב `shared` ממפים סטטוס לגוון, כמו `TICKET_TONE`.
- רכיבים גדולים בקבצים נפרדים באותה תיקייה, `DetailDrawer.tsx`, `PageHeader.tsx`, `NavigationRail.tsx`, `ErrorBoundary.tsx`, ואייקונים ב `icons.tsx`.

**מלכודות.**
- העיצוב הוא classes גלובליים ב `index.css`, בלי CSS modules. שינוי שם class כמו `field-error` שובר כל מסך שמשתמש בו.
- ה CSS כתוב עם properties לוגיים, ו `dir` על `<html>` מתחלף ב `I18nProvider`. `margin-left` במקום `margin-inline-start` נראה נכון באנגלית ושבור בעברית.
- `tests/ux/design-system.test.tsx` נועל את ההתנהגות של הרכיבים. שינוי שמשבר אותו כנראה שובר נגישות.

**תיעוד.** [useId](https://react.dev/reference/react/useId), [cloneElement](https://react.dev/reference/react/cloneElement).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- רכיב שחוזר בכמה מסכים נכנס ל `primitives.tsx`, ורכיב של מסך אחד נשאר בקובץ המסך.
- הרכיב מקבל טקסט מתורגם ב props ולא קורא ל `useI18n`.
- label מקושר ב `htmlFor`, שגיאה עם `role="alert"`, טעינה עם `aria-busy`.
- classes ב `index.css` עם properties לוגיים בלבד.
- בדיקת רינדור ב `tests/ux`.

### P10. בדיקת אינטגרציה

**הקוד בפועל שונה מהתיאור בקובץ הסגנון בפרט אחד.** הבדיקות לא מרימות את Nest בתוך התהליך ולא נוגעות במסד ישירות. הן שולחות HTTP אמיתי עם `fetch` ל API שכבר רץ, על מסד שעבר `db:seed`.

**דוגמה.** `tests/integration/mkt-purchase.test.ts`, שורות 7 עד 35, והעזרים ב `tests/integration/helpers/http.ts`.

```ts
describe('MKT direct purchase', () => {
  it('purchases atomically: buyer debited, seller credited net fee, ownership moved', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });

    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 20000 })).body;

    const buyer = await signIn(SEED.collector2);
    await fundWallet(SEED.collector2, 50000);
    const before = (await buyer.get('/finance/wallet')).body.amount as number;

    const res = await buyer.post(`/marketplace/listings/${listing.id}/purchase`);
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(20000);

    // Buyer debited exactly the price.
    const after = (await buyer.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBe(20000);

    // Ownership moved: item now appears in the buyer's vault.
    const buyerVault = (await buyer.get('/vault/items')).body as { id: string }[];
    expect(buyerVault.some((i) => i.id === item.id)).toBe(true);

    // The sale is a recorded transaction with a TXN- id (Requirements 13.1 / 9.4).
    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { id: string; type: string }[];
    expect(txns.some((t) => t.id === res.body.transactionId && t.type === 'sale')).toBe(true);
  });
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| http.ts 8 | `BASE` מ `API_URL` או `http://localhost:3000/api/v1`. | אין `beforeAll` שמרים שרת. API שלא רץ נותן כשל רשת בבדיקה הראשונה. |
| http.ts 10 עד 38 | `Client` ששולח JSON ושומר cookie אחד, הזוג הראשון מה `set-cookie` האחרון שהתקבל. | cookie נוסף באותה כותרת הולך לאיבוד. לכל משתמש `Client` משלו. |
| http.ts 60 עד 82 | `SEED` ו `SEED_USERNAME`, החשבונות שיוצר `apps/api/src/db/seed.ts`, עם סיסמה אחת. | שינוי ב seed שובר את כל הקבצים. |
| 9 עד 10 | `signIn` של המפעיל ו `intakeFor`, שמכניס פריט חדש דרך `/intake/items` למדף הראשון. | כל בדיקה יוצרת נתונים חדשים דרך ה API ולא תלויה בפריטים קיימים. |
| 12 עד 13 | המוכר יוצר listing. | אין כאן בדיקת status. אם היצירה נכשלה, הבדיקה נופלת מאוחר יותר עם הודעה מבלבלת. |
| 15 עד 17 | `fundWallet` עובר בזרימה האמיתית, בקשת `cash_in`, אישור והשלמה של אדמין. | הארנק של `golden` גדל בכל ריצה, ולכן הבדיקה מודדת הפרש ולא ערך מוחלט. |
| 19 עד 34 | רכישה, הפרש יתרה, הפריט בכספת של הקונה והעסקה ברשימה של האדמין. | שלוש ראיות נפרדות, כסף, בעלות ורשומה. |
| 37 עד 46 | קנייה מעצמך מחזירה 403 ו `body.error.code` שווה `self_dealing_forbidden`. | בודקים גם את הקוד במעטפה, לא רק את הסטטוס. |

`vitest.workspace.ts` מגדיר פרויקטים, `integration`, `concurrency`, `property`, `contract`, `core`, `core-contract`, `web` ו `ux`. ההערה בו מסבירה ש `fileParallelism: false` לא נאכף ב Vitest 2 בתוך workspace. מה שאוכף ריצה סדרתית הוא `--no-file-parallelism` בסקריפטים ב `package.json`, ו `pnpm test` מריץ את הפרויקטים אחד אחרי השני דרך `scripts/test.mjs`.

**וריאציות שתפגוש.**
- `tests/concurrency/no-double-sale.test.ts`, שני קונים עם `Promise.all`. בדיקת עשן, אין בה שום דבר שמכריח חפיפה, והיא לא יכולה לתפוס את E1.
- `tests/contract`, מופע של adapter ישירות, בלי מסד ובלי API, דפוס P11.
- `tests/ux`, סביבת jsdom עם `setupFiles: ['./tests/ux/setup.ts']` שמוסיף matchers של `jest-dom`, מנקה DOM וקובע locale אנגלי. הקבצים עושים `vi.mock` ל `apps/web/src/shared/api` ואז `await import` של הרכיב, ועוטפים ב `I18nProvider`.
- `tests/web`, פונקציות טהורות של ה SPA בסביבת node.
- `tests3`, בדיקות מהצד הלא נכון, תוקף או לקוח ששולח זבל, באותו מבנה של `Client`.

**מלכודות.**
- E16. הבדיקות תלויות במצב המסד ובסדר הריצה. ריצה מקבילה של שני פרויקטים על אותו מסד נותנת כשלים שנראים כמו באגים.
- רכישה בלי header חוזרת עם key קבוע של משתמש ו listing, כך שבדיקה שקונה פעמיים את אותו listing מקבלת replay ולא 409.
- `fundWallet` מסרב לחשבון האדמין, כי אדמין לא מאשר בקשה של עצמו.

**תיעוד.** [Vitest workspace](https://v2.vitest.dev/guide/workspace), [vi.mock](https://v2.vitest.dev/api/vi.html#vi-mock), [Testing Library React](https://testing-library.com/docs/react-testing-library/intro).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- קובץ `tests/integration/<module>-<flow>.test.ts` שמשתמש רק בעזרים מ `helpers/http.ts`.
- צור נתונים דרך ה API עם `intakeFor`, `fundWallet` ו `fixtureEmail` לחשבון חדש.
- מדוד הפרשים ולא ערכים מוחלטים, ובדוק גם `status` וגם `body.error.code`.
- הרץ `pnpm test:integration` מול API רץ ומסד אחרי `db:seed`.

### P11. adapter לספק חיצוני

**דוגמה.** `packages/adapters/src/payment.ts`, שורות 55 עד 72, והבחירה ב `apps/api/src/shared/adapters/adapters.module.ts`, שורות 84 עד 105.

```ts
export interface PaymentAdapter {
  /** A name for logs and for the "is this real money" banner. */
  readonly providerName: string;
  /** False when the adapter is pointed at a provider's test environment. */
  readonly handlesRealMoney: boolean;

  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  /**
   * Authenticate a webhook delivery and return the parsed event.
   *
   * ASYNC and takes the whole delivery, because real verification is a network
   * call against the provider using several headers — not a string compare. It
   * MUST throw rather than return on a delivery it cannot authenticate.
   */
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent>;
}
```

```ts
function createPaymentAdapter(): PaymentAdapter {
  const env = loadEnv();

  if (env.PAYMENT_PROVIDER === 'paypal') {
    return new PayPalPaymentAdapter({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      environment: env.PAYPAL_ENVIRONMENT,
      webhookId: env.PAYPAL_WEBHOOK_ID,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'PAYMENT_PROVIDER=sandbox is refused in production. It settles every charge without ' +
        'contacting a provider, so a top-up with any token would credit real store credit. Use ' +
        'PAYMENT_PROVIDER=paypal with PAYPAL_ENVIRONMENT=sandbox to test with fake money against ' +
        'the real integration.',
    );
  }
  return new SandboxPaymentAdapter();
}
```

| שורות | מה זה עושה | למה ככה |
|---|---|---|
| payment.ts 12 עד 53 | טיפוסי הבקשה והתשובה, `ChargeRequest` עם `idempotencyKey`, ו `ProviderResult` עם `status` שהוא `succeeded`, `pending` או `failed`. | הליבה תלויה רק בטיפוסים האלה ולא ב SDK של ספק. |
| payment.ts 55 עד 72 | ה interface. שם, דגל כסף אמיתי, שלוש פעולות כסף ואימות webhook. | `verifyWebhook` חייב לזרוק על משלוח שלא אומת, ולא להחזיר אירוע ריק. |
| payment.ts 361 עד 388 | `SandboxPaymentAdapter`. כל פעולה מצליחה מיד, ו `providerRef` נגזר מ `idempotencyKey`. | מאשר הכל ולא מאמת כלום. `handlesRealMoney = false` כדי שהממשק יוכל להגיד את זה. |
| adapters.module 84 עד 105 | בחירה לפי `PAYMENT_PROVIDER`. ב production ה sandbox נדחה בשגיאה באתחול. | הבחירה קורית פעם אחת, כשה provider נבנה. שינוי משתנה סביבה דורש restart. |
| adapters.module 187 עד 197 | מודול `@Global` עם ארבעה טוקנים, `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` ו `STORAGE_ADAPTER`. | שירות מזריק `@Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter`, דפוס P1. |

**וריאציות שתפגוש.**
- `storage.ts` הוא הדפוס בצורה המינימלית, interface של שתי מתודות ו sandbox שלא שומר כלום. המימוש האמיתי ב `s3.ts`.
- `shipping.ts` מחזיק interface ו sandbox שממציא תעריפים, והמימוש האמיתי ב `easypost.ts`.
- `email.ts` עם `ConsoleEmailAdapter` ו `SmtpEmailAdapter`. כאן אין חסימה ב production. `EMAIL_PROVIDER` שאינו `smtp` שולח מיילים ל stdout בשקט.
- ה worker לא עובר דרך המפעל. `outbox-dispatch.ts` בוחר adapter של מייל בעצמו, ו `tracking-refresh.ts` יוצר `SandboxShippingAdapter` קבוע, E17.
- `packages/adapters` הוא חבילת workspace בשם `@bault/adapters` שנבנית ל `dist`. בבדיקות `vitest.workspace.ts` מפנה את השם ישירות ל `src`.

**מלכודות.**
- E3. אין בשום מקום יצירה של הזמנת PayPal, ולכן טעינה מיידית של ארנק לא עובדת גם עם המימוש האמיתי.
- בדיקות החוזה ב `tests/contract/payment-adapter.test.ts` בודקות רק את ה sandbox. שום בדיקה לא מוכיחה שהמימוש האמיתי מקיים את אותו חוזה.
- קריאה לספק היא תופעת לוואי שלא מתגלגלת. קריאה בתוך `db.transaction` שאחריה משהו נכשל משאירה כסף שזז אצל הספק בלי שורת ledger. תשובה `pending` שמטופלת כהצלחה משאירה מצב שאף קוד לא מעדכן אחר כך.

**תיעוד.** [Nest factory providers](https://docs.nestjs.com/fundamentals/custom-providers#factory-providers-usefactory).

**אם אתה כותב קובץ חדש מהסוג הזה.**
- interface ו sandbox באותו קובץ ב `packages/adapters/src`, מימוש אמיתי בקובץ משלו, ו `export *` ב `index.ts`.
- טוקן `Symbol` ומפעל ב `adapters.module.ts` שזורק ב production כשנבחר sandbox.
- דגל כמו `handlesRealMoney`, כדי שהממשק יוכל להראות שזה לא אמיתי.
- בדיקת חוזה ב `tests/contract` שרצה גם על המימוש האמיתי, לפחות מול סביבת הבדיקה של הספק.
- קריאה לספק מחוץ לטרנזקציה, או תכנון מפורש של מה קורה כשהטרנזקציה מתגלגלת אחרי שהספק כבר ביצע.

## פרק 1. שלד הריפו, החבילות המשותפות, הסקריפטים, התשתית וה CI

### סקירה

השלד של הריפו. אין כאן לוגיקה עסקית, אבל כל דבר אחר נשען עליו. Bault הוא monorepo של pnpm, שלושה יישומים תחת `apps/` ושלוש חבילות תחת `packages/`. `apps/api` ו `apps/worker` תלויים ב `@bault/config` וב `@bault/adapters` דרך `workspace:*`. החבילות נפתרות דרך `dist/`, שלא בגיט, ולכן כל מקום שמריץ קוד בונה אותן קודם, ה CI וה Dockerfile. הבדיקות לבדן עוקפות את זה ב alias אל `src`. `@bault/contracts` ריקה ואיש לא תלוי בה.

סדר קריאה. קבצי השורש, אחר כך `packages/config/src/env.ts`, המקום היחיד שבו הסביבה נטענת ומאומתת. אחר כך ה adapters, כל המגע עם תשלום, משלוח, דואר ואחסון. אחר כך הסקריפטים, התשתית המקומית, ה Dockerfile, nginx וה CI. קבצי כלי ה AI בסוף, כי הם לא רצים אף פעם.

```mermaid
flowchart LR
  C[packages/config] --> API[apps/api]
  A[packages/adapters] --> API
  C --> W[apps/worker]
  A --> W
  WEB[apps/web nginx] -->|proxy /api| API
  T[tests contract] -->|alias ל src| A
```

#### `package.json`
המניפסט של השורש. אין בו קוד מוצר, רק זהות, סקריפטים שמתזמרים את היישומים וכלי פיתוח משותפים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 9 | `private`, `packageManager: pnpm@9.15.0`, ו `engines.node` של `^22.22.2 \|\| >=24.15.0` בגלל jsdom 30 | בלי `engine-strict` זו אזהרה בלבד, ולכן שלושת ה Dockerfile רצים על Node 20. שינוי `packageManager` מחייב שינוי `corepack prepare pnpm@9` בשלושתם |
| 10 עד 15 | `dev` מריץ את `scripts/dev.mjs`, `dev:api`, `dev:worker`, `dev:web` הם `pnpm --filter`, `tunnel` מריץ את `scripts/tunnel.mjs` | `pnpm dev` לא מרים את ה worker |
| 16 עד 21 | `build` רקורסיבי, `lint` על כל הריפו, `format` עם prettier, `users:remove-test`, `db:reset`, `typecheck` | `db:reset` הוא ה seed של ה API, שמוחק הכל ב TRUNCATE. אין `format:check`, אף אחד לא אוכף פורמט |
| 22 עד 32 | `test` מריץ את `scripts/test.mjs`. `test:seeded` מוסיף migrate ו seed. סקריפט לכל פרויקט vitest | `--no-file-parallelism` בסקריפטים של `integration`, `concurrency`, `property`, `core` הוא מה שבאמת אוכף ריצה סדרתית. `test:all-parallel` הוא בדיוק מה שאסור |
| 34 עד 46 | devDependencies, vitest 2, jsdom, testing library, eslint, prettier, typescript | אין כאן React, `pg` או `@bault/adapters`, ולכן ה aliases ב `vitest.workspace.ts` והכשל של `remove-test-users.mjs` |

**שים לב.** `test`, `test:seeded`, `db:reset` ו `users:remove-test` פועלים על כל מסד שה `.env` מצביע עליו, בלי שום בדיקת `NODE_ENV`.

#### קבצי תצורה בשורש

| קובץ | מה הוא עושה |
|---|---|
| `pnpm-workspace.yaml` | מכריז ש `apps/*` ו `packages/*` הם חבילות. חבילה חדשה מחייבת `COPY` של המניפסט שלה בכל אחד משלושת ה Dockerfile, אחרת `--frozen-lockfile` נכשל |
| `.npmrc` | `link-workspace-packages`, `auto-install-peers` ו `strict-peer-dependencies=false`. ההערה שטוענת שהאחרון שומר על עץ קפדני הפוכה לאמת. אין `shamefully-hoist`, ולכן `tests/` ו `scripts/` רואים רק תלויות שורש. הוספת `engine-strict=true` תשבור מיד את שלושת ה Dockerfile |
| `pnpm-lock.yaml` | קובץ נעילה של 6910 שורות, לא נערך ביד. `--frozen-lockfile` ב CI וב Docker נכשל אם אינו תואם ל `package.json` |
| `tsconfig.base.json` | ES2022, `declaration`, `strict` ו `noUncheckedIndexedAccess`, שבגללו כל גישה לפי אינדקס היא אולי `undefined`, מכאן שרשראות `?.` ב adapters. `exactOptionalPropertyTypes` כבוי במכוון, והדלקתו תשבור עשרות מקומות. שלוש החבילות דורסות `isolatedModules` ל `false` |
| `eslint.config.mjs` | flat config מינימלי בלי type aware linting. `any` ומשתנים לא בשימוש הם אזהרה בלבד, `*.config.*` לא נבדקים, ו CI מריץ בלי `--max-warnings 0` |
| `.prettierrc.json` | גרש בודד, רוחב 100, LF. רץ רק דרך `pnpm format` |
| `.editorconfig` | `utf-8`, LF, שני רווחים. עץ העבודה היה CRLF ב Windows, ולכן `design-lint.mjs` ממיר |
| `.gitignore` | מסתיר `dist/`, `node_modules/`, `.env` ו `.env.*` חוץ מ `.env.example`, `.playwright-cli/` ו `_local/`. חסר `backups/`, ראה `infra/ops/backup.sh` |

#### `.env.example`
התבנית שמפתח מעתיק ל `.env` בשורש. שום קוד לא קורא אותה. המקור הקובע הוא הסכמה ב `packages/config/src/env.ts`, והפערים ביניהן הם מלכודות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 7 עד 17 | `NODE_ENV=development`, `API_PORT=3000`, `VITE_API_PROXY_TARGET` מוער | ההסבר על `127.0.0.1` במקום `localhost` נכון, Node 17 ומעלה פותר קודם ל `::1` |
| 19 עד 22 | `DATABASE_URL` ל PgBouncer בפורט 6432, `DIRECT_DATABASE_URL` ל Postgres בפורט 5432, `bault:bault` | אותה סיסמה כמו ב compose, ב `userlist.txt` וב CI |
| 24 עד 26 | `SESSION_COOKIE_SECRET` עם ערך חלש | חובה בסכמה, אבל אף קוד ב `apps/` לא קורא אותו. מי שיחבר אותו לחתימה בעתיד יניח שהוא סודי |
| 28 עד 42 | `STORAGE_PROVIDER=sandbox` וחמישה ערכי MinIO עם `minioadmin`, ושלוש פקודות ליצירת bucket | `STORAGE_REGION=eu-central` אינו אזור AWS תקני. MinIO מקבל אותו, ספק אמיתי ידחה את החתימה |
| 44 עד 49 | שארית שבורה של כותרות תשלום, משפט שנקטע באמצע | אפשר למחוק. התשלום האמיתי בשורות 168 עד 196 |
| 50 עד 64 | `SHIPPING_PROVIDER=sandbox`, `EASYPOST_*` ריקים | הכותרת עוד מזכירה ShipStation ו Easyship שלא מומשו |
| 66 עד 110 | `EMAIL_PROVIDER=console`, מדריך Gmail app password, `APP_BASE_URL` | `EMAIL_API_KEY` לא נקרא. שורה 96 מבטיחה ששני המצבים מוצפנים, וזה לא נכון בפורט 587 בלי `requireTLS` |
| 112 עד 130 | ימי חסד, ריבית ורף השעיה של חוב ארנק | זהים לברירות המחדל בסכמה |
| 132 עד 166 | פרטי בנק ותמיכה ריקים, `SENTRY_DSN`, `LOG_LEVEL` | `SENTRY_DSN` לא נקרא ואין תלות Sentry |
| 168 עד 196 | `PAYMENT_PROVIDER=paypal` עם `PAYPAL_ENVIRONMENT=sandbox` וערכים ריקים | העתקה כמו שהיא נכשלת באתחול עד שממלאים או עוברים ל `sandbox`. `PAYPAL_PAYOUT_NOTE` לא נקרא |
| 198 עד 221 | `CORS_ORIGINS`, rate limits, `EXPOSE_API_DOCS=true`, `TRUST_PROXY=loopback` | `AUTH_RATE_LIMIT_PER_MINUTE=10` בזמן שהסכמה כבר עברה ל 30. `EXPOSE_API_DOCS=true` אחרי הערה שאומרת שהוא כבוי, וה API מאזין על כל הממשקים |

**שים לב.** משתנה חובה חדש בסכמה בלי ברירת מחדל ובלי שורה כאן יתקע כל מפתח חדש באתחול. ה CI לא מושפע, הוא מגדיר את הסביבה בעצמו.

#### `vitest.workspace.ts`
מגדיר את שמונת פרויקטי הבדיקה. הבדיקות חיות בשורש, ב `tests/` וב `tests3/`, ולכן הקובץ בשורש.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 27 | `ADAPTERS_SRC` בשורה 14 מפנה את `@bault/adapters` אל `packages/adapters/src/index.ts`. `WEB_MODULES` בשורה 27 מפנה אל `apps/web/node_modules` | נדרש כי השורש לא מצהיר על החבילות האלה. כך `contract` ו `core-contract` רצים בלי build ובלי מסד |
| 29 עד 55 | הערה כללית על ריצה סדרתית | מדברת על ארבע חבילות, בקובץ יש שמונה. התיישנה |
| 57 עד 80 | `integration` עם `fileParallelism: false` | לא עובד ברמת פרויקט ב Vitest 2, וההערה מודה בזה. האכיפה היא הדגל בסקריפטים |
| 81 עד 86 | `concurrency`, `property`, `contract` | `contract` מקבל את ה alias |
| 87 עד 111 | `core` ו `core-contract` על `tests3/` | `core` צריך API ומסד, `core-contract` לא |
| 112 | `web` בסביבת `node` | פונקציות טהורות של ה SPA |
| 113 עד 148 | `ux` עם jsdom, `jsx: 'automatic'`, setup ו `globals`, ושישה aliases ל React בשורות 133 עד 138 | הסדר קובע. `react-dom/client` לפני `react-dom`, `react/jsx-runtime` לפני `react`. שדרוג React שמשנה את מבנה `node_modules` ישבור את `ux` בשקט |

**שים לב.** שמות הפרויקטים כתובים ביד גם ב `package.json`, ב `scripts/test.mjs` וב `.github/workflows/ci.yml`. פרויקט חדש או שם חדש מחייב את שלושתם.

#### `packages/config`

| קובץ | מה הוא עושה |
|---|---|
| `packages/config/package.json` | המניפסט של `@bault/config`, CommonJS, `main` על `dist/`, תלויות `dotenv` ו `zod` |
| `packages/config/tsconfig.json` | פלט CommonJS מ `src` ל `dist`. הקבצים המקבילים בשתי החבילות האחרות זהים בתוכן |
| `packages/config/src/index.ts` | barrel שמייצא את `loadEnv` ואת הטיפוס `Env` |

#### `packages/config/src/env.ts`
מה נחשב קונפיגורציה תקינה. כל משתנה סביבה מוצהר פעם אחת בסכמת zod, הכל מאומת באתחול, ושרת עם קונפיגורציה שגויה לא עולה ומדפיס את כל הבעיות בבת אחת. נקרא מ `app.module.ts`, `adapters.module.ts`, `migrate.ts`, `drizzle.config.ts`, ה worker ועוד כעשרה קבצי API.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 25 | `loadDotenvFromRoot` עולה מ `process.cwd()` עד שש רמות ועוצר ב `.env` הראשון | `dotenv` לא דורס משתנה קיים, ולכן shell, CI ו `docker run -e` תמיד מנצחים. יש side effect על `process.env` הגלובלי |
| 34 עד 40 | `booleanFromEnv` מחזיר `true` רק ל `true`, `1`, `yes`, `on` | נדרש כי `Boolean('false')` הוא `true`. משמש רק ל `SMTP_SECURE` |
| 53 עד 63 | `NODE_ENV`, `API_PORT`, שני ה URL של המסד, `SESSION_COOKIE_SECRET` עם `min(16)`, `SESSION_COOKIE_NAME` | `NODE_ENV=staging` מכשיל אתחול. הסוד חובה ולא נקרא |
| 79 עד 84 | `STORAGE_PROVIDER` ברירת מחדל `sandbox`, `STORAGE_ENDPOINT` URL חובה, ארבעה `STORAGE_*` | ה endpoint חובה גם ב sandbox. מחרוזת ריקה בשאר עוברת, והבדיקה המותנית תופסת |
| 101 עד 117 | `PAYMENT_PROVIDER` בלי ברירת מחדל, `PAYPAL_ENVIRONMENT`, שלושת ערכי PayPal, `PAYPAL_PAYOUT_NOTE` | ההערה בשורות 97 עד 99 מסבירה שהוסרה ברירת מחדל `stripe`. `PAYPAL_PAYOUT_NOTE` לא בשימוש |
| 127 עד 162 | `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE` 300, `AUTH_RATE_LIMIT_PER_MINUTE` 30, `EXPOSE_API_DOCS`, `API_DOCS_PASSWORD`, `TRUST_PROXY` עם `refine` | שורה 145 משתמשת ב `z.coerce.boolean()`, ולכן `false`, `0` ו `no` מדליקים את ה explorer, וזה E7. ה `refine` חוסם רק את המחרוזת `true`, לא `0.0.0.0/0` ולא מספר hops גבוה. ברירת המחדל `loopback` שגויה מאחורי nginx במכולה נפרדת, וזה E14 |
| 179 עד 228 | משלוח, `EASYPOST_*`, דואר, `SMTP_*`, `APP_BASE_URL` | `SMTP_PASSWORD` בשורות 215 עד 219 מוחק כל רווח, לטובת Gmail app passwords. `EMAIL_API_KEY` לא נקרא |
| 239 עד 286 | מדיניות חוב, פרטי בנק ותמיכה, `SENTRY_DSN`, `LOG_LEVEL` | `WALLET_SUSPEND_BELOW_MINOR` אי חיובי, ברירת מחדל `-2000` |
| 287 עד 331 | `superRefine` עם `require` פנימי בשורות 288 עד 296 שמוסיף שגיאה עם `path` מדויק. easypost מחייב מפתח בשורות 301 עד 303, s3 מחייב חמישה `STORAGE_*` בשורות 305 עד 315, smtp מחייב host, user, password ו from בשורות 317 עד 321, paypal מחייב שלושה ערכים בשורות 326 עד 330 | ההערה בשורות 298 עד 300 על SMTP זזה מעל בדיקת EasyPost. השם `require` מסתיר את זה של CommonJS |
| 333 עד 412 | רק כש `NODE_ENV=production`. אחסון sandbox בשורות 344 עד 352, משלוח sandbox בשורות 363 עד 372, דואר console בשורות 383 עד 391, תשלום sandbox בשורות 393 עד 402, ו explorer בלי סיסמה בשורות 405 עד 411 | אין בדיקה ש `PAYPAL_ENVIRONMENT=live`, שמפתח EasyPost חי, ש `APP_BASE_URL` אינו localhost, או על `TRUST_PROXY`. אותה חסימה קיימת גם ב `adapters.module.ts`, אבל ה worker עוקף אותה, E17 |
| 415 עד 418 | `Env` הוא `z.infer` של הסכמה אחרי transform, ו `cached` ברמת המודול | `SMTP_SECURE` הוא `boolean` ו `API_PORT` הוא `number` בטיפוס |
| 424 עד 438 | `loadEnv` מחזיר את ה cache אם קיים, אחרת טוען dotenv, מריץ `safeParse` על `source`, זורק `Error` עם כל הבעיות, ומקפיא את התוצאה | אחרי הקריאה הראשונה הפרמטר `source` מתעלם, ובדיקה שמעבירה סביבה אחרת תקבל בשקט את הישנה. dotenv משנה את `process.env`, ולכן `source` שהוא עותק לא יראה את ערכי הקובץ. `Object.freeze` רדוד, מספיק כי הכל פרימיטיבי |

**שים לב.** שינוי ברירת מחדל כאן משפיע בבת אחת על ה API, ה worker, `migrate.ts` ו `drizzle.config.ts`. משתנה חדש עובר ארבע תחנות, שדה בסכמה עם ברירת מחדל אם אפשר, שורה ב `.env.example`, שורה ב `env:` של `ci.yml` אם הוא חובה, ובדיקה ב `superRefine` או בבלוק ה production אם הוא תלוי בספק או מסוכן בייצור. ה worker מאמת את כל הסכמה, ולכן מקבל חובה גם על משתנים שהוא לא צריך, כמו `STORAGE_ENDPOINT`.

#### `packages/contracts`

| קובץ | מה הוא עושה |
|---|---|
| `packages/contracts/package.json` | מניפסט של `@bault/contracts`. אף יישום לא תלוי בה, אבל שלושת ה Dockerfile מעתיקים אותו |
| `packages/contracts/tsconfig.json` | זהה ל `packages/config/tsconfig.json` |
| `packages/contracts/src/index.ts` | placeholder עם `export {}` בלבד. הטיפוסים מ `openapi.yaml` שהובטחו במשימות T021 ו T137 לא נוצרו. מחיקה מחייבת `pnpm install` והסרת שורת `COPY` מכל Dockerfile |

#### `packages/adapters`
החבילה לא קוראת משתני סביבה. כל קונפיגורציה מגיעה דרך הבנאים, מ `apps/api/src/shared/adapters/adapters.module.ts` ומה worker. כל adapter אמיתי כתוב עם `fetch` או `node:crypto` ביד, בלי SDK. זה קריא, אבל אין timeout ואין retry באף קריאה, ו `fetch` של Node ממתין עד 300 שניות לכותרות.

ההבדל מהדפוס הכללי של P11 הוא שהבחירה בין sandbox לאמיתי לא נעשית בחבילה. היא נעשית ב factories של `adapters.module.ts`, דואר בשורות 40 עד 49, תשלום בשורות 84 עד 105, משלוח בשורות 128 עד 141, אחסון בשורות 164 עד 185, וכל factory זורק על sandbox ב production. ה worker בונה דואר בעצמו ב `outbox-dispatch.ts` שורות 57 עד 71, ומשלוח בלי factory בכלל. ספק חדש דורש מחלקה כאן, שורה ב `index.ts`, ענף ב factory, ערך ב enum של הסכמה עם בדיקה ב `superRefine`, ובדיקת חוזה תחת `tests/contract/`.

| קובץ | מה הוא עושה |
|---|---|
| `packages/adapters/package.json` | מניפסט של `@bault/adapters`. תלות ריצה אחת, `nodemailer`, בלי SDK של PayPal, EasyPost או S3 |
| `packages/adapters/tsconfig.json` | זהה ל `packages/config/tsconfig.json` |
| `packages/adapters/src/index.ts` | barrel עם `export *` לששת הקבצים. adapter חדש חייב שורה כאן. שם מיוצא כפול בשני קבצים ישבור את ה build, ולכן `toMinor` לא מיוצא באף אחד |

#### `packages/adapters/src/payment.ts`
דפוס P11, הממשק, `SandboxPaymentAdapter` ו `PayPalPaymentAdapter` באותו קובץ. זה הקובץ היחיד שמזיז כסף אמיתי. נבנה ב `adapters.module.ts` ונצרך בארבעת השירותים של `apps/api/src/modules/pay/`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 72 | `ChargeRequest`, `ProviderResult` עם `settledAmountMinor` ו `settledCurrency`, `WebhookEvent`, `WebhookDelivery` עם גוף גולמי ו headers, הממשק עם `providerName`, `handlesRealMoney` וארבע מתודות | החוזה בשורות 31 עד 38, הקורא חייב להשוות את הסכום שנסלק לסכום שביקש. `verifyWebhook` חייב לזרוק ולא להחזיר ריק |
| 78 עד 101 | `PayPalConfig`, `PAYPAL_BASE` לשתי כתובות, `toDecimal` ו `toMinor` | מניחים שתי ספרות עשרוניות. במטבע כמו JPY ייצא סכום שגוי פי מאה. היום הכל USD |
| 130 עד 152 | בנאי. זורק בלי `clientId`, `clientSecret` או `webhookId`. `handlesRealMoney` רק ב `live`. `fetchImpl` להזרקה | השכבה השלישית של אותה בדיקה אחרי `env.ts` ו `adapters.module.ts` |
| 161 עד 185 | `accessToken`, client credentials, cache עד דקה לפני תפוגה | אין ניקוי cache על `401`. token שבוטל מוקדם מפיל הכל עד שה cache פג |
| 187 עד 204 | `call`, Bearer, `PayPal-Request-Id` מ `idempotencyKey` בשורה 196, זורק עם סטטוס ועד 400 תווים מהגוף | retry עם אותו מפתח לא מבצע פעמיים. אין timeout. JSON שבור זורק `SyntaxError` בלי הקשר |
| 213 עד 243 | `capture` של order שהמשלם אישר. זורק בלי מזהה order, שולח `POST /v2/checkout/orders/{id}/capture` עם `encodeURIComponent`, שורה 234 לוקחת את ה capture הראשון, שורה 237 קובעת סטטוס, ומחזיר מזהה capture וסכום שנסלק | הסטטוס נקבע לפי `body.status` של ה order ולא של ה capture, ולכן capture ב `PENDING` עלול לזכות ארנק מיד. order בלי captures מחזיר `succeeded` בלי סכום, והקורא לא בודק סכום חסר. אין כאן יצירת order בכלל, חלק מ E3. התיקון הוא לבדוק `capture.status` ולהחזיר `pending` כשאין capture. `checkout.service.ts` כבר רושם `pending` בלי לזכות, אבל בלי webhook שעובד הכסף ייתקע |
| 245 עד 251 | `createCharge` ו `createTopup` קוראות ל `capture` | אין הבדל ב PayPal |
| 260 עד 295 | `createPayout` לכתובת דואר. `sender_batch_id`, `sender_item_id` ו `PayPal-Request-Id` כולם המפתח | `SUCCESS` הוא `succeeded`, `DENIED` הוא `failed`, השאר `pending`, כלומר כמעט תמיד `pending`. ה webhook שאמור לסגור אותו לא עושה כלום ב `topup.service.ts`. גישה ל `batch_header` בלי `?.` |
| 306 עד 345 | `verifyWebhook`. `h` בשורות 307 עד 311 מחפש כותרת וזורק אם חסרה. שורות 313 עד 318 מפענחות את הגוף. שורות 320 עד 334 שולחות חמש כותרות שידור, מזהה webhook ואירוע ל `verify-webhook-signature`, ושורות 336 עד 338 זורקות על תשובה שאינה `SUCCESS` | אין סוד משותף, PayPal חותם בתעודה מתחלפת ולכן האימות עובר דרך ה API שלו. אירוע בלי מזהה מקבל `id` ריק בשורה 341. האירוע נשלח אחרי `JSON.parse` ו `stringify` ולא כגוף המקורי, ועלול לדחות webhook אמיתי. אין בדיקת `transmission_time`, ה replay נחסם לפי `event.id` אצל הקורא |
| 361 עד 388 | `SandboxPaymentAdapter`, הכל `succeeded` מיד, `providerRef` נגזר מה `idempotencyKey`, והסכום שנסלק הוא בדיוק הסכום שביקשו. `verifyWebhook` מפענח בלי אימות, ו `JSON.parse` לא עטוף | כל שרת עם `NODE_ENV` שאינו `production` מאשר כל טעינת ארנק |

**שים לב.** שינוי שדות `ProviderResult` שובר את ארבעת שירותי PAY ואת `tests3/contract/paypal-adapter.test.ts` ו `tests/contract/payment-adapter.test.ts`. הוספת timeout בטוחה רק כל עוד הקורא שומר מפתח idempotency יציב בין ניסיונות.

#### `packages/adapters/src/shipping.ts`
דפוס P11, הממשק ו sandbox. המימוש האמיתי ב `easypost.ts`. הקובץ הוא גם ספריית חישוב המשקל של כל המערכת, ו `apps/api/src/modules/shp/carriers.ts` מייבא ממנו קבועים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 33 | `ShipAddress`, רק `country` ו `postalCode` חובה | רחוב ועיר נבדקים בזמן ריצה ב EasyPost ולא בטיפוס |
| 41 עד 70 | `DEFAULT_PACKAGING_GRAMS` 120, `DIM_DIVISOR` 167, המרות פיזיקליות | 167 ולא 139 בכוונה, כדי להתאים לשירות הייחוס. שינוי משנה בבת אחת את ה sandbox, את `carriers.ts` ואת `tests/contract/shipping-adapter.test.ts` |
| 87 עד 107 | `BillingIncrement` ו `billableGrams`, הגדול מבין משקל בפועל לנפחי, ואז עיגול למעלה לאונקיה או פאונד, לפחות יחידה אחת | `continuous` לא מעגל. הסדר, קודם max ואז עיגול, נכון |
| 117 עד 121 | `dimensionalGrams` ממיר סנטימטרים מעוקבים לגרמים דרך אינצים ופאונדים | אפס בלי מידות |
| 123 עד 191 | `RateRequest`, `Rate` עם `providerShipmentId` ו `providerRateId`, `LabelResult`, `TrackingStatus` בארבעה ערכים, הממשק עם שלוש מתודות | המזהים קיימים כי EasyPost מוכר תעריף לפי מזהה ולא לפי שם |
| 197 עד 252 | `SANDBOX_SERVICES`, שבעה שירותים במחירים מומצאים, ו `distanceMultiplier` לפי מדינה בלבד | שמות השירותים חייבים להתאים ל `carriers.ts`, כי `shipment.service.ts` מחפש תעריף לפי שם |
| 254 עד 294 | `getRates` סוכם משקל עם `Math.max(0, ...)` נגד משקל שלילי, מוסיף אריזה ומשקל נפחי, מסנן לפי בינלאומיות ורשימה רצויה. מחיר קבוע מקבל רק תוספת חתימה, אחרת בסיס ועוד מחיר לקילו, כפול מכפיל המרחק, מעוגל. ממיין לפי מחיר | `rush` לא משנה ימים, זה זמן עיבוד במחסן |
| 296 עד 307 | `buyLabel` עם מספר `SBX` לפי שניות, `getTracking` תמיד `in_transit` | שתי תוויות באותה שנייה מקבלות אותו מספר. `labelObjectKey` לא קיים באחסון |

**שים לב.** `apps/worker/src/jobs/tracking-refresh.ts` בונה את `SandboxShippingAdapter` ישירות בכל סביבה, ולכן בייצור שום משלוח לא מגיע ל `delivered`. זה E17. כנראה נכון להפסיק לייצא את המחלקה ולהזריק ל worker את ה adapter האמיתי.

#### `packages/adapters/src/easypost.ts`
דפוס P11, המימוש האמיתי של `ShippingAdapter` מול EasyPost. נבנה ב `adapters.module.ts` כש `SHIPPING_PROVIDER=easypost`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 38 עד 47 | `TEST_HOST`, `gramsToOunces` עם מינימום 0.1, `cmToInches`, `toMinor` | `TEST_HOST` היא הכתובת היחידה של EasyPost גם ל live. המצב נקבע לפי קידומת המפתח |
| 56 עד 73 | טיפוסי התשובה | `messages` לא נקרא, ולכן כשאין תעריפים הסיבה נזרקת |
| 75 עד 86 | בנאי זורק בלי מפתח, `isTestMode` לפי `EZTK` | אף קוד מחוץ לקובץ לא קורא ל `isTestMode` |
| 93 עד 118 | `call`, Basic auth עם המפתח, מחלץ `error.message`, זורק עם סטטוס ונתיב | הודעת השגיאה עלולה להכיל כתובת לקוח. אין timeout ואין retry |
| 128 עד 154 | `address` ממפה לשדות EasyPost וזורק בלי רחוב או עיר | נכון, תמחור לפי מיקוד היה משתנה בזמן הקנייה |
| 164 עד 216 | `getRates` סוכם משקל, מוסיף אריזה וממיר לאונקיות, מוסיף מידות אם ידועות, ושולח `POST /shipments`. חתימה מבוקשת כבר בתמחור, שורות 183 עד 185. שורות 193 עד 202 מסננות לפי `req.services` בלי תלות באותיות. כל תעריף ממופה ל `Rate` עם מזהי ספק, וימים חסרים הופכים ל 0 | כל הצעת מחיר יוצרת shipment חדש בחשבון EasyPost. `shipment.service.ts` מחפש התאמה מדויקת לשמות ב `carriers.ts`, כמו `Priority Mail`, ו EasyPost מחזיר `GroundAdvantage` או `FEDEX_2_DAY`. סביר שהלקוח יקבל רשימה ריקה. לא נבדק מול EasyPost אמיתי |
| 225 עד 255 | `buyLabel` לפי מזהי shipment ו rate, זורק בלי `tracking_code` | אין idempotency. `labelObjectKey` מקבל URL של EasyPost ולא מפתח אחסון, ו `getSignedUrl` עליו ייתן URL שבור |
| 266 עד 283 | `getTracking` דרך `POST /trackers`, סטטוס לא מוכר הופך ל `unknown` | אף קוד לא קורא לה היום, ה worker משתמש ב sandbox |

#### `packages/adapters/src/email.ts`
דפוס P11 עם `ConsoleEmailAdapter` במקום sandbox ו `SmtpEmailAdapter` דרך nodemailer, ובנוסף מנוע תבניות. נבנה ב `adapters.module.ts` וב `apps/worker/src/jobs/outbox-dispatch.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 6 עד 31 | `EmailMessage` עם שם תבנית ומשתנים, הממשק, `RenderedEmail` | |
| 34 עד 40 | `escapeHtml` לארבעה תווים, `&` ראשון | גרש בודד לא מקודד, וזה בסדר כי התכונות בגרשיים כפולים |
| 50 עד 69 | `actionEmail` בונה טקסט ו HTML עם כפתור, כל ערך מקודד כולל `href` | סכמת הקישור לא נבדקת, `javascript:` יעבור. היום הקישורים נבנים מ `APP_BASE_URL` |
| 78 עד 122 | `renderEmail` עם `email_verification`, `password_reset`, `notification_event` | תבנית לא מוכרת לא זורקת, היא מדפיסה את כל המשתנים ב `<pre>` ללקוח. שם תבנית הוא מחרוזת אצל הקוראים, ושינויו שובר אותם בשקט. כל הדואר באנגלית |
| 129 עד 135 | `ConsoleEmailAdapter` מדפיס ל stdout כולל קישור עם token | חסום ב production דרך `env.ts` |
| 137 עד 188 | `SmtpConfig`, ובשורות 166 עד 173 transport עם host, port, `secure` ו auth בלבד, בלי `verify()` כדי שה API יעלה גם כששרת הדואר למטה. `send` מרנדר, שולח עם `from` מהקונפיגורציה ומחזיר `messageId` | אין `requireTLS`, ולכן בפורט 587 תוקף יכול להסיר STARTTLS והסיסמה נשלחת גלויה. אין timeouts מפורשים, וברירות המחדל של nodemailer הן דקות. אין `pool`, כל הודעה פותחת חיבור. חריגה מ `sendMail` עוברת לקורא, ב API ל `verification.service.ts` וב worker למנגנון ה outbox. הוספת `requireTLS: !config.secure` היא התיקון |

#### `packages/adapters/src/storage.ts`
דפוס P11, הממשק ו sandbox. שורות 6 עד 16 הן `PutObjectRequest` והממשק עם `putObject` ו `getSignedUrl`. שורות 19 עד 25 הן `SandboxStorageAdapter`, שלא שומר כלום ומחזיר URL לא חתום של `localhost:9000`. אין `deleteObject`, ותמונה שלא נקשרה לרשומה נשארת לנצח. מתודה חדשה מחייבת מימוש גם ב `s3.ts` ועדכון `tests/contract/storage-adapter.test.ts`.

#### `packages/adapters/src/s3.ts`
דפוס P11, המימוש האמיתי של `StorageAdapter` מול כל שירות תואם S3, עם חתימת SigV4 ביד. משמש לתמונות פריטים, כולל צילומי קבלה, דרך `media.service.ts`, `vault.service.ts` ו `browse.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 30 עד 76 | `S3Config`, `sha256Hex`, `hmac`, `encodeSegment` לפי RFC 3986, `encodeKey`, `stamps`, `signingKey` עם ארבעה HMAC | |
| 78 עד 101 | בנאי זורק בלי endpoint, bucket או מפתחות. `urlFor` בסגנון path, `hostHeader` מ `URL.host` | path style מתאים ל MinIO. מקטע `..` במפתח מנורמל על ידי מנתח ה URL ויכול לכתוב ל bucket אחר. היום המפתחות נוצרים בשרת |
| 111 עד 170 | `putObject` מחשב hash של הגוף, ממיין ארבעה headers, בונה canonical request משש שורות ו string to sign, חותם ושולח PUT עם `authorization`. על כשל זורק עם סטטוס, מפתח ועד 400 תווים | hash מלא ולא `UNSIGNED-PAYLOAD`, כדי ששינוי תוכן בדרך יכשיל את החתימה. כל header חדש חייב להיכנס לרשימה החתומה. כשל מגיע לקורא כשגיאה כללית ויוצא 500, וזה E10. אין timeout |
| 180 עד 220 | `getSignedUrl` מקומי לגמרי, תוקף בין שנייה לשבעה ימים, ברירת מחדל 300 שניות, `UNSIGNED-PAYLOAD` | ה URL הולך ישר ל `<img>` בדפדפן. שינוי ברירת המחדל משפיע על כל קורא שלא מעביר ערך |

#### `scripts/dev.mjs`
מה ש `pnpm dev` מריץ. מרים את ה API, ממתין ש `/api/v1/healthz` יענה, ורק אז מרים את Vite עם `VITE_API_PROXY_TARGET` שמצביע על אותו API.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 25 עד 60 | `repoRoot` מ `import.meta.url`, timeout של שתי דקות שנקבע ב `DEV_API_READY_TIMEOUT_MS`, `readEnvFile` מינימלי, `env` שבו הסביבה מנצחת את הקובץ, `apiTarget`, `healthUrl`, `apiPort` | `readEnvFile` לא מבין `export` או הערות בסוף שורה. target בלי פורט נופל ל 3000 ולא ל 80 |
| 62 עד 123 | `run` עם `shell: true`, `prefix` שמוסיף `[api]` לכל שורה, `killTree`, `shutdown` חד פעמי | ב Unix `killTree` שולח `SIGTERM` רק ל shell, ו pnpm ו nest עלולים להישאר יתומים ולתפוס את הפורט. `detached` והריגת קבוצת התהליכים יפתרו |
| 130 עד 149 | `waitForApi` סוקר כל חצי שנייה, עוצר אם ה API יצא, ובכישלון שואל אם Postgres למעלה ואם `.env` קיים | |
| 164 עד 205 | `portIsBusy` מנסה health ואז חיבור TCP, ומדפיס פקודה לשחרור הפורט לפי מערכת ההפעלה | |
| 207 עד 234 | זרימה ראשית. API עם פלט ב pipe, יציאה שלו קטלנית, ואז Vite עם `stdio: 'inherit'` | |

**שים לב.** לא מרים worker, Postgres או מיגרציות, ולכן דואר מה outbox לא יוצא ב `pnpm dev`. ה watcher של Nest צופה רק ב `apps/api/src`, שינוי ב `packages/*` נקלט אחרי build והפעלה מחדש. שינוי נתיב ה health שובר את הסקריפט הזה ואת `tunnel.mjs`.

#### `scripts/test.mjs`
מה ש `pnpm test` מריץ. `SUITES` בשורות 41 עד 50 היא רשימה קשיחה, קודם `web`, `ux`, `contract`, `core-contract`, שלא צריכים מסד, ואחר כך `integration`, `core`, `concurrency`, `property` עם `--no-file-parallelism`. `run` בשורות 52 עד 62 מחזיר את קוד היציאה. הלולאה בשורות 68 עד 74 עוצרת בכישלון הראשון. שורות 76 עד 85 מריצות את ה seed גם אחרי כישלון, אלא אם `--no-reset` או `BAULT_TEST_NO_RESET=1`, ושומרות את קוד הכישלון המקורי.

**שים לב.** ה reset קורה אחרי הריצה ולא לפניה, כך שריצה שמתחילה על מסד מלוכלך תלויה בהיסטוריה, וזה E16. ה seed מריץ TRUNCATE על כל מסד שה `.env` מצביע עליו ויוצר משתמשים עם הסיסמה `11111111`. פרויקט vitest חדש שלא נוסף ל `SUITES` פשוט לא ירוץ.

#### `scripts/tunnel.mjs`
מה ש `pnpm tunnel` מריץ. חושף את האפליקציה לאדם חיצוני דרך Cloudflare quick tunnel, בדרך בטוחה יותר מעבודה ידנית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 38 עד 75 | `PREVIEW_PORT` 4173, `AUTH_LIMIT_DEFAULT` 30, `readEnvFile` מועתק מ `dev.mjs`, בדיקת health ל `127.0.0.1:API_PORT` | 30 משוכפל מהסכמה. מתעלם מ `VITE_API_PROXY_TARGET` |
| 79 עד 87 | מזהיר אם `AUTH_RATE_LIMIT_PER_MINUTE` גבוה מ 30 | לא עוצר, ולא בודק את `RATE_LIMIT_PER_MINUTE` |
| 91 עד 93 | `pnpm --filter @bault/web build` סינכרוני | כישלון עוצר לפני חשיפה |
| 97 עד 153 | משתמש וסיסמה, אקראית של 96 ביט אם לא הוגדרה, מתיר `.trycloudflare.com`, מרים `vite preview` עם basic auth, ובשורות 141 עד 152 דורש `401` | אם ה preview עונה `200` בלי סיסמה הסקריפט מסרב. זה תופס מקרה אמיתי, שורת `WEB_PREVIEW_PASSWORD=` ריקה ב `.env` מנצחת ב `vite.config.ts` ומכבה את ה auth |
| 104 עד 128 | `run` עם `shell: true` ופלט ב pipe, `killTree` ו `shutdown` כמו ב `dev.mjs`, ו handlers ל `SIGINT` ו `SIGTERM` | אותה בעיה של תהליכים יתומים ב Unix |
| 157 עד 177 | `npx --yes cloudflared`, מחפש את ה URL בפלט ומדפיס אותו עם המשתמש והסיסמה | חבילת צד שלישי בלי גרסה נעולה, מחוץ ל lockfile, על מכונה עם `.env` אמיתי |

**שים לב.** רק `/api` עובר ל API, כך ש `/docs` לא נחשף. מאחורי ה basic auth יושב API של פיתוח עם משתמשי seed בסיסמה `11111111`, כולל המנהל, והסקריפט לא מזהיר על זה.

#### `scripts/fetch-fonts.mjs`
מוריד גופנים מ Google Fonts ל `assets/fonts/` וכותב מחדש את `apps/web/src/fonts.css`. מריצים ביד בלבד, הקבצים עצמם בגיט כדי שה build לא יהיה תלוי ברשת.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 67 | נתיבים, `UA` של Chrome כדי לקבל woff2, `KEEP` לשלוש תת קבוצות, `FAMILIES` עם ארבע משפחות | ההערה בשורה 36 מדברת על חמש |
| 74 עד 86 | `parseFaces` מפענח את ה CSS של Google עם regex | תלוי בפורמט של Google |
| 88 עד 154 | `main` מוריד, מסנן, כותב woff2 ובונה `@font-face` עם `/fonts/` | `/fonts/` עובד כי `assets/` הוא ה publicDir. אין נעילת גרסה, ושינוי `slug` משאיר קבצים ישנים |

#### `scripts/design-lint.mjs`
linter למערכת העיצוב, בלי תלויות. בודק את `apps/web/src/index.css` ואת כל `.ts` ו `.tsx` תחת `apps/web/src` מול חמישה חוקים מ `DESIGN.md`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 36 עד 92 | `TOKEN_BLOCK_END`, `ALLOWED_PX`, `TYPE_PX`, `onScale` לכפולות של 4, `CODE_SELECTORS`, `report` | הוספה ל `ALLOWED_PX` מתירה בכל הקובץ ולא במקום אחד |
| 98 עד 168 | ממיר CRLF, זורק אם הסמן חסר, `stripComments`, `allowed` לפי `design-lint-allow` בשורה או שתיים מעליה, ובדיקת מאפיינים פיזיים, px מחוץ לסולם, radius, shadow וצבעים גולמיים מתחת לבלוק ה tokens | שינוי כותרת `Application shell` ב `index.css` שובר את הכלי. בדיקת `@media` היא לפי שורה |
| 171 עד 190 | `font-mono` מותר רק בסלקטורים של קוד | `includes` על מחרוזת, היוריסטי |
| 194 עד 217 | `walk` רקורסיבי על TSX ובדיקת class ו inline style פיזיים | |
| 221 עד 238 | מקבץ לפי קובץ ויוצא 1 על ממצאים | |

**שים לב.** לא מחובר לשום סקריפט ולא ל CI. הקוד היום נקי, כך שהוספה ל CI היא שורה אחת.

#### `scripts/remove-test-users.mjs`
מוחק חשבונות ישנים של בדיקות האינטגרציה בתבנית `t<epoch-ms>@bault.dev`. dry run כברירת מחדל, `--apply` מוחק.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 40 עד 45 | imports, כולל `import pg from 'pg'` בשורה 42 | `pg` לא מוצהר בשורש, והסקריפט נופל ב `ERR_MODULE_NOT_FOUND` לפני שהוא עושה משהו |
| 47 עד 67 | `LEGACY_FIXTURE` מעוגן, `PROTECTED` חמש כתובות seed, `ACTIVITY` שש טבלאות | ההערה מזכירה גם `transactions`, שאינה ברשימה |
| 69 עד 80 | `databaseUrl` מהסביבה או מ `.env` | ברירת המחדל היא PgBouncer, ועובד שם |
| 82 עד 153 | טוען חשבונות, מסנן, בודק פעילות, ועם `--apply` מוחק tokens, sessions וחשבונות בטרנזקציה עם rollback | שגיאה בבדיקה נחשבת לפעילות, fail closed. רוב הטבלאות שמחזיקות מזהה משתמש בלי מפתח זר, ולכן מחיקה משאירה בהן שורות יתומות בשקט. הבדיקה רצה מחוץ לטרנזקציה |

#### `infra/docker-compose.yml`
התשתית המקומית של מפתח, Postgres 16, PgBouncer לפניו ו MinIO. ה API, ה worker וה SPA רצים מחוץ ל Docker. הערכים כאן הם המקור לערכים ב `.env.example`. ה CI לא משתמש בקובץ, הוא משכפל את השירותים בעצמו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 8 עד 27 | `postgres:16` עם `bault:bault` ומסד `bault`, `wal_level=replica`, פורט 5432, volume `pgdata`, healthcheck עם `pg_isready` | הסיסמה נקבעת רק באתחול הראשון של ה volume. `replica` הוא ממילא ברירת המחדל ולא מוסיף כלום ל PITR, חסרים `archive_mode` ו `archive_command` |
| 29 עד 41 | `edoburu/pgbouncer:latest` שבונה את התצורה ממשתני סביבה, `POOL_MODE: transaction`, 500 לקוחות ו pool של 20 חיבורים אמיתיים, `scram-sha-256`, 6432 במארח ל 5432 בפנים, ומחכה ש Postgres יהיה בריא | הפורט הפנימי 5432 הוא ברירת מחדל של ה image, ותג צף עלול לשנות אותו בשקט. transaction pooling היא ההחלטה החשובה. אסור לקוד ה API להסתמך על `SET`, prepared statements עם שם או `LISTEN`. המיגרציות ו pg-boss עוקפים דרך `DIRECT_DATABASE_URL` |
| 43 עד 54 | `quay.io/minio/minio:latest` עם קונסולה על 9001 ו `minioadmin` | ה bucket לא נוצר כאן, יוצרים ביד לפי `.env.example` |
| 56 עד 58 | שני volumes | `down -v` מוחק את הנתונים |

**שים לב.** הפורטים מפורסמים על כל הממשקים, כולל קונסולת MinIO, עם סיסמאות ידועות, ו Docker עוקף ufw. עדיף `127.0.0.1:5432:5432`. שני שירותים על תג `latest` צף.

| קובץ | מה הוא עושה |
|---|---|
| `infra/pgbouncer/pgbouncer.ini` | תצורת ייחוס ל PgBouncer בלי Docker, עם `pool_mode = transaction` ו `listen_addr = 0.0.0.0`. אף אחד לא טוען אותה, ושינוי ב compose לא ישתקף בה |
| `infra/pgbouncer/userlist.txt` | `"bault" "bault"` גלוי, בניגוד להערה בשורה 2 שאומרת שסיסמאות לא נכנסות לגיט. לא נטען. העתקה לשרת יחד עם ה ini יוצרת PgBouncer חשוף |

#### `infra/ops/backup.sh`
הסקריפט היחיד לגיבוי ושחזור, שלוש פקודות, `dump`, `verify`, `restore`. דורש `DIRECT_DATABASE_URL` מיוצא וכלי Postgres. נשמר בלי ביט הרצה, ולכן מריצים `bash infra/ops/backup.sh dump`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 25 עד 34 | `set -euo pipefail`, `BACKUP_DIR` ברירת מחדל `./backups`, שמירה 30 יום, `die`, `require_url` | התיקייה יחסית לתיקיית העבודה, ו `backups/` לא ב `.gitignore`. `git add .` אחד מכניס dump לגיט |
| 48 עד 74 | `cmd_dump`, `pg_dump` בפורמט custom עם `--compress=9`, `--no-owner` ו `--no-privileges`, checksum, ומחיקת קבצים ישנים רק אחרי הצלחה | `--no-privileges` משמיט את ה GRANT וה REVOKE של `bault_app`, ולכן אחרי שחזור חובה להריץ את המיגרציה. ה checksum כותב נתיב יחסי |
| 83 עד 146 | `cmd_verify`, checksum וקריאת תוכן העניינים, שחזור למסד זמני עם `--exit-on-error` ו `trap` שמוחק אותו, ספירת שורות ב `user_account`, `item`, `custody_event`, `bin_transfer`, `ledger_record` ו `parcel`, וארבע בדיקות שלמות, פריט בלי בעלים, פריט ב bin שלא קיים, אירוע custody בלי פריט, ושורת ledger בלי חשבון | הבדיקות מדפיסות הפרות אבל יוצאות 0, ו `verified` מודפס בכל מקרה. `${DIRECT_DATABASE_URL%/*}` שובר URL עם פרמטרים. דורש `CREATEDB`. הבדיקות חשובות כי רוב הקשרים בסכמה אינם מפתחות זרים. אין בדיקת יתרה, כי יתרה נגזרת מה ledger ולא נשמרת. עמודה חדשה שמפנה לחשבון או לפריט בלי מפתח זר צריכה בדיקה כאן |
| 154 עד 167 | `cmd_restore` דורש URL יעד מפורש והקלדת שם המסד, ואז `pg_restore --clean --if-exists` | מחזיר גם את תורי pg-boss לנקודת ה dump, ועבודות עלולות לרוץ שוב |
| 169 עד 174 | `case` על הפקודה | |
| 176 עד 195 | הערה שמודה שנקודת השחזור היא ה dump האחרון | עד יום של ledger ו custody עלול ללכת |

**שים לב.** זה האתר של E5. אין PITR, אין תזמון, אין העתקה החוצה ואין הצפנה, והתמונות ב bucket לא מגובות בכלל. שינוי שם טבלה במיגרציה ישבור את `verify` רק ברגע שמישהו ינסה לבדוק גיבוי.

#### `apps/api/Dockerfile`
ה image של ה API, multi stage. אף workflow או סקריפט לא בונה אותו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 33 | `node:20-slim`, corepack עם `pnpm@9`, העתקת שבעת המניפסטים לפני הקוד, `pnpm install --frozen-lockfile` | Node 20 סותר את `engines` ואת ה CI שרץ על 24, ואין לו עוד עדכוני אבטחה. חבילת workspace חדשה צריכה שורת `COPY` כאן |
| 35 עד 47 | העתקת `tsconfig.base.json`, `packages/` ו `apps/api/`, build של config, adapters וה API, ואז `install --prod` | אין `.dockerignore`, ולכן `node_modules`, `dist` וקבצים מקומיים של הבונה נכנסים. `--prod` מוציא את `tsx` ואת `drizzle-kit` |
| 50 עד 68 | runtime נקי, משתמש `bault` עם uid 10001, העתקת `node_modules`, `packages`, `dist`, ובשורות 65 עד 68 המיגרציות ל `src/db` | `node dist/db/migrate.js` מחפש את `0001_append_only.sql` ב `dist/db/sql`, שלא קיים, ונופל אחרי מיגרציות drizzle בלי triggers של append only. זה E2. `dist/db/seed.js` ההרסני נמצא ב image בלי חסימה, וזה E11. התיקון ל E2 הוא להעתיק את ה SQL ל `dist/db/sql`, למשל דרך `assets` ב `nest-cli.json`, או לחפש אותו יחסית לתיקיית העבודה |
| 70 עד 82 | `USER bault`, `EXPOSE 3000`, healthcheck ל `/api/v1/healthz`, `CMD` בצורת exec | Node הוא PID 1, ו PID 1 בלי handler מתעלם מ `SIGTERM`. ה API בסדר כי `main.ts` קורא ל `enableShutdownHooks`. ה healthcheck הוא liveness בלבד, ו `/readyz` שבודק את המסד נשאר ל orchestrator. `EXPOSE` לא מתעדכן אם `API_PORT` שונה |

#### `apps/worker/Dockerfile`
אותו מבנה כמו ה API, עם `apps/worker/` ו `tsc` במקום `nest build`. image נפרד מאפשר worker אחד ליד הרבה עותקי API.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 36 | build, זהה ל API | `tsc` לא מוחק את `dist`, ובלי `.dockerignore` קבצי `.js` ישנים מהמארח עלולים להיכנס |
| 39 עד 59 | runtime, משתמש `bault`, בלי `EXPOSE` ובלי healthcheck, `CMD` בצורת exec | אין handler ל `SIGTERM`, ולכן `docker stop` הורג באמצע עבודה אחרי עשר שניות. אחרי העלייה שגיאות pg-boss רק נכתבות ללוג והתהליך נשאר חי. זה E15. ההערה מונה שבע עבודות, נרשמות שמונה |

**שים לב.** import מתוך `apps/api` בקוד ה worker ישבור את ה image, כי רק `apps/worker/` מועתק.

#### `apps/web/Dockerfile`
בונה את ה SPA עם Vite ומגיש אותו עם nginx. nginx הוא גם המקום שבו חי ה CSP, כי ה API מכבה את שלו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 34 | אותו build כמו ב API, ובשורה 32 `COPY assets/ assets/`, ואז `pnpm --filter @bault/web build` עם `tsc --noEmit` | `packages/` מועתק אף שה SPA לא תלוי בו. בלי `assets/` ה build נכשל, כי הוא ה `publicDir`, וכך 7.9MB של תמונות קטלוג נכנסים ל image. בלי `.dockerignore` גם `apps/web/.env` מקומי נכנס וכל `VITE_` בו מוטמע בבנדל |
| 37 עד 51 | `nginx:1.27-alpine`, `dist` לתיקיית nginx, `nginx.conf` לתיקיית ה templates, `API_UPSTREAM` ברירת מחדל `http://api:3000`, פורט 8080, healthcheck עם `wget` | ה entrypoint מחליף רק משתני סביבה מוגדרים, ולכן `$uri` נשאר. תהליך ה master רץ כ root, בשונה משני ה images האחרים |

#### `apps/web/nginx.conf`
מגיש את ה SPA, מוסיף כותרות אבטחה, מנהל cache ומעביר `/api/` ל API באותו origin. אותו origin מאפשר `connect-src 'self'` ועוגיית session מאותו צד.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 17 | `listen 8080`, root, `index.html`, `server_tokens off` | |
| 19 עד 46 | CSP בשורה 35 עם `default-src 'self'`, `style-src` עם `'unsafe-inline'`, `img-src` עם `data:` ו `blob:`, `connect-src 'self'`, `object-src 'none'` ו `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` עם מצלמה לאתר עצמו, HSTS בהערה | `always` שולח גם על תשובות שגיאה. שינוי `connect-src` ל origin אחר מחייב שינוי ב `CORS_ORIGINS`. HSTS כבר מגיע מ helmet של ה API, והורדת ההערה תיצור שני מקורות |
| 48 עד 50 | gzip לטקסט מעל 1024 בתים | |
| 56 עד 76 | `/assets/` לשנה ו `immutable`, `/images/` ליום, `= /index.html` עם `no-store`. `try_files $uri =404` בשני הראשונים | כל אחד מהשלושה מוסיף `add_header` משלו, ולכן לא יורש את כותרות האבטחה. דף ה HTML יוצא בלי CSP ובלי `X-Frame-Options`, וזה E22. התיקון הוא `include` של קובץ כותרות בכל `location` |
| 92 עד 100 | `proxy_pass ${API_UPSTREAM}`, `X-Forwarded-For` נקבע ל `$remote_addr` ולא מצורף, `X-Request-Id`, גוף עד 25MB | עם `TRUST_PROXY=loopback` ה API רואה את כל הלקוחות ככתובת nginx וכולם חולקים דלי rate limit אחד, וזה E14. השם `api` מפוענח פעם אחת בעלייה |
| 103 עד 105 | `try_files $uri $uri/ /index.html` לניתוב צד לקוח | ההפניה הפנימית ל `/index.html` היא מה שמפיל את הכותרות על כל נתיב SPA |

**שים לב.** בבדיקה בפועל, `/`, נתיב SPA כמו `/some/route` ו `/index.html` יצאו בלי CSP ובלי `X-Frame-Options`, וכך גם `/assets/` ו `/images/`, שקיבלו בנוסף שתי כותרות `Cache-Control`. רק `/fonts/` ו `/api/` קיבלו את הכותרות. כל `add_header` חדש בבלוק `location` כלשהו, גם `/api/`, יעלים ממנו את כותרות האבטחה באותו אופן.

#### `.github/workflows/ci.yml`
ה pipeline היחיד, job אחד בשם `verify`. לא משתמש ב `scripts/test.mjs` ולא ב compose.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 15 עד 21 | `push` ו `pull_request` בלי סינון, `ubuntu-latest` | אין `permissions` ואין `timeout-minutes` |
| 23 עד 36 | service של `postgres:16` עם healthcheck | אין PgBouncer, ולכן transaction pooling לא נבדק |
| 38 עד 59 | כל הסביבה בקובץ, `PAYMENT_PROVIDER: sandbox`, `NODE_ENV: test`, `STORAGE_PROVIDER: s3`, rate limits של 5000 ו 20000 | משתנה חובה חדש בסכמה חייב להיכנס כאן |
| 64 עד 83 | MinIO כשלב ולא service, המתנה לבריאות ויצירת bucket עם `mc` | service container לא מאפשר להעביר פקודה |
| 85 עד 98 | `pnpm/action-setup@v4`, `setup-node@v5` עם Node 24, `install --frozen-lockfile` | Node 24 בכוונה בגלל jsdom 30, בזמן שה images על 20. actions נעולים לפי תג ולא SHA |
| 100 עד 113 | build של `./packages/*`, `lint`, `typecheck` | ה build חייב לרוץ לפני typecheck |
| 115 עד 129 | `web`, `ux`, `core-contract`, `contract` | |
| 131 עד 151 | `db:migrate` ו `db:seed` דרך `tsx`, build של ה API, הרצה ברקע והמתנה ל `/readyz` | המיגרציה רצה מהמקור, שם `__dirname` הוא `src/db` וה SQL נמצא, ולכן E2 לא נתפס כאן. גם `docker build` לבד לא יתפוס אותו, צריך להריץ את ה migrator בתוך ה image ולבדוק שה triggers קיימים. פלט ה API לא נשמר, וכשל בצד השרת קשה לאבחן |
| 153 עד 170 | `integration`, `core`, `concurrency`, `property`, ועצירת ה API עם `if: always()` | |

**שים לב.** ה CI לא בונה אף image, לא מריץ `vite build`, לא בונה את ה worker, לא מריץ `pnpm audit`, וזה קשור ל E12, ולא מריץ את `design-lint`. פרויקט vitest חדש צריך שלב משלו כאן.

#### קבצים נלווים בשורש

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/.env.example` | משתנה אחד, `VITE_API_PROXY_TARGET`, עם אזהרה שכל `VITE_` נכנס לבנדל. העתקה ל `apps/web/.env` דורסת גם `API_PORT` אחר מהשורש |
| `assets/fonts/` | 19 קבצי woff2 של ארבע משפחות, נוצרו על ידי `fetch-fonts.mjs` ומוגשים ב `/fonts/` דרך `fonts.css`. התאמה מלאה בין קבצים להפניות |
| `DESIGN.md` | מסמך מערכת העיצוב Custody Grade. כוונה ולא מקור אמת, `index.css` קובע. `design-lint.mjs` מקודד ביד חמישה מחוקיו |
| `m.html` | עותק שמור של דף מאתר חיצוני עם Google Tag Manager, נכנס בטעות בקומיט `sdfsdf`. אף קוד לא מפנה אליו, כדאי למחוק |
| `skills-lock.json` | נעילת hash של skill אחד לסוכני AI, `web-design-guidelines` מ `vercel-labs/agent-skills`. לא משפיע על ריצה |
| `.agents/skills/web-design-guidelines/SKILL.md` | הוראות לסוכן AI לבקר קוד UI מול הנחיות ממשק של Vercel. כפיל של הקובץ תחת `.claude/skills/` |

#### קבצי Spec Kit ב `.github/agents/` וב `.github/prompts/`
Bault נבנה עם GitHub Spec Kit, כלי שמוביל סוכן AI דרך specify, plan, tasks ו implement. אלה קבצי אינטגרציית Copilot, זוג לכל שלב. קובץ ה prompt הוא שלוש שורות frontmatter שמפנות ל agent באותו שם, וקובץ ה agent מכיל את ההוראות ולפעמים `handoffs` לשלב הבא. שום קוד לא טוען אותם. הם מסבירים הערות בקוד כמו `T020` או `Principle XIII`, שמפנות ל `specs/` ול `.specify/memory/constitution.md`.

| שלב | קבצים | מה השלב עושה |
|---|---|---|
| constitution | `.github/agents/speckit.constitution.agent.md`, `.github/prompts/speckit.constitution.prompt.md` | כותב ומעדכן את עקרונות היסוד |
| specify | `.github/agents/speckit.specify.agent.md`, `.github/prompts/speckit.specify.prompt.md` | הופך תיאור חופשי למפרט |
| clarify | `.github/agents/speckit.clarify.agent.md`, `.github/prompts/speckit.clarify.prompt.md` | שואל שאלות הבהרה ומעדכן את המפרט |
| checklist | `.github/agents/speckit.checklist.agent.md`, `.github/prompts/speckit.checklist.prompt.md` | רשימת בדיקת איכות למפרט |
| plan | `.github/agents/speckit.plan.agent.md`, `.github/prompts/speckit.plan.prompt.md` | תוכנית מימוש ובחירת stack |
| tasks | `.github/agents/speckit.tasks.agent.md`, `.github/prompts/speckit.tasks.prompt.md` | מפרק את התוכנית למשימות ממוספרות |
| analyze | `.github/agents/speckit.analyze.agent.md`, `.github/prompts/speckit.analyze.prompt.md` | בודק עקביות בין מפרט, תוכנית ומשימות |
| implement | `.github/agents/speckit.implement.agent.md`, `.github/prompts/speckit.implement.prompt.md` | מבצע את המשימות בקוד |
| converge | `.github/agents/speckit.converge.agent.md`, `.github/prompts/speckit.converge.prompt.md` | משווה קוד למפרט ומוסיף משימות חסרות |
| taskstoissues | `.github/agents/speckit.taskstoissues.agent.md`, `.github/prompts/speckit.taskstoissues.prompt.md` | הופך משימות ל issues ב GitHub |

## פרק 2. תהליך ה API, עלייה, תשתית משותפת וה seed

### סקירה

זה השלד של תהליך ה API. אין כאן לוגיקה עסקית, אבל כל בקשה עוברת דרכו. `main.ts` בונה את שכבת ה HTTP בקוד אימפרטיבי, ולכן הסדר בקובץ הוא סדר הריצה. `app.module.ts` מרכיב את כל המודולים ורושם את ה guards וה interceptor הגלובליים. `db` מחזיק את ה pool, את ה migrator ואת ה seed. `shared` מחזיק תשתית רוחבית, שגיאות, idempotency, אישור דו שלבי, adapters, ids, כסף ולוגים.

סדר קריאה מומלץ. `package.json`, `main.ts`, `app.module.ts`, אחר כך `db`, אחר כך `shared` לפי סדר השימוש בבקשה, ובסוף `seed.ts`, הקובץ הארוך והמסוכן ביותר כאן.

```mermaid
sequenceDiagram
  participant X as Express middleware
  participant G as Guards
  participant I as AuditInterceptor
  participant P as ValidationPipe
  participant H as Handler
  participant C as AllExceptionsFilter
  X->>X: requestContext, trust proxy, helmet, json 16mb, cors
  X->>G: Throttler, SessionAuth, Roles
  G->>I: לפני
  I->>P: DTO, whitelist, transform
  P->>H: שירות, לרוב בתוך db.transaction
  H-->>I: tap כותב audit_record בלי await
  H--xC: כל זריקה מכל שלב
```

שלושה כללים שחוזרים בכל הקבצים. `loadEnv` נקרא לראשונה כבר בזמן ה import של בקרים, לא ב `bootstrap`, והוא מחזיר אובייקט קפוא מ cache. ה guards רצים לפני ה `ValidationPipe`, ולכן הם רואים גוף שלא עבר ולידציה. כל שגיאה מכל שלב, כולל שגיאות middleware של Express, יוצאת מ `AllExceptionsFilter` בצורה `{ error: { code, message, details } }`.

מה שכבר עובד ושווה לשמור. ולידציית env לפני בניית האפליקציה, סירוב ל `TRUST_PROXY=true` ול sandbox ב production, guards גלובליים עם opt out, `forbidNonWhitelisted`, 500 אטום ללקוח, `BillingPort` שמקבל `tx`, hash בלבד לכל טוקן, וכסף כמספר שלם עם מטבע.

#### `apps/api/package.json`
המניפסט של `@bault/api`. המקום היחיד שמסביר איך מריצים migration ו seed.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 7 עד 15 | `dev` בונה קודם את `@bault/adapters` ו `@bault/config`, שנצרכות מה `dist` שלהן, ואז `nest start --watch`. `build` הוא `nest build`, `start` מריץ את `dist/main.js`, ו `typecheck` הוא `tsc --noEmit` שמשמש את הבדיקה ברמת השורש. `db:generate` מפעיל `drizzle-kit generate`. `db:migrate` ו `db:seed` מריצים את קוד המקור דרך `tsx`. | `tsx` הוא devDependency, ולכן שני סקריפטי ה DB לא רצים בתמונת ה production. זה הרקע של E2 ו E11. |
| 16 עד 34 | תלויות ריצה. Nest, swagger, throttler, `argon2`, class-validator ו class-transformer, `cookie`, `drizzle-orm`, `pg`, `express` 5 שממנו `main.ts` מייבא `json`, `helmet`. | `argon2` חייב להישאר תלות ריצה בגלל ההתחברות. שינוי שם החבילה שובר את `scripts/test.mjs` ואת CI שמסננים לפי `@bault/api`. |
| 35 עד 43 | תלויות פיתוח. Nest CLI, `drizzle-kit`, `tsx`, `typescript`. | |

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/tsconfig.json` | יורש מ `tsconfig.base.json`, CommonJS כך ש `__dirname` קיים, `experimentalDecorators` ו `emitDecoratorMetadata` שבלעדיהם ה DI וה `ValidationPipe` לא עובדים, `isolatedModules: false`. כולל רק `src/**/*.ts`, ולכן `seed.ts` נבנה ל `dist` וקובצי `.sql` לא. |
| `apps/api/drizzle.config.ts` | הגדרות `drizzle-kit`. סכמה מ `src/db/schema/index.ts`, פלט ל `src/db/migrations`, חיבור דרך `DIRECT_DATABASE_URL` בפורט 5432 ולא PgBouncer. קורא `loadEnv` בטעינה, כך ש `generate` נכשל בסביבה חסרה. שינוי `out` מחייב שינוי מקביל ב `migrate.ts` ובשורת ההעתקה של ה migrations ב Dockerfile. |
| `apps/api/svg2png.tmp.mjs` | סקריפט Playwright חד פעמי שמרנדר SVG ל PNG. `playwright` לא מותקן בחבילה, אף קוד לא מייבא אותו, והוא לא נבנה. שארית, מחיקה בטוחה. |

#### `apps/api/nest-cli.json`
הגדרות `nest build`. `sourceRoot` הוא `src`, ו `deleteOutDir` מוחק את `dist` לפני כל build.

**שים לב.** אין מפתח `assets`, ולכן `src/db/sql/0001_append_only.sql` לא מועתק ל `dist`. זה שורש E2. התיקון הוא `"assets": ["db/sql/**/*"]`.

#### `apps/api/src/main.ts`
נקודת הכניסה, `CMD` של ה Dockerfile. כל מה שנוגע ל HTTP ולא שייך למודול נבנה כאן. ההערות בקובץ היסטוריות וחלקן לא מדויקות, קראו את הקוד.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 13 | imports. `reflect-metadata` ראשון. | חייב להישאר ראשון, אחרת ה decorators נטענים בלי `Reflect.getMetadata`. |
| 15 עד 26 | הערת פתיחה ו `loadEnv`. | ההערה לא מזכירה את ה middleware. `loadEnv` כבר רץ קודם, ב import של `auth.controller.ts` ו `SessionAuthGuard`, ולכן כשל סביבה מתפוצץ עם stack של בקר. |
| 37 עד 40 | `NestFactory.create` עם `StructuredLogger`. כאן נבנה גרף ה DI ורצים כל ה `useFactory`, ה pool, ה adapters וה throttler. | factory של adapter שזורק מפיל את התהליך לפני `listen`, בכוונה. |
| 47 | `app.use(requestContext)`, ה middleware הראשון. פותח `AsyncLocalStorage` עם `requestId`. | אם יוזז אחרי `listen` הוא לא ירוץ, ו `requestId` ייעלם מכל הלוגים. |
| 68 | `trust proxy` מ `TRUST_PROXY`, ברירת מחדל `loopback`. קובע את `req.ip`, שעליו נשענים ה throttler ורישום IP ב session. | E14. מאחורי nginx בקונטיינר אחר כל הלקוחות נראים כ IP אחד, וכולם חולקים דלי throttle. צריך `uniquelocal` או CIDR. הסכמה אוסרת `true`. nginx דורס את `X-Forwarded-For` ולא מוסיף אליו, כך שזיוף מהלקוח לא עובר דרכו. |
| 78 | `helmet` עם `contentSecurityPolicy` ו `crossOriginEmbedderPolicy` כבויים. | נשארים HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer` ו CORP, ו `X-Powered-By` מוסר. ה CSP האמיתי ב `apps/web/nginx.conf`, כי CSP ברירת מחדל שובר את Swagger UI. `Cross-Origin-Resource-Policy: same-origin` יחסום טעינת תשובות כמשאב מ origin אחר. |
| 90 | `json({ limit: '16mb' })`. מספיק לתמונה של 10MiB ב base64. | התקרה חלה על כל נתיב ורצה לפני כל guard, כך שאנונימי יכול לשלוח 16MiB ל `/auth/login`. Nest מדלג על פרסר ה JSON שלו רק כי שם הפונקציה הוא `jsonParser`. |
| 100 עד 103 | CORS רק אם `CORS_ORIGINS` לא ריק, עם `credentials: true` ורשימה סגורה. | נרשם אחרי ה JSON, ולכן 400 ו 413 מהפרסר יוצאים בלי כותרות CORS. ה cookie הוא `SameSite=Lax`, כך ש CORS עוזר רק לאותו site. SPA על דומיין אחר ידרוש `SameSite=None` והגנת CSRF שאין היום. `origin: true` עם `credentials` יפתח קריאה של תשובות מאומתות לכל אתר. |
| 113 | `enableShutdownHooks`. SIGTERM סוגר את שרת ה HTTP וממתין לבקשות פתוחות. | אין timeout משלנו, Docker הורג אחרי 10 שניות. כתיבת audit בלי await עלולה להיחתך. ה pool לא נסגר. |
| 116 | `setGlobalPrefix('api/v1')`. | שינוי שובר את ה SPA, nginx, ה healthcheck, `scripts/dev.mjs`, `scripts/tunnel.mjs` וכל הבדיקות. |
| 119 | `AllExceptionsFilter` נוצר עם `new`, בלי DI. | |
| 130 עד 137 | `ValidationPipe` עם `whitelist`, `forbidNonWhitelisted`, `transform` ו `exceptionFactory` מ `validation-error.ts`. שדה לא מוכר מחזיר 400, והגוף הופך למופע של מחלקת ה DTO. | חל רק על פרמטרים שהטיפוס שלהם מחלקה עם decorators. פרמטר `string` או `Record` עובר בלי בדיקה. |
| 147 עד 155 | `EXPOSE_API_DOCS` כבוי, `listen` ויציאה. | E7. הסכמה משתמשת ב `z.coerce.boolean`, ולכן `false` מדליק את התיעוד. רק מחיקת המשתנה מכבה. |
| 157 עד 188 | basic auth על `/docs`. שם המשתמש מתעלם, הסיסמה מושווית ב `timingSafeEqual` אחרי בדיקת אורך. | E19. `app.use('/docs')` לא תופס את `/docs-json`, שם Swagger מגיש את המסמך המלא. רלוונטי כשפורט ה API נגיש ישירות, כי nginx מעביר רק `/api/`. בדיקת האורך מדליפה אורך, בניגוד להערה. בכישלון 401 עם `WWW-Authenticate`, והדפדפן פותח חלון סיסמה. |
| 190 עד 201 | `DocumentBuilder` עם `addCookieAuth`, `createDocument`, `setup('docs')`, ואז `listen`. | רק ב `listen` Nest רושם את פרסר ה `urlencoded` שלו בתקרה של 100kB, ואת ה router. |
| 204 | `void bootstrap()`. | כישלון, למשל פורט תפוס, יוצא כ unhandled rejection בלי לוג מובנה. |

**שים לב.** E8 נולד כאן. פרסר ה `urlencoded` של Nest מקבל טופס HTML רגיל, ואין טוקן CSRF, כך ש login CSRF אפשרי. התיקון הוא לדחות כל `Content-Type` שאינו JSON לפני הפרסרים, או `bodyParser: false` ורישום `json` בלבד.

איך האתחול נכשל, ואיפה מחפשים.

| כשל | מתי | איך זה נראה |
|---|---|---|
| env חסר או לא תקין | בזמן ה import, לפני `bootstrap` | רשימת בעיות מ `loadEnv` ו stack שמצביע על קובץ בקר |
| adapter של sandbox ב production | `NestFactory.create` | שגיאה מפורשת מה factory ב `adapters.module.ts` |
| provider שלא נפתר, למשל מודול שאינו גלובלי | `NestFactory.create` | שגיאת DI של Nest |
| ייצור בלי `API_DOCS_PASSWORD` כשהתיעוד דלוק | בסכמה | דרישה לסיסמה, גם כשהמפעיל כתב `false`, ראה E7 |
| פורט תפוס | `listen` | unhandled rejection בלי לוג מובנה |
| DB לא זמין | לא באתחול | ה pool עצל. התהליך עולה, `readyz` מחזיר 503 ונתיבים מחזירים 500 |

**שים לב.** משתני הסביבה שהקובץ קורא ישירות הם `TRUST_PROXY`, `CORS_ORIGINS`, `EXPOSE_API_DOCS`, `API_DOCS_PASSWORD`, `SESSION_COOKIE_NAME` ו `API_PORT`, ודרך הלוגר גם `LOG_LEVEL` ו `NODE_ENV`. כל middleware חדש נרשם כאן ב `app.use` לפני `listen`, ומיקומו ברשימה הוא מיקומו בשרשרת. תקרת גוף לפי נתיב, למשל 100kB גלובלי ו 16MiB רק להעלאת תמונות ב `MedModule`, דורשת פרסר נפרד שנרשם על הנתיב הספציפי לפני הפרסר הגלובלי. הזזת `enableCors` לפני `json` תחזיר כותרות CORS גם על 400 ו 413.

#### `apps/api/src/app.module.ts`
מודול השורש. דפוס P1, ומה ששונה הוא ה throttler וה providers הגלובליים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 36 עד 58 | הערות פתיחה. | מתיישנות. לא מזכירות את `ThrottlerGuard` ומונות רק ארבעה מודולים. |
| 59 עד 69 | `ThrottlerModule.forRootAsync` עם שני דליים בעלי שם, `default` לפי `RATE_LIMIT_PER_MINUTE`, ברירת מחדל 300, ו `auth` לפי `AUTH_RATE_LIMIT_PER_MINUTE`, ברירת מחדל 30, חלון של דקה, storage ב `Map` בזיכרון. | אין `@SkipThrottle({ auth: true })` בקוד, ולכן הדלי הצפוף `auth` חל על כל handler, והמפתח נפרד לכל handler ו IP. מפעיל שסורק יותר מ 30 פעמים בדקה, 10 לפי `.env.example`, מקבל 429. CI מסתיר זאת בערכים 5000 ו 20000. עם שני מופעים כל אחד סופר לבד. |
| 70 עד 91 | רשימת המודולים. `DbModule` ראשון, אחריו מודולי תשתית גלובליים, `PrcModule` ו `PayModule` שמספק את `BILLING_PORT`, ואז מודולי הפיצ׳רים. | הסדר קובע את סדר הנתיבים וה Swagger, לא את פתרון התלויות. מודול חדש שלא נוסף כאן לא יירשם, וגם הסכמה שלו חייבת להיכנס ל `schema/index.ts`. |
| 93 | `AppController`. | |
| 94 עד 102 | `APP_GUARD` שלוש פעמים, `ThrottlerGuard`, `SessionAuthGuard`, `RolesGuard`, ו `APP_INTERCEPTOR` של `AuditInterceptor`. רצים בסדר הרישום ויכולים להזריק שירותים. | opt out, נתיב ציבורי חייב `@Public()`. החלפת הסדר בין Throttler ל SessionAuth תאפשר להציף את טבלת ה sessions. |

**שים לב.** התיקון לדלי `auth` הוא להשאיר דלי אחד גלובלי ולשים `@Throttle` מקומי על `AuthController`, או `skipIf` שמדלג על `auth` כשאין לו metadata על ה handler. ה throttler רץ לפני האימות, ולכן גם בקשות שיידחו כלא מאומתות נספרות, אבל פרסר ה JSON ב `main.ts` כבר עשה את העבודה היקרה לפניו. guard שנרשם כאן, ולא ב `app.useGlobalGuards`, נוצר ב DI ולכן `SessionAuthGuard` מקבל את `SessionService` ואת `Reflector`. ה guards עצמם ו `AuditInterceptor` מוסברים בפרק של ACC ו SEC.

**שים לב.** קיצורי המודולים ברשימה. ACC חשבונות והזדהות, SEC הרשאות ו audit, NOT התראות, תוכן ו outbox, PRC תמחור, PAY ארנק, ledger וחיובים, CST משמורת, INV קליטה, מדפים וחבילות נכנסות, VLT הכספת של הלקוח, MED תמונות, MKT שוק וחנות, DIS תרומה, consignment, buyout ובקשות מותאמות, SHP משלוחים יוצאים ומכס, ESC escrow, ADM מסוף ניהול, SUP תמיכה, MEM מנויים.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/app.controller.ts` | שארית scaffold, `GET /api/v1` שמחזיר `{ service, status }`. אין עליו `@Public()`, ולכן אנונימי מקבל 401. בדיקת החיים האמיתית היא `/healthz`. נספר ב throttler. מחיקה בטוחה, אחרי וידוא שאף בדיקה לא פונה ל `/api/v1` ישירות. |

#### `apps/api/src/db/client.ts`
ה factory היחיד שפותח חיבור ל Postgres, ב API וב seed, ומגדיר את הטיפוס `Database` שכמעט כל שירות מקבל ב constructor. כ 68 קבצים תלויים בו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 13 | imports והערה על PgBouncer בפורט 6432. | PgBouncer במצב transaction, ולכן `SET` בלי `LOCAL`, advisory lock ברמת session ו `LISTEN` לא עובדים דרך `DATABASE_URL`. |
| 14 | `Database` הוא `NodePgDatabase<typeof schema>`. | גם `tx` בתוך `db.transaction` מקבל את הטיפוס הזה, ולכן אפשר להעביר transaction לכל פונקציה שמצפה ל `Database`. כך בנוי `BillingPort.charge`. `db.query.<table>` קיים רק לטבלאות שבאובייקט ה schema. |
| 16 עד 21 | `createDb` יוצר `Pool` עם `DATABASE_URL` בלבד ועוטף ב drizzle. מחזיר את ה pool ואת ה handle. | ברירות מחדל של pg. 10 חיבורים, המתנה אינסופית לחיבור, אין `statement_timeout`, ואין מאזין ל `error` של ה pool. restart של PgBouncer או Postgres יכול להפיל את התהליך, ועשר שאילתות תקועות מקפיאות את כל ה API. |

**שים לב.** הצורה המומלצת היא `new Pool({ connectionString, max, connectionTimeoutMillis, statement_timeout })` מתוך env, ו `pool.on('error')` שכותב ללוגר. `statement_timeout` ישפיע גם על ה seed, שמשתמש באותה פונקציה, ועל דוחות כבדים ב `adm.service.ts`. `max` מעל 20 בלי לשנות את `default_pool_size` של PgBouncer רק יעביר את התור ממקום למקום.

#### `apps/api/src/db/db.module.ts`
דפוס P1. מודול `@Global` שמספק את ה handle תחת `DRIZZLE`, וכל שירות מקבל אותו ב `@Inject(DRIZZLE)`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 7 | `DRIZZLE` הוא `Symbol`, כי `Database` הוא טיפוס שנמחק בזמן ריצה. | הסרת `@Global` תחייב להוסיף `DbModule` ל imports של כל מודול פיצ׳ר, אחרת האתחול נופל. |
| 13 עד 22 | `useFactory` קורא ל `createDb()` פעם אחת ומחזיר רק `.db`. pool אחד לכל התהליך. | ה pool נזרק, ולכן אין `pool.end()` ב shutdown ואין מדדים. התיקון הוא provider נוסף ל pool ו `onApplicationShutdown`. scope של `REQUEST` ייצור pool לכל בקשה. |

#### `apps/api/src/db/migrate.ts`
סקריפט עצמאי, לא חלק מתהליך ה API, שמריץ `db:migrate`. דפוס P6, וכאן המימוש עצמו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 21 | pool נפרד על `DIRECT_DATABASE_URL`. | DDL צריך session אמיתי, ה migrator של drizzle פותח transaction אחד לכל ה migrations הממתינות. |
| 23 | `migrate` של drizzle על `'./src/db/migrations'`. יוצר את `drizzle.__drizzle_migrations` אם חסרה, ומריץ כל migration שחותמת הזמן שלה ב `meta/_journal.json` מאוחרת מהאחרונה שהוחלה. | הנתיב יחסי ל cwd, עובד רק מתוך `apps/api`. migration עם חותמת מוקדמת, למשל ממיזוג branches, מדולגת בשקט. אין נעילה בין שתי הרצות מקבילות. |
| 25 עד 26 | קורא `sql/0001_append_only.sql` יחסית ל `__dirname` ומריץ אותו ב `pool.query` אחד, שרץ כ transaction מרומז אחד. הקובץ אידמפוטנטי. יוצר triggers של `BEFORE UPDATE OR DELETE` על עשר טבלאות היסטוריה, `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event`, `login_attempt`, חוסם `DELETE` על `item`, ויוצר role בשם `bault_app`. | E2. ב image, `dist/db/migrate.js` מוצא את ה migrations לפי cwd אבל לא את קובץ ה SQL לפי `__dirname`, ולכן המסד נוצר בלי triggers ויציאה עם ENOENT. ה triggers ברמת שורה, ולכן `TRUNCATE` לא נחסם וה seed נשען על זה. `bault_app` לא בשימוש, `DATABASE_URL` מתחבר כבעלים. טבלה היסטורית חדשה חייבת להיכנס למערכים בקובץ ה SQL. |
| 28 עד 37 | `pool.end()`, הדפסה, ובכישלון `process.exit(1)`. | |

**שים לב.** הזרימה לשינוי סכמה היא לשנות את קובץ ה `*.schema.ts`, לוודא שהוא מיוצא מ `schema/index.ts`, להריץ `db:generate`, לקרוא את ה SQL שנוצר תחת `src/db/migrations`, ואז `db:migrate`. אם הטבלה היסטורית, מוסיפים אותה גם ל `sql/0001_append_only.sql`. migration ידנית שאינה drizzle לא נרשמת בשום טבלה, היא רצה מחדש בכל הרצה ולכן חייבת להיות אידמפוטנטית.

#### `apps/api/src/db/schema/_helpers.ts`
בוני עמודות משותפים לכל קובצי `*.schema.ts`, דפוס P5. כל helper מחזיר builder חדש, כי builder של drizzle שומר מצב.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 | `pkId`, `uuid` עם `defaultRandom`. | `AllExceptionsFilter` מניח ש 22P02 הוא מזהה לא תקין, כי כל המפתחות UUID. |
| 15 עד 19 | `createdAt` ו `updatedAt`, `timestamptz` עם `defaultNow`. | `updatedAt` מתמלא רק ב insert. אין `$onUpdate` ואין trigger, update שלא מגדיר אותו משאיר ערך ישן. |
| 22 עד 25 | `amountMinor` כ `bigint` במצב `number`, ו `currency` כ `char(3)`. | כסף כמספר שלם בסנטים. `number` בטוח עד `Number.MAX_SAFE_INTEGER`, כ 90 טריליון דולר. מעבר ל `mode: 'bigint'` ישבור כל חשבון כסף ואת `money.ts`. |

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/db/schema/index.ts` | barrel של 24 קובצי סכמה, שתי האחרונות מ `shared`. ההערה אומרת שכל מודול נוגע רק בטבלאות שלו, אבל זו מוסכמה שאיש לא אוכף. drizzle ו drizzle-kit רואים רק מה שמיוצא כאן. קובץ שנשמט לא ייווצר כטבלה, ושורה שנמחקת תייצר `DROP TABLE` ב migration הבא. |
| `apps/api/src/shared/shared.module.ts` | דפוס P1. מודול `@Global` שמספק `IdempotencyService` ו `ConfirmationService`, שניהם תלויים רק ב `DRIZZLE`. הסרת `@Global` תפיל את האתחול בכל שירות שמזריק אותם. |

#### `apps/api/src/shared/adapters/adapters.module.ts`
נקודת החיבור לארבעה ספקים חיצוניים. דפוס P1 עם ארבעה providers של `useFactory`, ודפוס P11 לצד המימושים ב `@bault/adapters`. הקוד העסקי מכיר רק את הממשקים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 26 | ארבעה `Symbol`, `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER`, `STORAGE_ADAPTER`. | ההערה על Stripe ו ShipStation התיישנה. |
| 38 עד 49 | `createEmailAdapter`. `smtp` בונה `SmtpEmailAdapter`, אחרת `ConsoleEmailAdapter`. | ה console מדפיס כל הודעה ל stdout כולל קישורי אימות ואיפוס. אין כאן בדיקת production, ההגנה רק בסכמת ה env. ב staging שאינו production הקישורים בלוג. |
| 51 עד 105 | `createPaymentAdapter`. `paypal` בונה `PayPalPaymentAdapter` עם client id, secret, סביבה ו webhook id, אחרת sandbox, ואם `NODE_ENV=production` זורק. | הגנה כפולה בכוונה, גם בסכמה. ה sandbox אישר בעבר top up עם טוקן מזויף. |
| 107 עד 142 | `createShippingAdapter`. `easypost` עם `EASYPOST_API_KEY` ו `EASYPOST_BASE_URL`, ריק הופך ל `undefined`. production עם sandbox זורק. | ה worker לא משתמש במודול הזה, ולכן E17 קרה שם. |
| 144 עד 185 | `createStorageAdapter`. `s3` עם חמשת `STORAGE_*`. production עם sandbox זורק. | |
| 187 עד 197 | `@Global`, ארבעה providers ו exports. | כל factory רץ פעם אחת באתחול, שינוי env דורש restart. ספק חדש דורש enum בסכמה, מימוש ב `packages/adapters` וענף כאן. |

| token | בוחר לפי | צרכנים |
|---|---|---|
| `PAYMENT_ADAPTER` | `PAYMENT_PROVIDER`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`, `PAYPAL_WEBHOOK_ID` | `checkout.service.ts`, `topup.service.ts`, `withdrawal.service.ts`, `wallet-request.service.ts` ב PAY |
| `SHIPPING_ADAPTER` | `SHIPPING_PROVIDER`, `EASYPOST_API_KEY`, `EASYPOST_BASE_URL` | `dispatch.service.ts`, `shipment.service.ts` ב SHP |
| `EMAIL_ADAPTER` | `EMAIL_PROVIDER`, שישה `SMTP_*` | `verification.service.ts` ב ACC |
| `STORAGE_ADAPTER` | `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | `browse.service.ts` ב MKT, `media.service.ts` ב MED, `vault.service.ts` ב VLT |

#### `apps/api/src/shared/billing/billing.port.ts`
ה port שדרכו INV, DIS ו MKT מחייבים משתמש בלי לייבא את PAY, כדי למנוע תלות מעגלית. המימוש האמיתי נקשר ב `modules/pay/pay.module.ts` כ `useExisting: BillingService`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 44 | `BillableAction`. `userId`, `actionType` מתוך שבעה סוגים, `intake`, `storage`, `service`, `shipping`, `marketplace_fee`, `parcel_processing`, `parcel_forwarding`, ואופציונלית `itemId`, `itemClass`, `feeActionType` שהתמחור מנסה קודם, ו `metadata`. | `itemClass` נוסף כי כלל תמחור לפי סוג פריט לא היה נגיש. |
| 46 עד 51 | `BillingPort.charge(tx, action)` ו `BILLING_PORT`. | הפרמטר `tx` הוא כל הטעם. החיוב והפעולה העסקית נכתבים או מתבטלים יחד. הסרתו שוברת אטומיות. |
| 53 עד 66 | `NoopBillingAdapter` ו `BillingModule` גלובלי. | קוד מת. אם יתווסף ל `AppModule`, שני מודולים גלובליים יספקו את אותו token ופעולות בתשלום עלולות לעבור בחינם. למחוק. |

**שים לב.** `BILLING_PORT` מוזרק ב `dis/service.service.ts`, `inv/batch.service.ts`, `inv/intake.service.ts`, `inv/parcel.service.ts` ו `mkt/trade.service.ts`. שינוי חתימת `charge` מחייב שינוי ב `pay/billing.service.ts` ובחמשתם. סוג פעולה חדש נכנס גם ל union כאן וגם ככלל ב `pricing_rule`, אחרת התמחור ייפול לברירת מחדל.

#### `apps/api/src/shared/errors/app-error.ts`
השגיאה העסקית של הפרויקט. 61 קבצים זורקים אותה. קוד מכונה יציב, סטטוס, הודעה ופרטים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 17 | `AppError extends HttpException`. ה constructor שומר `code` ו `details` וקורא `super({ code, message, details }, status)`. | הגוף כבר מכיל `code`, ולכן ה filter מעביר אותו כמו שהוא. שינוי מבנה האובייקט יהפוך כל שגיאה עסקית ל `internal`. ה SPA מגיב לפי `code`. |
| 19 עד 52 | factories סטטיים. `validation` 400, `unauthenticated` 401, `forbidden` 403, `emailUnverified` ו `accountSuspended` 403 עם קוד משלהם, `tokenExpired` 410, `conflict` 409, `notFound` 404. | `emailUnverified` הוא הכישלון היחיד בהתחברות שהמשתמש מתקן בעצמו, וה SPA מציג לפיו כפתור שליחה מחדש. רוב הקוד קורא ל constructor ישירות עם 409. |

**שים לב.** קוד חדש נכנס קודם ל `error-codes.ts`, נזרק כ `new AppError(ErrorCode.X, message, status)`, ומתורגם ב SPA לפי הערך. הודעה היא לבני אדם באנגלית, וה SPA לא אמור להשוות אליה. `HttpException` רגיל בלי `code` עובר את ה filter עם `code` שנגזר מהסטטוס בלבד, ולכן כל שגיאה עסקית צריכה להיות `AppError`.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/shared/errors/error-codes.ts` | 19 קודים, בהם `item_on_hold`, `item_no_longer_available`, `self_dealing_forbidden`, `insufficient_balance`, `negative_balance_blocked`, `dual_consent_required` ו `confirmation_required`, כאובייקט `as const` וטיפוס union באותו שם. `IDEMPOTENCY_KEY_REUSED` לא נזרק באף מקום, `RATE_LIMITED` נוצר רק ב `mapStatus`. ה SPA לא מייבא את הקובץ, ולכן שינוי ערך שובר אותו בלי שגיאת קומפילציה. |

#### `apps/api/src/shared/errors/validation-error.ts`
ה `exceptionFactory` של ה `ValidationPipe`, נקרא רק מ `main.ts`. הופך את עץ השגיאות של class-validator למשפט אחד קריא ולרשימה ב `details.violations`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 49 עד 55 | `FieldViolation`, שדה בנתיב מנוקד, קוד אילוץ והודעה. | ה SPA מסמן שדות בטופס לפי הצורה הזו. שינוי שובר אותו ואת בדיקות ה contract. |
| 58 עד 68 | `flatten` עובר רקורסיבית על `children` ובונה נתיבים כמו `items.0.binId`. | |
| 77 עד 122 | `FIELD_NAMES` ו `humanField`. מילון חריגים, אחרת פיצול camelCase ו snake_case, ותוספת `(item N)` לאינדקס. | שדה עם שם לא קריא מתוקן בהוספה למילון. |
| 125 עד 146 | `MISSING_CONSTRAINTS` ו `TYPE_CONSTRAINTS`. | אילוץ טיפוס על ערך שלא נשלח נחשב חוסר. |
| 157 עד 192 | `restate` מנסח הפרה אחת. `each value in`, הודעה ידנית מוחזרת כמו שהיא, ואז ענפים לשדה לא מוכר, חסר, enum, `isPositive`, `isEmail`, `isUUID`. | באג. ההודעה על שדה לא מוכר מתחילה ב `property`, ולכן שורה 164 מסווגת אותה כידנית, והענף של `whitelistValidation` בשורה 167 לא מושג. התיקון הוא להקדים את בדיקת `whitelistValidation`. |
| 202 עד 287 | `summarise` בונה משפט אחד. מקבץ לפי שדה, חסר גובר על שגוי, פסוקית לחסרים ולא מוכרים, ועד שלושה שגויים. | מסווג לפי קוד ולא לפי הודעה, ולכן כאן שדה לא מוכר יוצא נכון. |
| 289 עד 318 | `validationException` בונה מפה מנתיב לערך שנשלח כדי לדעת אם שדה נוכח, ומחזיר `BadRequestException` עם `code: validation_failed`, המשפט וההפרות. | ההודעות לא כוללות את הערך שנשלח. ערכי enum נחשפים בכוונה. שדרוג class-validator ישנה ניסוחים בשקט. |

דוגמה לגוף שיוצא כשחסרים שני שדות ונשלח שדה לא מוכר אחד.

```json
{"error":{"code":"validation_failed","message":"Item id, bin id are required; extra is not a field this accepts.","details":{"violations":[{"field":"itemId","code":"isUuid","message":"item id is required."},"..."]}}}
```

**שים לב.** הודעה ידנית ב DTO, כמו `@IsIn(..., { message })`, לא מתחילה בשם השדה ולכן עוברת כמו שהיא. זו הדרך לתת לשדה מסוים ניסוח משלו. בתשובה אחת מוצגים עד שלושה שדות שגויים, ו `details.violations` תמיד מכיל את כולם.

#### `apps/api/src/shared/errors/all-exceptions.filter.ts`
ה filter הגלובלי, נרשם ב `main.ts` עם `new`. כל חריגה מכל שלב, כולל middleware של Express, יוצאת כ `{ error: { code, message, details } }`. `requestId` לא בגוף, הלקוח מוצא אותו בכותרת `x-request-id` ולפיו מחפשים בלוג.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 22 | `@Catch()` בלי ארגומנטים ו `Logger('Exceptions')`. | ההקשר נכתב בשדה `detail` של הלוג, לא ב `context`. |
| 27 עד 47 | `HttpException`. גוף עם `code` עובר כמו שהוא. אחרת `code` מ `mapStatus`, הודעה מ `exception.message`, ו 429 עם הודעה קבועה. | אין לוג בענף הזה, גם ל 5xx. גוף בלי `code` נזרק, ולכן ה 503 של `readyz` מאבד את גופו. 404 של Nest משקף את הנתיב המלא כולל query string. |
| 49 עד 79 | שגיאת Postgres `22P02` הופכת ל 400 על מזהה לא תקין, עם `warn`. תחליף ל `ParseUUIDPipe`, כי יש נתיבים שמקבלים ברקוד. | גם enum, מספר או JSON לא תקינים יקבלו את ההודעה הזו. הלוג כולל את הערך שהמשתמש שלח. |
| 81 עד 99 | `statusOf` מוצא `status` או `statusCode` בטווח 4xx, למשל 413 או 400 מ body-parser. מחזיר את אותו סטטוס עם הודעה כללית ו `warn`. | כל שגיאה של ספרייה עם `status` של 4xx, למשל adapter שמעביר 401 של ספק, תוחזר ללקוח כשגיאת לקוח. |
| 101 עד 106 | כל השאר. `error` עם stack מלא, ללקוח 500 עם `Internal server error` בלבד. | הודעות pg בלוג בלי ערכים, כי drizzle 0.38 לא מוסיף SQL ופרמטרים. |
| 108 עד 117 | `mapStatus`. 401, 403, 404, 409, 400 ו 429 לקודים התואמים. 413 ל `validation_failed`, כל לא מוכר, כולל 410, 422 ו 503, ל `internal`. | |
| 125 עד 148 | `isInvalidTextRepresentation` בודק `exception.code` ישירות, `statusOf`, `describe`. | שדרוג drizzle, שנדרש בגלל E12, עוטף ב `DrizzleQueryError`. אז 22P02 יהפוך ל 500 בשקט וה SQL והפרמטרים ייכנסו ללוג. צריך לבדוק גם `exception.cause?.code`. |

מה הלקוח מקבל, לפי סוג החריגה.

| נזרק | סטטוס ו `code` | לוג |
|---|---|---|
| `AppError` או `validationException` | הסטטוס שלהם והגוף כמו שהוא | אין |
| `HttpException` של Nest בלי `code`, כולל 404 על נתיב לא קיים | הסטטוס, `code` מ `mapStatus`, ההודעה של Nest | אין, גם ב 5xx |
| `ThrottlerException` | 429, `rate_limited`, הודעה קבועה | אין |
| `ServiceUnavailableException` של `readyz` | 503, `internal`, `Service Unavailable Exception` | אין |
| pg `22P02` | 400, `validation_failed`, מזהה לא תקין | `warn` עם הודעת pg |
| `PayloadTooLargeError` או JSON שבור | 413 או 400, הודעה כללית | `warn` |
| כל השאר, כולל שגיאות pg אחרות ו `Error` של `money.ts` | 500, `internal`, `Internal server error` | `error` עם stack |

#### `apps/api/src/shared/tokens.ts`
טוקנים אטומים לאימות אימייל, איפוס סיסמה, sessions ואתגרי אישור. צרכנים ב `verification.service.ts`, `session.service.ts`, `password.service.ts` ו `confirmation.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 11 | `generateToken` מחזיר 32 בתים מ `randomBytes` כ hex, 256 ביט. | הטוקן הגולמי יוצא ללקוח פעם אחת ולא נשמר. |
| 13 עד 15 | `hashToken` מחזיר SHA-256 ב hex. | בלי salt, וזה תקין כי הקלט אקראי. החיפוש נעשה ב SQL לפי ה hash, ותזמון שלו לא חושף את הטוקן. שינוי האלגוריתם מבטל מיד כל session וטוקן פעיל. |
| 18 עד 22 | `verifyToken` משווה בזמן קבוע. | אף קורא, מחיקה בטוחה. |

#### `apps/api/src/shared/confirmation/confirmation.schema.ts`
דפוס P5. טבלת `confirmation_token`, נוצרה ב `0000_natural_stryfe.sql`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 18 | `id`, `userId` כ text, `action` חופשי כמו `withdrawal`, `tokenHash` של SHA-256, `payload` ב jsonb עם פרמטרי הפעולה, `expiresAt` חובה, `consumedAt` ו `createdAt`. | `userId` בלי FK, כך שאין שלמות הפניה. אין אינדקס על `token_hash` או `user_id`, ולכן `consume` סורק את כל הטבלה, ואין job שמנקה שורות שפגו. אינדקס ייחודי על `token_hash` בטוח ומומלץ. |

#### `apps/api/src/shared/confirmation/confirmation.service.ts`
אישור דו שלבי לפעולות בלתי הפיכות. צרכנים ב `withdrawal.service.ts`, `donation.service.ts`, `disposal-services.service.ts`, `listing.service.ts` ו `trade.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 38 | `issue` מייצר טוקן, שומר hash, payload ותפוגה של 300 שניות כברירת מחדל, ומחזיר את הטוקן הגולמי. | כותב ב `this.db` ולא ב transaction של הקורא, והאתגר נשמר גם אם הקורא נכשל. |
| 40 עד 55 | `consume` מחפש שורה לפי `userId`, `action` ו hash. | התנאים מונעים שימוש באתגר של משתמש אחר או של פעולה אחרת. |
| 57 עד 62 | אין שורה מחזיר 400 עם `CONFIRMATION_REQUIRED`. נוצלה או פגה מחזיר 410. | |
| 64 עד 72 | מעדכן `consumedAt` לפי `id` ומחזיר את ה payload השמור. | race. הקריאה והעדכון הן שתי שאילתות, בלי transaction ובלי `consumed_at IS NULL`. שתי בקשות מקבילות מקבלות את ה payload. ההערה קוראת לזה guarded UPDATE ואין guard. תיקון, `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING payload`. |

התיקון ל race, בשאילתה אחת.

```sql
UPDATE confirmation_token SET consumed_at = now()
WHERE user_id = $1 AND action = $2 AND token_hash = $3
  AND consumed_at IS NULL AND expires_at > now()
RETURNING payload;
```

אם לא חזרה שורה, מבחינים בין 400 ל 410 בשאילתה נוספת, שכבר אינה מסוכנת. רצוי להריץ את זה בתוך ה transaction של הקורא, ואז כישלון של הפעולה מחזיר את הטוקן לשימוש.

**שים לב.** שש פעולות משתמשות בו, כל אחת עם שם `action` משלה. `withdrawal` עם סכום, מטבע ויעד, `donation` עם `itemId`, `deslab` ו `remove_commons` ב DIS, `listing_removal` ו `transfer` ב MKT. כל צרכן חושף שני נתיבים, אחד שקורא ל `issue` ומחזיר טוקן, ואחד שמקבל את הטוקן, קורא ל `consume` ומבצע. ב `withdrawal.service.ts` ה `consume` רץ מחוץ ל transaction שבודק יתרה, ולכן ה race כאן מגיע עד הכסף אם בדיקת היתרה שם לא נועלת.

**שים לב.** הפעולה מתבצעת על ה payload ששמור בשרת ולא על מה שהלקוח שולח בשלב השני. כש `consume` רץ מחוץ ל transaction של הקורא, כישלון אחריו שורף את הטוקן והמשתמש מתחיל מחדש.

#### `apps/api/src/shared/idempotency/idempotency.schema.ts`
דפוס P5. טבלת `idempotency_key`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 21 | `key` מהלקוח, `userId` כ text שיכול להיות ריק, `endpoint` שהקורא בונה, `statusCode` ו `responseBody` של התשובה השמורה, `createdAt`, `expiresAt` חובה. | `statusCode` ו `responseBody` nullable, כאילו תוכנן placeholder לפני ביצוע, אבל השירות לא עובד כך. |
| 22 עד 25 | אינדקס ייחודי `idempotency_key_endpoint_unique` על `key` ו `endpoint`. | בלי `user_id`, וזה הבסיס לדליפה בין משתמשים. הוספת `user_id` דורשת migration ושינוי ה `onConflictDoNothing` בשירות. |

#### `apps/api/src/shared/idempotency/idempotency.service.ts`
שתי פעולות שהקורא עוטף סביב פעולה שאסור לבצע פעמיים. צרכנים יחידים, `purchase.service.ts` ו `house-store.service.ts` ב MKT.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 23 עד 31 | `lookup` לפי `key` ו `endpoint`. מחזיר סטטוס וגוף, או `null`. | לא מסנן לפי משתמש, לא בודק `expiresAt` ולא משווה את גוף הבקשה. משתמש אחר עם אותו מפתח מקבל את התשובה של הראשון והפעולה שלו לא מתבצעת. |
| 33 עד 45 | `save` מקבל מפתח, endpoint, `userId`, סטטוס וגוף, ומכניס שורה עם תפוגה של 24 שעות ו `onConflictDoNothing`. | שמירה שנייה נבלעת בשקט. `userId` נשמר אבל אף שאילתה לא קוראת אותו, ולכן הוספתו ל `lookup` היא שינוי מקומי שלא שובר צרכנים. |

**שים לב.** המפתח מגיע בכותרת `idempotency-key`, שנקראת ב `mkt.controller.ts`, `offer.controller.ts` ו `house-store.controller.ts`. `purchase.service.ts` קורא ל `lookup` בשורה 72 ול `save` בשורה 180, `house-store.service.ts` בשורות 163 ו 265. התשובה נשמרת עם סטטוס 201 והגוף המלא, ו replay מחזיר אותם כמו שהם.

**שים לב.** הזרימה אצל הקורא היא `lookup`, transaction שמבצע, ורק אחרי ה commit `save`. זה מגן מפני retry אחרי שהבקשה הראשונה הסתיימה, לא מפני כפילות במקביל. ב `purchase.service.ts` נעילת ה listing מצילה, הבקשה השנייה מקבלת 409. ב `house-store.service.ts` שתי בקשות מקבילות עם אותו מפתח קונות שני עותקים ומחויבות פעמיים, ולקוח בלי כותרת מקבל מפתח אקראי, כלומר בלי הגנה. התיקון הוא לתפוס את המפתח ב `INSERT ... ON CONFLICT DO NOTHING RETURNING` בתוך ה transaction של הפעולה, עם `user_id` ו hash של הגוף, ולשמור את התשובה באותו transaction. אם ה insert לא החזיר שורה, הבקשה השנייה ממתינה לנעילת השורה ומחזירה את התשובה השמורה, או 409 עם `IDEMPOTENCY_KEY_REUSED` כשהגוף שונה. בדיקת תפוגה ב `lookup` מחייבת גם job שמנקה את הטבלה.

#### `apps/api/src/shared/ids.ts`
מזהים קריאים עם קידומת, כמו `SHP-7KQ2M9XA`, שמודפסים על מדבקות ומוקלדים במחסן, לצד ה UUID. 20 קבצים משתמשים בו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 14 עד 17 | הערה ו `ALPHABET` של 32 תווים בלי `0`, `O`, `1`, `I`. | ההערה אומרת שהקוראים מנסים שוב בהתנגשות. אין קורא כזה, והתנגשות תהיה 500. ההסתברות זניחה. |
| 19 עד 23 | `prefixedId` בוחר תווים ב `randomInt` קריפטוגרפי, 8 כברירת מחדל. | שינוי אורך או אלפבית שובר ולידציה בצד לקוח ובסורקים. |
| 25 עד 48 | `ID_PREFIX`, 16 קידומות `as const`, ו `newShipmentCode`. `OW` בעלים, `SN` פריט, `BIN` מדף, `SHP` משלוח, `SR` בקשת שירות, `DSP` מחלוקת, `LOT` מנת קליטה, `TXN` עסקה, `DSL` השמדה, `PKG` חבילה, `TKT` פנייה, `GSB` הגשת grading, `GRP` משלוח משותף, `ESC` escrow, `HSE` מוצר חנות, `ORD` הזמנה. | המספר הסידורי של פריט נוצר ב `modules/inv/labels.ts`, לא כאן. `OW` משמש רק ב seed. |

**שים לב.** מזהים אקראיים ולא מונה רץ, כך שאי אפשר להסיק מהם כמה משלוחים או פניות יש במערכת. שינוי קידומת קיימת שובר חיפוש לפי קידומת ב SPA ובמסוף הניהול.

#### `apps/api/src/shared/money.ts`
עזרי כסף. מספר שלם ביחידות קטנות ומטבע מפורש. 16 קבצים, בעיקר PAY, PRC, MKT, SHP, ESC ו DIS.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 20 | `Money` ו `money`, זורק אם הסכום לא שלם, מעלה את המטבע לאותיות גדולות. | `Number.isInteger` דוחה גם `NaN` ו `Infinity`. סכום מ DB מגיע כ `number` בגלל `amountMinor`, ולכן אפשר להעביר אותו ישר. |
| 22 עד 38 | `zero`, `assertSameCurrency`, `add`, `subtract`. ערבוב מטבעות זורק `Error` רגיל, כלומר 500. | נכון, זה באג קוד. |
| 44 עד 46 | `applyBasisPoints` מחשב `amount * bps / 10000` ומעגל עם `Math.round`. כך מחושבת למשל עמלת שוק של 500 bps. | עיגול חצי כלפי מעלה. מעבר לעיגול בנקאי ישנה עמלות ב `pricing.service.ts` בסנט. |
| 48 עד 53 | `isNegative` ו `sum`, שמקפל עם `add` ולכן זורק על פריט במטבע אחר. | |
| 71 עד 76 | `formatMinor` הופך סנטים ל `$41.37`. | לא בודק שהקלט שלם, `formatMinor(10.5)` מחזיר `$0.10` בשקט. |

**שים לב.** רוב הקוד עובד עם `number` ישירות, ו `ledger.service.ts` מחשב יתרה ב SQL. ההגנה מפני ערבוב מטבעות חלה רק איפה שבוחרים בה.

#### `apps/api/src/shared/names.ts`
הכללים לשם משתמש קבוע ולשם פרטי ומשפחה. אין שם תצוגה שלישי. 14 קבצים ב API.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 43 | `USERNAME_PATTERN`, אורך 3 עד 32, `normalizeUsername` חותך ומוריד לאותיות קטנות, `isValidUsername` מניח קלט מנורמל. קוראים ל `normalizeUsername` ב `auth.service.ts`, בשירותי הקליטה, החבילות וההשמדה של INV וב `market-read.service.ts`. נקודת כניסה חדשה שמחפשת לפי שם משתמש חייבת לנרמל לפני השאילתה. | עותק נפרד ב `apps/web/src/shared/names.ts` וגם ב `RegisterDto`. שינוי רק כאן ייצור טופס שמאשר שם שהשרת דוחה. האינדקס הייחודי נשען על הנרמול. |
| 46 עד 64 | `normalizeNamePart` מכווץ רווחים. `isValidNamePart` דוחה ריק, מעל 80, `<`, `>` ותווי בקרה עד `\u001f`. | לא חוסם `\u007f`, C1 ותווי כיווניות שמשבשים תצוגה ברשימות ובמדבקות. |
| 70 עד 72 | `fullName` מחבר ומדלג על ריקים. | |
| 74 עד 104 | `LegacyNameSplit` ו `splitLegacyDisplayName`. | קוד מת, אף קורא ואף בדיקה. |

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/shared/fixtures.ts` | `FIXTURE_EMAIL_DOMAIN` הוא `fixture.bault.test`, שמסוף הניהול ב `adm.service.ts` מסתיר. הערך משוכפל ב `tests/integration/helpers/http.ts` וב `shelf-yield.service.ts`. `isFixtureEmail` לא בשימוש. שינוי הערך רק כאן יחזיר את חשבונות הבדיקה לרשימות ולדוחות. משתמש אמיתי שנרשם בדומיין הזה ייעלם מהרשימה, אבל לא יוכל לאמת כתובת. |

#### `apps/api/src/shared/observability/logger.ts`
שני חלקים. `requestContext` הוא middleware של Express שמצמיד מזהה לכל בקשה ב `AsyncLocalStorage`. `StructuredLogger` הוא ה `LoggerService` של Nest, שורת JSON אחת לכל אירוע. נצרך רק ב `main.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 28 | ארבע רמות מספריות. `verbose` ממופה ל `debug`. | |
| 37 עד 39 | `context`, מופע יחיד של `AsyncLocalStorage`, ו `currentRequestId`. | כל קוד אסינכרוני שהתחיל בתוך `context.run` רואה את המזהה גם אחרי `await`. `currentRequestId` לא מיובא מחוץ לקובץ. |
| 49 עד 55 | `requestContext` לוקח `x-request-id` מהלקוח עד 200 תווים, או UUID, מחזיר אותו בכותרת ומריץ `next` בתוך `context.run`. | המזהה מהלקוח לא נבדק. מול פורט חשוף אפשר לזהם קורלציה. מאחורי nginx הוא נדרס ב `$request_id`. |
| 58 עד 65 | `Line`, הצורה של שורת לוג. | |
| 67 עד 77 | constructor קורא `LOG_LEVEL`, ברירת מחדל `info`. JSON בכל סביבה שאינה `development`, כולל `test`, כדי ש CI ידפיס מה ש production מדפיס. מופע יחיד נוצר ב `main.ts` עם scope `api`. | בגלל ה scope הקבוע, `context` תמיד `api`. |
| 79 עד 95 | `write` מסנן לפי רמה, מוסיף `requestId` ו `context`, ופורס `extra` מ `meta` אחרון. `warn` ו `error` ל stderr. | `extra` מכיל רק `detail` ו `data`, ולכן לא דורס `level` או `time`. `stream.write` לא חוסם, ולוג ענק נאגר בזיכרון עד שהצינור מתרוקן. |
| 97 עד 112 | חמש מתודות `LoggerService`. `log` הוא `info`. | |
| 118 עד 125 | `meta` אוסף מחרוזות ל `detail` ואובייקטים ל `data`. | כל אובייקט נכתב במלואו, בלי הסתרה. היום אף קוד לא מעביר PII. |
| 127 עד 134 | `safeString`. `Error` לשם והודעה בלי stack, אחר ל `JSON.stringify`. | |
| 137 עד 143 | `humanLine`, שורה קריאה בפיתוח עם שמונה תווים מהמזהה. | ההערה מבטיחה צבע, אין. |

שורת לוג טיפוסית ב production נראית כך.

```json
{"level":"warn","time":"2026-01-01T10:00:00.000Z","message":"...","requestId":"3f1c...","context":"api","detail":"Exceptions"}
```

**שים לב.** אין שורת גישה לכל בקשה, בלי method, path, status ומשך. בפועל רק `AllExceptionsFilter` כותב דרך הלוגר. הוספה פשוטה היא `res.on('finish')` בתוך `requestContext`, בלי לכתוב query string שעלול להכיל טוקנים. `auth.service.ts` ו `ConsoleEmailAdapter` כותבים ישר ל console ועוקפים את הלוגר. שירות שרוצה לכתוב לוג משתמש ב `new Logger('Name')` מ `@nestjs/common`, שעובר דרך `StructuredLogger` ומקבל את `requestId` לבד, ולא ב `console`.

#### `apps/api/src/shared/observability/health.controller.ts`
דפוס P2, שני נתיבים, שניהם `@Public()`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 28 | `live`, `GET /api/v1/healthz`, מחזיר `{ status: 'ok' }` בלי בדיקה. | זה מה שה `HEALTHCHECK` ב Dockerfile, `scripts/dev.mjs` ו `scripts/tunnel.mjs` בודקים. liveness לא נוגע ב DB בכוונה, אחרת תקלה ב DB תגרום ל restart של כל המופעים. |
| 30 עד 49 | `ready`, `GET /api/v1/readyz`, מריץ `select 1`, ובכישלון `ServiceUnavailableException`, כלומר 503. | ה filter מוחק את הגוף ומחזיר `internal`, בניגוד להערה. לא בודק שה migrations הוחלו ואין timeout, כך ש pool מלא תוקע את ה probe. |

**שים לב.** שני הנתיבים עוברים דרך `ThrottlerGuard` והדלי `auth`. probe כל 5 שניות מאותה כתובת יקבל 429. `@SkipThrottle()` על המחלקה פותר. כדי ש `readyz` יבדוק גרסה, משווים את הרשומה האחרונה ב `drizzle.__drizzle_migrations` מול ה journal, ומוסיפים `statement_timeout` קצר לשאילתה. כדי שהגוף ישרוד את ה filter, צריך לזרוק אותו עם `code`. הסרת `@Public()` תחזיר את הבאג שבו כל probe קיבל 401.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/shared/observability/observability.module.ts` | דפוס P1, רושם את `HealthController` בלבד. ההערה טוענת ש Sentry מחובר מ `SENTRY_DSN`, אבל אין קוד Sentry ואין תלות. המשתנה מוגדר בסכמה ולא משמש לכלום. מימוש דורש תלות, `Sentry.init` לפני `NestFactory.create` ו `captureException` בענף ה 500 של ה filter. |

#### `apps/api/src/db/seed.ts`
כ 1,700 שורות שמוחקות את כל נתוני האפליקציה ובונות עולם דוגמה. שלושה תפקידים בקובץ אחד. נתוני דמו לכל מסך ב SPA, מנגנון האיפוס של המסד אחרי בדיקות, והמקום היחיד בריפו שמגדיר מחירון ומתקנים. מריצים אותו `db:seed`, `db:reset`, `scripts/test.mjs` בסוף כל ריצה, ו CI לפני הבדיקות. הוא כותב ישירות דרך drizzle ועוקף את כל השירותים, ולכן כל אינווריאנט שהשירותים אוכפים משוחזר כאן ידנית. מתחבר דרך `DATABASE_URL`, לא דרך החיבור הישיר.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 31 | imports של 37 טבלאות, `MEMBERSHIP_TIERS`, `prefixedId`, `ID_PREFIX`, `makeBinSerial`, `makeBinBarcode`. | רשימת הטבלאות כאן היא מה שנכתב, לא מה שנמחק. |
| 33 עד 63 | הערת פתיחה. איפוס עוקף triggers, לפיתוח בלבד, נתונים עקביים מעצם הבנייה. | האזהרה על production היא הערה בלבד. טענת העקביות לא מתקיימת ב escrow וב `dana`. |
| 65 עד 70 | `one` מחזיר את השורה הראשונה מ `returning()` או זורק. | קיים בגלל `noUncheckedIndexedAccess`. עדיף על `rows[0]!`. |
| 72 עד 78 | `createDb()`, `CUR = 'USD'`, ו hash יחיד של `11111111` ב argon2id לכל החשבונות. | אותו salt לכולם, ברור מיד מהטבלה שהסיסמה משותפת. |
| 80 עד 99 | `TRUNCATE ... RESTART IDENTITY` אחד על 48 טבלאות, ב `pool.query`. | הפתח היחיד לאיפוס, כי ה triggers ברמת שורה. `parcel_photo` חסרה, בלי FK, ולכן נשארות שאריות. טבלה חדשה עם FK שלא תיכנס כאן תפיל את ה seed. נועל `ACCESS EXCLUSIVE`. עושה commit מיד. `RESTART IDENTITY` לא עושה כלום, כל המפתחות UUID. דורש הרשאת בעלים. אילו `DATABASE_URL` היה מתחבר כ `bault_app`, הפקודה הייתה נכשלת, וזו הייתה הגנה טבעית מפני E11. |
| 100 עד 123 | בלוק `DO` שמרוקן `pgboss.job` ו `pgboss.archive` רק אם הסכמה `pgboss` קיימת. | לא נוגע ב `queue`, `schedule`, `subscription`, `version`, שבלעדיהם ה worker לא עולה. |
| 125 עד 166 | `mkUser` מכניס `user_account` במצב `active` עם ה hash המשותף. `legacy` יוצר חשבון ישן עם `intakeId`, `nameReviewRequired` ו `legacyDisplayName`. | `username` לא ניתן לשינוי אחר כך, trigger מ migration 0004. |
| 168 עד 198 | שישה חשבונות. `veteran` נוצר עם `legacy`, כלומר `intakeId` מסוג `OW` ושם שמסומן לבדיקה. `eldar` admin, `hermon` warehouse_operator, `red`, `golden` ו `veteran` משתמשים, `platform` admin. | `platform` נוצר כ `admin` אף שההערה אומרת `system`. בכל סביבה מוזרעת יש שני מנהלים עם סיסמה ידועה. |
| 200 עד 551 | מערך `rules` של 42 כללי תמחור ולולאה שמכניסה ל `pricing_rule` עם `updatedBy: eldar`. intake כללי ולפי `itemClass`, `intake_lot`, אחסון עם `parameters` שה worker קורא, `service`, `shipping`, `marketplace_fee` של 500 bps, consignment, grading, service fees, rush, cash out, chargeback, escrow, white glove, מנויים מ `MEMBERSHIP_TIERS`, חבילות. | E6. בלי seed אין מחירים. `value` הוא סנטים או bps לפי `model`, ואין עמודת יחידה. כלל חדש נכנס כאובייקט עם `actionType` ייחודי. בסביבה חיה משנים מחיר דרך מסוף הניהול, לא כאן. |
| 553 עד 604 | שני מתקנים. `NJ` עם `salesTaxBps: 6625`, ו `DE` שמעביר ל `NJ` אחרי 4 ימים. | כתובות placeholder ומיקוד `00000`, ומוצגות ללקוח כיעד משלוח. seed בסביבה אמיתית ידרוס כתובות אמיתיות. |
| 606 עד 640 | `mkBin` עם `makeBinSerial` ו `makeBinBarcode`, שישה מדפים. A1, A2, B1, B2 ושניים באזור `O` עם `oversized`. | `binIds` בבדיקות זורק אם יש פחות משניים. בלי oversized ה stow לא יודע לאן לשלוח פריט גדול. |
| 642 עד 653 | קבועי כסף בסנטים, `INTAKE` 500, `SERVICE` 2000, `SHIP` 3500, `MEGA_SALE` 26000, `FEE` 1300 שהם 5 אחוז ממנו, מחיר ה Gold Star 320000 וההצעה 275000, `TOPUP` 500000, `WITHDRAW` 100000. | הקבועים לא נקראים מהמחירון. שינוי כלל תמחור לא משנה אותם, ולהפך. |
| 655 עד 721 | עוזרים. `ledger` מכניס `ledger_record`. `bill` מדמה את `BillingService`, `charge` במצב `settled` עם snapshot מדומה ושורת `fee` או `service_charge`. `topup` מכניס `external_payment` של sandbox ו `credit_topup`. `mkItem`, `custody`, `transfer`, `img`. | `type as never` משתיק בדיקת enum, טעות כתיב נכשלת רק בזמן ריצה. `topup` הוא מסלול שהאפליקציה כבר לא מייצרת, היום כסף נכנס רק דרך בקשת ארנק. ה snapshot המדומה של `bill` אומר שמסך שמציג איזה כלל חייב לא ימצא פרטים אמיתיים. `mkItem` קובע `receivedAt` לזמן הריצה. |
| 723 עד 949 | שני topup של 5000 דולר, ותשעה קלפים. לכל קלף `mkItem`, אירוע `intake` או `batch_split`, `bin_transfer`, תמונה ו `bill`. ביניהם listing של Gold Star עם הצעה, batch מפוצל, בקשת grading, משלוח DHL, מכירה של `SN-ROS105-0008` מ golden ל red. שלושה מוצרי `house_listing` עם `stock` 3, 2 ו 1. | ה `serialNumber` הוא שם קובץ התמונה תחת `assets/images`. המכירה כותבת `purchase`, `sale_credit` ו `fee` ישירות בלי `charge`. כל הקלפים `Raw`, בלי מספר תעודה מומצא. |
| 950 עד 1108 | הצעת החלפה ממתינה בין red ל golden, משיכה של 1000 דולר מ golden במצב `paid` עם יעד מוסתר ושורת ledger, כדי שסוג ההפניה `withdrawal` יהיה מגובה בשורה אמיתית, וארבע בקשות ארנק עם שרשרת `wallet_request_event`. cash_in submitted, cash_out processing, cash_out rejected, cash_in completed עם `credit_topup`. | ה `UPDATE` היחיד על `wallet_request` בשורות 1102 עד 1105 מקשר `settledLedgerId`. בבקשה המושלמת האירועים מדלגים על `pending_review`. |
| 1110 עד 1225 | מחלוקת במצב `investigating` על עסקת המכירה, שלוש שורות `audit_record` שמדמות את `AuditInterceptor`, שתי `outbox_message` מסוג `item_received` ו `offer_received`, שלוש התראות מנוסחות, העדפה של golden לכבות `hold_placed`, כתובות משלוח, ושתי תערוכות ב `consignment_event` שערוץ ה consignment צריך כדי לא לסרב. `days(n)` קדימה ו `minutes(n)` אחורה. | worker שעולה אחרי seed יעבד את ה outbox כאילו נוצר עכשיו. התאריכים יחסיים לזמן הריצה. |
| 1226 עד 1312 | מצבי קצה שמסכים צריכים לדעת לצייר. קלף תשיעי במצב `donated` שנשאר על B1, עם בקשת תרומה שהושלמה, העברת בעלות מ red ל `platform` ושינוי מצב. אחר כך `holdFlag` על הקלף שנמכר יחד עם אירוע `hold_placed` עם סיבה. | הדגל והאירוע חייבים לבוא יחד, השאילתה מסננת לפי הדגל והמרשם מציג את האירוע. עדכון `item` מותר כי ה trigger עליה חוסם רק `DELETE`. הקלף שנשלח הביתה לא מופיע בהיסטוריה של הלקוח בגלל באג ב `VaultService.listHistory`, וה seed לא מסתיר אותו. |
| 1314 עד 1325 | `dana` נוצרת ומעודכנת ל `suspended`. | אין לה חוב ואין `auto_suspended_at`, ולכן `wallet-suspension.ts` לא יחזיר אותה לעולם. מצב שהמערכת לא מייצרת. |
| 1327 עד 1419 | `mkTicket` מחשב `lastMessageAt` מההודעות, ממלא `resolvedAt` ו `resolvedBy` במצב resolved, ומכניס `support_message` עם זמנים בעבר. שלוש פניות, של dana במצב open, של red על הקלף שנמכר במצב awaiting_customer, ושל golden על חיוב במצב resolved. | פניית red אומרת שהיא פתחה את המחלוקת, בעוד שהמחלוקת נפתחה על ידי `eldar`. אי התאמה קטנה בדמו. |
| 1420 עד 1548 | `mkParcel` מכניס `parcel` ואת שרשרת `parcel_event` שלו. שלוש חבילות, של red במצב expected, של golden במצב received ובינלאומית, ואחת שממוענת ל `r.ashwod` במצב unclaimed בלי בעלים. אחר כך `arrival_disposal` של סוללת ליתיום. | החבילה ל `r.ashwod` לא משויכת ל red בכוונה, ההערה אומרת שאסור לנחש בעלים לפי שם דומה. `parcel_event` ו `arrival_disposal` הן append only, ולכן נכתבות כאן רק ב insert. |
| 1549 עד 1601 | שלוש בקשות `custom`, השלב ב `typeFields.stage` חופשי. | Postgres לא אוכף את ערכי השלב. |
| 1602 עד 1640 | עסקת escrow במצב `inspecting`, golden מוכר ל red, 145000 סנט ועמלה 2500, `fundingSource: 'wallet'`, וארבעה `escrow_event`. | אין שורת `escrow_hold`. שחרור מזכה את golden והחזר מזכה את red בלי חיוב מקביל, כסף יש מאין. התיקון הוא שורת hold על red או מימון דרך השירות. |
| 1642 עד 1678 | `pool.end()`, הדפסת סיכום, ו `main().catch` עם `process.exit(1)`. | הספירה מתיישנת, 2 כתובות ורשימת usernames בלי `platform` ו `dana`. |

החשבונות. לכולם הסיסמה `11111111`.

| אימייל | role | מצב | שימוש |
|---|---|---|---|
| `eldar@bault.dev` | `admin` | active | `SEED.admin` בבדיקות. מאשר בקשות ארנק, פותח את המחלוקת, בעל כללי התמחור. |
| `hermon@bault.dev` | `warehouse_operator` | active | `SEED.operator`. מבצע כל intake, העברת מדף, משלוח וקבלת חבילה. |
| `red@bault.dev` | `user` | active | `SEED.collector`. ה SPA ממלא אותו מראש בפיתוח. |
| `golden@bault.dev` | `user` | active | `SEED.collector2`. מוכר במכירה וב escrow. |
| `veteran@bault.dev` | `user` | active | `SEED.collector3`. חשבון ישן מדומה, שם פרטי `Ana Maria van der Berg` בלי שם משפחה, מסומן לבדיקת שם. |
| `platform@bault.dev` | `admin` | active | האפוטרופוס שמקבל פריטים שנתרמו. לא מוזכר ב SPA ובבדיקות. |
| `dana@bault.dev` | `user` | suspended | מגיעה רק לתמיכה. |

הקלפים. ה serial הוא גם שם קובץ התמונה.

| serial | בעלים | מצב | מה מיוחד |
|---|---|---|---|
| `SN-DR97-0001` | red | stored ב A1 | צילום מקצועי שהושלם וחיוב service. |
| `SN-DX102-0002` | golden | stored ב A2 | חצי מ batch מפוצל, אירוע `batch_split`. |
| `SN-DX107-0003` | red | listed ב B1 | Gold Star, עבר מ A2 ל B1, listing של 3200 דולר והצעה ממתינה של 2750 מ golden. |
| `SN-DF97-0004` | golden | stored ב B1 | בקשת `third_party_grading` פתוחה. |
| `SN-CL10-0005` | red | stored ב A1 | פריט רגיל בלי שום דבר פתוח. |
| `SN-SV146-0006` | golden | shipped | `binId: null`, משלוח rush וחיוב 3500. |
| `SN-ROS104-0007` | golden | stored ב B2 | החצי השני של ה batch, בקשת תרומה פתוחה. |
| `SN-ROS105-0008` | red | stored ב B2 | נקלט אצל golden ונמכר ל red ב 260 דולר עם עמלה של 13. עליו המחלוקת וה hold. |
| `SN-EVS194-0009` | platform | donated ב B1 | נקלט אצל red ונתרם. |

`SN-EVS218-0010` לא נזרע בכוונה, כדי שיהיה קלף אמיתי לבדוק איתו intake ידני. ההערה שאומרת אותו דבר על `0009` התיישנה.

המחירון. `fixed` הוא סנטים, `percentage` הוא נקודות בסיס.

| `actionType` | מודל וערך | הערה |
|---|---|---|
| `intake` | fixed 500 | ברירת המחדל, ועוד 11 כללים לפי `itemClass` מ 100 לקלף בודד עד 2000 לתיק אטום או מזכרת, נבנים מ tuple עם `map`. |
| `intake_lot` | fixed 500 | |
| `storage`, `storage_oversized` | fixed 100 ו 500 | ה worker קורא את `parameters`. רגיל, 180 יום חינם ואז 10 אחוז מדמי ה intake כל 90 יום. oversized, 90 יום ואז 100 אחוז. |
| `service` | fixed 2000 | נפילה לכל שירות בלי כלל משלו, ולכן שכבת grading חדשה בלי מחיר יקרה ולא חינמית. |
| `shipping` | fixed 0 | |
| `marketplace_fee` | percentage 500 | 5 אחוז. |
| `consignment_fee:*` | percentage 1000, 100, 100 | card show, auction house, ebay partner. |
| `grading_fee:*` | fixed 2500 עד 30000 | חמש רמות PSA ו BGS, נבחרות דרך `feeActionType`. |
| `service_fee:*` | fixed 1000, 1500, 500 | video review, condition inspection, deslab. |
| `shipping_rush`, `shipping_addon:gps_tracker` | fixed 1000 ו 3000 | |
| `cash_out_fee`, `escrow_fee` | percentage 100 | הפסים האמיתיים של `cash_out_fee` חיים ב `money-terms.ts`, ועמלת escrow מחושבת ב `esc/escrow-terms.ts` עם `ESCROW_FEE_BPS` ורצפה של 25 דולר, כך שהכלל בטבלה אינו המקור היחיד. |
| `chargeback_fee` | fixed 2500 | |
| `white_glove:*`, `show_pickup` | fixed 100000, 150000, 1500 | |
| מנויים | fixed לפי `listPriceMinor` | נבנים מ `MEMBERSHIP_TIERS` עם `billingTrigger: 'monthly'`, כדי שהקטלוג והמחירון לא יסטו. |
| `parcel_processing`, `parcel_forwarding` | fixed 200 ו 400 | |

חשבון היתרות שהבדיקות מניחות. red מקבל 500000 מ topup ועוד 500000 מבקשת ארנק מושלמת, פחות ארבעה intake, service אחד והרכישה, ונשאר עם 970000 סנט. golden מקבל 500000, פחות חמישה intake, service, משלוח, עמלה ומשיכה, ועוד 26000 מהמכירה, ונשאר עם 416700.

**שים לב.** E11. אין בדיקה של `NODE_ENV`, של המארח או של דגל אישור. `nest build` מקמפל את הקובץ ל `dist/db/seed.js`, וה image מכיל אותו ואת `argon2`. `node dist/db/seed.js` בקונטיינר מוחק ledger ו audit ויוצר שני מנהלים עם סיסמה ידועה. גם `pnpm test` מול `.env` שמצביע על סביבה משותפת יאפס אותה. הכל רץ בלי transaction, כישלון באמצע משאיר מסד ריק או חצי מלא.

**שים לב.** E16. הבדיקות לא בונות את עולם הבסיס שלהן. `tests/integration/helpers/http.ts` מגדיר `SEED_PASSWORD` ואת `SEED` עם חמשת האימיילים, ו 37 קובצי בדיקה תלויים בהם. `signIn` מתחבר עם הסיסמה כברירת מחדל, `fundWallet` צריך את `SEED.admin` כדי לאשר בקשת ארנק. שינוי סכום, אימייל, סיסמה או מספר מדפים שובר בדיקות, את `SignInPage.tsx` ואת `demoUsers.ts`. `scripts/test.mjs` מאפס רק בסוף ועוצר אחרי הסוויטה הראשונה שנכשלה, ולכן ריצה עם `--no-reset`, `BAULT_TEST_NO_RESET=1` או vitest ישיר נכשלת על מצב מצטבר. `tests3/integration/fin-invariants.test.ts` למשל החזיר 409 על מסד שלא הוזרע מחדש ועבר אחרי seed. ב CI זה לא קורה כי migrate ו seed רצים על מסד חדש לפני הבדיקות.

**שים לב.** נתוני דמו למסך חדש נכנסים כבלוק אחרי העוזרים, עם `one` ועם `mkItem`, `custody`, `transfer`, `bill` ו `ledger`, ולא בכתיבה חופשית. כל שינוי מצב נכתב יחד עם האירוע שמתעד אותו, וכל כסף יחד עם שורת ה ledger שלו, אחרת המסך יציג מצב שהמערכת לא מייצרת, כמו ב escrow.

**שים לב.** טבלה חדשה בסכמה מחייבת שלושה צעדים כאן. להוסיף אותה לרשימת ה `TRUNCATE`, אחרת ה seed נכשל אם יש לה FK או משאיר שאריות אם אין. להחליט אם מסך כלשהו צריך שורות דמו בה. ואם היא היסטורית, לזכור שה seed הוא הכותב היחיד שעוקף את השירות, ולכן כל שורה כאן חייבת להתאים לשורות ledger ומשמורת מקבילות.

**שים לב.** כיווני תיקון שלא שוברים דבר קיים. סירוב בתחילת `main` כש `NODE_ENV` הוא `production` בלי דגל מפורש, כי CI, `scripts/test.mjs` ו `db:reset` רצים כולם בסביבה אחרת. הוצאת הקובץ מ `src` כדי שלא ייבנה ל image, תוך וידוא ש `db:seed` עדיין מוצא אותו דרך `tsx`. פיצול לשלושה, seed אידמפוטנטי של כללי תמחור ומתקנים עם `ON CONFLICT DO NOTHING` שמותר בכל סביבה, seed של דמו, ו fixtures של בדיקות. עטיפה ב `db.transaction` דורשת להעביר `tx` לכל העוזרים ולהריץ את ה `TRUNCATE` ואת בלוק pg-boss דרך `tx.execute`. trigger מסוג `BEFORE TRUNCATE` על טבלאות ההיסטוריה, שמסרב בלי משתנה session מפורש, יסגור את הפתח גם ב production.

## פרק 3. מודל הנתונים וה migrations

### סקירה

Postgres 16 אחד, 49 טבלאות, 33 enum ים, 73 אינדקסים שאינם מפתח ראשי, 6 מפתחות זרים, 12 טריגרים. כל מודול מגדיר את הטבלאות שלו בקובץ `*.schema.ts` לפי דפוס P5, והמיגרציות יושבות ב `apps/api/src/db/migrations` לפי דפוס P6. חמש עובדות חוצות את כל האזור.

- קבצי הסכמה אינם המסד. רק 21 מתוך 73 אינדקסים מוצהרים ב TypeScript, ואף מפתח זר, CHECK או טריגר אינו מוצהר. האמת נמצאת במיגרציות.
- כמעט כל עמודת הפניה היא `text` שמחזיק UUID, בלי מפתח זר. ה JOIN ים עובדים רק בזכות cast מובלע מ `text` ל `uuid` שמותקן ב `0001_append_only.sql`. 13 עמודות שהן `uuid` במסד מוגדרות `text` ב TypeScript.
- כסף הוא `bigint` בסנטים דרך `amountMinor`, הסימן בעמודה נפרדת, והיתרה נגזרת תמיד מ `ledger_record`. חריגים ב `integer` בטבלאות `escrow_deal`, `shipment`, `consignment_event`.
- עשרה יומנים חסומים ל `UPDATE` ו `DELETE` בטריגר, ו `item` חסום למחיקה. `TRUNCATE` עוקף את שניהם.
- מאז 0004 המיגרציות נכתבות ביד ואין snapshot, ולכן `drizzle-kit generate` ו `drizzle-kit push` מסוכנים.

סדר קריאה. `acc`, `cst`, `pay`, אחר כך קובץ ההגנות, שאר הסכמה, המיגרציות לפי המספר, ובסוף `meta`.

#### `apps/api/src/modules/acc/acc.schema.ts`
טבלאות הזהות. דפוס P5. 25 קבצים ב API מייבאים אותו, בראשם `auth.service.ts` ו `session.service.ts`, וה worker קורא את `user_account` ב SQL גולמי.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 23 | imports והערה על ארבע החלטות. `id` פנימי שלא נחשף, כך שאפשר לשנות כל דבר אחר בלי לשבור הפניות, `username` ציבורי וקבוע, שם פרטי ומשפחה במקום `displayName`, `intakeId` שיצא משימוש | ה CHECK והטריגר על `username` קיימים רק במיגרציה 0004 |
| 25 עד 32 | enum `account_status` עם `pending`, `active`, `suspended`, `closed`, ו enum `user_role` עם `user`, `warehouse_operator`, `admin` | המסד אינו אוכף מעברי סטטוס. תפקיד אחד לחשבון, אין טבלת תפקידים |
| 34 עד 74 | `user_account`. `email`, `username`, `password_hash` של argon2, `status`, `intake_id` nullable, `role`, `first_name`, `last_name`, `name_review_required`, `legacy_display_name`, `auto_suspended_at`, `created_at`. שלושה unique בשורות 69 עד 73 | `email` ייחודי ורגיש לאותיות, הנרמול ל lowercase נעשה רק ב `auth.service.ts` שורות 40, 55 ו 112, וכל נתיב כתיבה חדש שישכח לנרמל ייצור שני חשבונות לאותה תיבה. `citext` או unique על `lower(email)` יעבירו את זה למסד. הפיכת `intake_id` ל not null תשבור כל הרשמה, כי ההרשמה אינה כותבת אותו. אין `updated_at`. `auto_suspended_at` מבדיל השעיית חוב של ה worker מהשעיה של מנהל. `user_account_status_idx` מ 0006 אינו מוצהר |
| 76 עד 90 | enum `verification_token_type` עם `email_verification` ו `password_reset`, וטבלת `verification_token` עם `user_id`, `type`, `token_hash`, `expires_at`, `consumed_at` | נשמר רק hash. אין ניקוי של טוקנים שפגו. `verification_token_hash_idx` מ 0024 אינו מוצהר |
| 92 עד 109 | `login_session`. `user_id`, `token_hash` של עוגיית httpOnly, `expires_at`, `revoked_at` שנכתב ביציאה, ו `ip` עם `user_agent` מ 0029. ה IP הוא הלקוח האמיתי כי ה API סומך רק על ה proxy המקומי לפי `main.ts` | שני האינדקסים החמים מ 0024 קיימים רק ב SQL. הביטול ב `session.service.ts` שורה 75 מחפש בלי `revoked_at is null` ולכן אינו משתמש באינדקס החלקי |
| 111 עד 145 | `login_attempt`, יומן append only. enum `login_attempt_outcome` עם `success`, `bad_credentials`, `unverified`, `refused`. `identifier` כפי שהוקלד אחרי נרמול, `user_id` nullable, `ip`, `user_agent`, `occurred_at`. שני אינדקסים מוצהרים בשורות 142 ו 143 | הטבלה היחידה בקובץ שמצהירה אינדקס רגיל, כי נכתבה יחד עם 0029. אין `created_at`. הסיסמה לא נשמרת בשום צורה |

**שים לב.** שינוי שם של העמודה `username` מחייב שינוי בפונקציית הטריגר מ 0004, שמתייחסת לשם בגוף שלה.

#### `apps/api/src/modules/acc/address.schema.ts`
כתובות משלוח שמורות. דפוס P5. צרכנים `acc/profile.service.ts`, `shp/parcel-profile.service.ts`, `seed.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 7 | imports והערה שהגישה מוגבלת לבעלים דרך `ProfileService` | אכיפה בקוד בלבד |
| 8 עד 19 | `shipping_address`. `user_id`, `label`, `recipient`, `line1`, `city`, `postal_code`, `country`, `is_default`, `created_at` | אין אינדקס על `user_id`, אין `updated_at`, אין `line2`. `country` אמור להיות קוד ISO מאז 0021 ואין CHECK. אין partial unique על `is_default`, ולכן שתי ברירות מחדל אפשריות. המשלוח שומר snapshot ב `destination_detail`, כך ששינוי כתובת אינו משנה משלוח קיים |

#### `apps/api/src/modules/cst/cst.schema.ts`
לב המערכת הפיזית, הפריט, המדף, הקבוצה, התמונות, ושלושת יומני ההיסטוריה. דפוס P5. 32 צרכנים, בהם `custody.service.ts`, `stow.service.ts`, `inventory.service.ts`, כל שירותי DIS, ושירותי MKT ו SHP שמזיזים פריטים. ה worker קורא את `item` ב `storage-fee.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 20 | imports והערה על שלושה עקרונות. פריט לא נמחק ויש לו בעלים אחד, כל שינוי בבעלים, מדף או מצב כותב `custody_event` באותה טרנזקציה, והיומן append only | הראשון והשלישי נאכפים בטריגרים, השני רק דרך `CustodyService` שמקבל `tx` |
| 22 עד 49 | enum `item_lifecycle` עם עשרה ערכים. `received`, `stored`, `listed`, `on-hold`, `sold`, `shipped`, `donated`, `consigned`, ומ 0013 `at_grader` ו `discarded` | `on-hold` כתוב עם מקף והשאר עם קו תחתון. טבלת המעברים ב `cst/lifecycle.ts` שורות 23 עד 39. `received` רק ל `stored`. מ `stored` לכל אחד מהשמונה האחרים. `listed` ל `stored`, `sold`, `on-hold`. `on-hold` ל `stored`. `sold` ל `stored` או `shipped`. `at_grader` ל `stored` או `discarded`. `shipped`, `donated`, `consigned`, `discarded` סופיים. המסד אינו אוכף, ועדכון ישיר של `lifecycle_state` עוקף את `assertTransition` |
| 51 עד 111 | `bin`. `serial_number` בצורת `BIN-` ושמונה תווים, `barcode` זהה לו, `zone` כתווית, `facility_id` nullable, `oversized`, `active`. שני unique בשורות 108 ו 109 | אין קיבולת במכוון, אחסון כאוטי שבו פריט נכנס לכל מדף פנוי, ראה 0018. `facility_id` nullable רק כי נוסף לטבלה עם שורות, והוא text בלי FK. `bin_facility_idx` קיים רק במיגרציה. הסריאל האקראי החליף ב 0019 שם סדרתי שנשען על `count(*)` |
| 113 עד 120 | `batch`, קבוצת פריטים שהגיעה יחד. `owner_id`, `status` text חופשי עם `open`, `split`, `closed` | אין אינדקס ואין CHECK על הסטטוס. `batch_split` הוא גם סוג אירוע משמורת וגם סוג בקשת שירות שנוצרת ב `dis/lot-split.service.ts`, אל תבלבלו |
| 122 עד 185 | `item`. `owner_id`, `serial_number` ו `barcode` ייחודיים, `type_class`, `description`, `condition_grade`, `lifecycle_state`, `bin_id`, `source_batch_id`, `source_parcel_id`, `hold_flag`, `oversized`, `weight_grams`, `is_lot`, `lot_size`, `lot_broken`, `received_at` | כל ההפניות text בלי FK, כולל הבעלים. `type_class` הוא מפתח מ `inv/item-classes.ts` בלי CHECK, ו 0008 השאירה ערכים ישנים לא ממופים, לכן קוד שקורא אותו צריך לסבול ערך לא מוכר. `received_at` הוא הבסיס לחישוב דמי האחסון ב worker. `oversized` מועתק בקבלה ולא נגזר מהמחלקה, כדי ששינוי טקסונומיה לא ישנה מחיר. `hold_flag` חי לצד המצב `on-hold`. ארבעה אינדקסים קיימים רק במיגרציות 0009, 0010, 0018, 0024. `DELETE` נכשל בטריגר `trg_no_delete_item`. `item` מחזיק מצב ו `custody_event` את הדרך, ושום דבר במסד לא מונע עדכון של `item` בלי אירוע. טריגר `AFTER UPDATE` שכותב את האירוע היה דורש להעביר את השחקן ב `set_config` בתחילת הטרנזקציה |
| 187 עד 206 | enum `item_image_type` עם `intake`, `professional`, `video`, וטבלת `item_image` עם `item_id`, `type`, `version`, `object_key`, `content_hash` | ההערה אומרת immutable, אבל אין unique על `item_id, type, version` ואין טריגר. שתי העלאות מקבילות יכולות לקבל אותה גרסה. `object_key` מפנה לאחסון תואם S3, והאובייקט עצמו אינו מוגן מפני דריסה ברמת המסד |
| 208 עד 217 | `item_change_history`. שורה לכל שדה שתוקן, `item_id`, `actor_id`, `field`, `old_value`, `new_value` | נכתבת מ `inv/correction.service.ts`. אינה מוגנת בטריגר, למרות שהיא היסטוריה |
| 219 עד 233 | `bin_transfer`. `item_id`, `from_bin_id` שהוא NULL בשיבוץ הראשון, `to_bin_id`, `actor_id`, `reason`, `occurred_at`, `created_at` | append only בטריגר. חופף במכוון ל `custody_event` מסוג `relocate` |
| 235 עד 262 | enum `custody_event_type` עם `intake`, `relocate`, `ownership_transfer`, `state_change`, `hold_placed`, `hold_released`, `batch_split`, `dispatch`, וטבלת `custody_event` עם בעלים, מדף ומצב לפני ואחרי, `actor_id`, `reason`, `metadata` | `prev_state` ו `new_state` הם text ולא enum, כך שהיומן אינו מאומת מולו. append only. שינוי שם של הטבלה ישאיר אותה בלי טריגר, כי רשימת ההגנות היא רשימת שמות |

**שים לב.** `seed.ts` מנקה את הטבלאות האלה ב `TRUNCATE`, כי `DELETE` חסום. `updated_at` מ `_helpers.ts` אינו מתעדכן לבד ואין טריגר, וכל `.set` חייב לכתוב `updatedAt: new Date()`. בכל ה API יש 93 קריאות `.set` ורק 47 כותבות אותו, כך שהעמודה ישנה בחלק מהשורות. FK מ `item.owner_id` ל `user_account.id` דורש קודם עמודת `uuid`, כי FK דורש טיפוסים זהים. שינוי שם של ערך ב `item_lifecycle` מחייב גם את `lifecycle.ts`, כל השוואת מחרוזת ב services, וה SQL הגולמי ב worker.

#### `apps/api/src/modules/pay/pay.schema.ts`
כל הכסף. אין טבלת יתרות, היתרה היא `sum(credit) - sum(debit)` על `ledger_record`, מחושבת ב `LedgerService.balanceOf` ובשלוש שאילתות של ה worker. דפוס P5. 19 צרכנים ב API, וב worker `debt.ts`, `interest-accrual.ts`, `wallet-suspension.ts`, `storage-fee.ts`, `membership-renewal.ts`, `ledger-invariant-check.ts` ב SQL גולמי.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 9 | imports והערה שקובעת את עיקרון היתרה הנגזרת | |
| 10 עד 41 | enum `ledger_type` עם 11 סוגים. שבעה מקוריים, `escrow_hold`, `escrow_release`, `escrow_refund` מ 0016, ו `chargeback` מ 0017. enum `ledger_direction` עם `debit` ו `credit` | החזקת נאמנות היא חיוב אמיתי שמוריד יתרה, לא דגל. `chargeback` נפרד מ `credit_topup` שלילי. שינוי שם של ערך ישבור שאילתות worker שמשוות מחרוזות בלי שגיאת קומפילציה |
| 43 עד 54 | `ledger_record`. `user_id`, `type`, `amount`, `direction`, `currency`, `reference_type`, `reference_id`, `occurred_at` | append only בטריגר, תיקון רק בשורה מפצה. `ledger-invariant-check.ts` ב worker בודק את הספר ב SQL גולמי. אין `CHECK (amount > 0)`, ושורה שלילית לא תתוקן לעולם. ההערה בשורה 50 מונה ארבעה `reference_type` והקוד כותב לפחות שמונה. אין אינדקס על `reference_type, reference_id`. `ledger_record_user_occurred_idx` מ 0006 הוא מה שהופך את חישוב היתרה לזול |
| 56 עד 68 | `external_payment`. `provider`, `provider_ref` שהוא token בלבד ולעולם לא נתוני כרטיס, `purpose` עם `topup`, `charge`, `payout`, `status` text, `amount`, `webhook_event_id` | ה unique על `provider_ref` מ 0017 מונע זיכוי כפול ואינו מוצהר כאן. הטבלה מתעדכנת ב `chargeback.service.ts` שורה 143, ולכן אי אפשר להוסיף אותה לרשימת ההגנות |
| 70 עד 82 | `charge`. `action_type` עם `intake`, `storage`, `service`, `shipping`, `marketplace_fee`, `pricing_rule_snapshot` jsonb חובה, `amount`, `payment_means` עם `wallet` או `external`, `status` text, `reference_id` | append only בפועל, אין `update(charge)` ב API או ב worker, אבל אינה מוגנת. ה snapshot מקפיא את כלל התמחור ואסור לאבד אותו. `updated_at` לעולם לא משתנה |
| 84 עד 109 | enum `wallet_request_type` עם `cash_in` ו `cash_out`, ו enum `wallet_request_status` עם שבעה מצבים | המעברים ב `pay/wallet-request.rules.ts` שורות 39 עד 47. `submitted` ל `pending_review`, `approved`, `rejected`, `cancelled`. `pending_review` ל `approved`, `rejected`, `cancelled`. `approved` ל `processing`, `completed`, `rejected`. `processing` ל `completed` או `rejected`. שלושת הסופיים `rejected`, `completed`, `cancelled`, ורק `completed` מזיז כסף. אין `draft` במכוון |
| 111 עד 145 | `wallet_request`, בקשה להזיז כסף ולא התנועה עצמה. `code` בצורת `WR-XXXXXXXX`, `amount`, פרטי מקור ויעד, `document_key`, `settled_ledger_id`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `completed_at` | ה CHECK על סכום חיובי, היחיד במערכת, ושני ה unique קיימים רק ב 0004. ה partial unique על `settled_ledger_id` מונע משתי בקשות להצביע על אותה שורה, אבל לא מבקשה אחת לייצר שתי שורות. ההגנה מהשלמה כפולה היא הנעילה ומכונת המצבים ב service |
| 147 עד 165 | `wallet_request_event`, יומן append only של כל מעבר. `request_id`, `actor_id`, `actor_role`, `from_status`, `to_status`, `reason`, `metadata` | הסטטוסים text ולא enum |
| 167 עד 177 | `withdrawal`, מודל משיכה ישן. `destination_account` רגיש, `status` text עם `requested`, `confirmed`, `paid`, `failed`, `confirmed_at` | עדיין נכתבת ב `withdrawal.service.ts` שורות 76 ו 97, כך שיש שני מסלולי הוצאה. אין אינדקס על `user_id` |

**שים לב.** היתרה מחושבת גם ב worker ב `debt.ts` שורות 45 ו 59 עד 62 וב `wallet-suspension.ts` שורה 61, ושינוי בכללי הסיכום חייב להגיע לשלושתם. `CHECK (amount > 0)` על `ledger_record` אפשר להוסיף כ `NOT VALID` ואז `VALIDATE CONSTRAINT` בלי לנעול את הטבלה בזמן הבדיקה. `bigint` במצב `number` מדויק עד 2 בחזקת 53 סנט. `balanceOf` עושה `sum(...)::text` ואז `Number`, זו הדרך היחידה שלא מאבדת דיוק. מעבר למצב `bigint` של JavaScript ישבור את `JSON.stringify` בכל 19 הצרכנים.

#### `apps/api/src/db/sql/0001_append_only.sql`
ההגנות שהמסד אוכף בלי תלות בקוד. אינו מיגרציה של Drizzle, אינו ביומן, ו `migrate.ts` מריץ אותו מחדש אחרי כל ריצה, מחוץ לטרנזקציה של המיגרציות. השם 0001 מקרי ואין לו קשר ל `0001_petite_betty_brant.sql`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 13 | הערה על טריגרים שנאכפים על כל תפקיד ועל תפקיד אפליקציה מוגבל | שורות 4 ו 5 מונות ארבע טבלאות, מיושן. הרשימה בפועל מונה עשר |
| 15 עד 21 | `bault_reject_mutation`, פונקציית plpgsql שמעלה `append_only_violation` עם SQLSTATE 23514 | האפליקציה מזהה רק 23505, ולכן ניסיון לערוך היסטוריה מגיע ללקוח כשגיאה כללית |
| 23 עד 56 | בלוק `DO`. המערך בשורה 42 מונה את עשר הטבלאות, `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event`, `login_attempt`. לכל טבלה קיימת יוצר מחדש `trg_append_only_<table>` מסוג `BEFORE UPDATE OR DELETE` | ההערות בשורות 27 עד 41 מסבירות רק חלק מהטבלאות ולא מזכירות את `support_message` ו `escrow_event`. `format` עם `%I` מצטט שמות, אין סיכון הזרקה. טבלה שאינה קיימת מדולגת בשקט, כך ששם שגוי במערך לא יקבל טריגר בלי אזהרה. טריגר שורה לא נורה על `TRUNCATE` ולא תחת `session_replication_role = replica`. `DROP TRIGGER` לוקח `ACCESS EXCLUSIVE` על כל עשר הטבלאות בכל ריצה, כדאי `SET lock_timeout` |
| 58 עד 97 | יוצר את התפקיד `bault_app` בלי `LOGIN`, ולכל אחת מעשר הטבלאות נותן `SELECT, INSERT` ושולל `UPDATE, DELETE` | התפקיד אינו בשימוש ואינו שמיש, אין לו הרשאה על 39 הטבלאות האחרות. האפליקציה מתחברת כ `bault`, superuser במסד המקומי. כדי שיעבוד צריך `LOGIN`, הרשאות מלאות על כל שאר הטבלאות, `USAGE` על הסכמה, ובעלות שנשארת אצל תפקיד המיגרציה. ה `REVOKE` בשורה 93 אינו עושה דבר. הרשימה משוכפלת בשורה 87, מי שמוסיף טבלה חייב לעדכן את שני המקומות |
| 99 עד 125 | `bault_reject_delete` עם `never_deleted_violation`, ו `trg_no_delete_item` מסוג `BEFORE DELETE` בלבד על `item` | פריט מתעדכן כל הזמן, ולכן רק מחיקה חסומה |
| 127 עד 146 | אם אין cast מ `text` ל `uuid` ב `pg_cast`, מריץ `CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT` | בלעדיו כל JOIN בין `uuid` ל `text` נכשל עם `operator does not exist`, כלומר הקובץ הוא תנאי לכך שהאפליקציה תעבוד. דורש superuser, ובמסד מנוהל צפוי להיכשל ולבטל את כל הקובץ כטרנזקציה מובלעת אחת. ערך text שאינו UUID תקין זורק שגיאה, ו id לא מאומת יכול להפיל שאילתה ב 500 במקום 404. `${item.id}::text = ${listing.itemId}` ב `browse.service.ts` שורה 82 מעביר את ההמרה לצד המאונדקס ומבטל את `item_pkey` |

**שים לב.** `nest build` אינו מעתיק את `src/db/sql`, ולכן `node dist/db/migrate.js` מחיל את כל המיגרציות ואז נכשל ב `ENOENT` על הקובץ הזה. התוצאה מסד בלי טריגרים ובלי cast. בתמונת Docker אין דרך אחרת, כי `db:migrate` דורש `tsx` שהוא devDependency. CI מריץ רק דרך `tsx` ולא תופס את זה. הוספת `membership_period` לרשימה תשבור את המנויים, הוספת `charge` או `transaction` בטוחה היום. התיקון הקטן הוא `assets` ב `nest-cli.json` שמעתיק את `src/db/sql`, או נתיב מול `process.cwd()` כמו תיקיית המיגרציות, ועוד בדיקה אחרי ההרצה שסופרת לפחות 11 טריגרים. החלופה ארוכת הטווח ל cast היא המרת עמודות ההפניה ל `uuid`.

**שים לב.** מה המסד אוכף בפועל. עשרת היומנים ו `item` בטריגרים מכאן, `username` קבוע ומנורמל בטריגר וב CHECK מ 0004, ייחודיות של `email`, `username`, `intake_id`, סריאלים וברקודים, בקשת ארנק שנסגרת בשורת ספר אחת וסכום בקשה חיובי מ 0004, הצעה פתוחה אחת לקונה מ 0020, קרדיט אחד לכל `provider_ref` מ 0017, מלאי לא שלילי מ 0026, מנוי אחד ומחזור אחד מ 0027, ומפתח idempotency ייחודי. מה רק הקוד אוכף. מעברי מצב של פריט, חבילה ובקשת ארנק, קיום הבעלים של פריט, כתיבת `custody_event` באותה טרנזקציה, listing פעיל אחד לפריט, פריט שאינו בשני משלוחים פתוחים, סכום חיובי בספר, ועדכון `updated_at`.

#### `apps/api/src/modules/sec/audit.schema.ts`
יומן ביקורת של כל בקשה שמשנה מצב. דפוס P5. הכותב היחיד הוא `sec/audit.service.ts` דרך ה interceptor.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 18 | `audit_record`. `actor_id` nullable, `action` כמו `POST /api/v1/auth/login`, `target_entity`, `target_id`, `metadata`, `occurred_at` | append only. הטבלה גדלה בכל בקשה משנה מצב, ולכן היא הראשונה שתכביד. `actor_id` הוא NULL בתהליכי מערכת ובהתחברות עצמה, כי ה interceptor קורא את `req.user` שעוד לא קיים. `audit_record_actor_idx` רק ב 0024. אין אינדקס על `target_entity, target_id`, ושאלה על ישות סורקת הכל. אין מדיניות שמירה, ומחיקה דורשת partitioning או השבתת טריגר |

#### `apps/api/src/modules/not/outbox/outbox.schema.ts`
outbox טרנזקציוני. אירוע נכתב באותה טרנזקציה של השינוי, ו `apps/worker/src/jobs/outbox-dispatch.ts` שולח אותו אחר כך. דפוס P5.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 11 | imports והערה על ההבטחה הטרנזקציונית | |
| 12 עד 20 | `outbox_message`. `aggregate_type`, `aggregate_id`, `event_type`, `payload`, ו `dispatched_at` שנשאר NULL עד השליחה | נכתבת רק דרך `not/outbox/outbox.service.ts` עם ה `tx` של השינוי, כך שהתראה לא נשלחת על שינוי שבוטל. האינדקס החלקי `outbox_undispatched_idx` מ 0024 בגודל התור ולא ההיסטוריה. הטבלה גדלה לנצח, אין מחיקה. אין עמודת ניסיונות או שגיאה, הודעה כושלת נשארת בראש התור בלי סימון. הוספת `attempts` ו `last_error` תחייב שינוי ב `outbox-dispatch.ts`. שינוי שם עמודה ישבור את ה SQL של ה worker בלי שגיאת קומפילציה |

#### `apps/api/src/modules/not/notification.schema.ts`
הפיד של ההתראות והעדפות לפי ערוץ. דפוס P5. כותבים `not/notification.service.ts` ו `outbox-dispatch.ts` ב worker.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 30 | `notification`. `user_id`, `event_type`, `content`, `channel` עם `in_app` או `email`, `status` עם `sent` או `failed`, `provider_ref`, `failure_reason` | `channel` ו `status` text בלי CHECK, ערוץ עם שגיאת כתיב ייכתב בשקט. אין עמודת נקרא. האינדקס מ 0015 אינו כולל `created_at`, והמיון של הפיד בזיכרון |
| 32 עד 59 | `notification_preference`. `user_id`, `event_type`, `channel` עם ברירת מחדל `in_app`, `enabled`. unique על שלושתם מוצהר בשורה 53 | היעדר שורה פירושו מופעל, וזה חוסך שורה לכל משתמש ואירוע. `notification_preference_lookup_idx` מ 0015 מיותר, ה unique מתחיל באותן שתי עמודות. מחיקתו בטוחה אם `EXPLAIN` על שאילתת ה dispatch ב worker מראה שימוש ב unique |

#### `apps/api/src/modules/prc/prc.schema.ts`
כללי תמחור עם תוקף בזמן. שינוי מחיר הוא שורה חדשה. דפוס P5. צרכנים `pricing.service.ts`, `price-list.service.ts`, `vlt/vault.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 22 | enum `pricing_model` עם `fixed` ו `percentage`, ו enum `billing_trigger` עם `per_event`, `daily`, `weekly`, `monthly` | `per_event` מחויב ברגע הפעולה, השאר ב worker |
| 24 עד 40 | `pricing_rule`. `action_type`, `item_class` שבו NULL פירושו כל המחלקות, `description`, `parameters`, `model`, `value`, `currency`, `billing_trigger`, `effective_from`, `effective_to`, `updated_by` | `value` הוא סנטים ב `fixed` ו basis points ב `percentage`, חובה לבדוק את `model`. שום דבר לא מונע שני כללים חופפים בזמן, הבחירה תלויה ב `order by` של `pricing.service.ts`. ההערה אומרת append only ואין טריגר. טריגר מלא לא מתאים כי `effective_to` נסגר בעדכון, אבל טריגר שחוסם שינוי של `value` ו `model` מתאים. exclusion constraint עם `tstzrange` ו `btree_gist` ימנע חפיפה. עריכת `value` בשורה קיימת משנה מחיר לכל פעולה עתידית, לא לחיובים קיימים שמחזיקים snapshot. מנויים מחפשים `action_type` בצורת `membership:<tier>` |

#### `apps/api/src/modules/mkt/mkt.schema.ts`
השוק בין משתמשים. דפוס P5. 16 צרכנים, בהם `listing.service.ts`, `purchase.service.ts`, `offer.service.ts`, `browse.service.ts`, `market-read.service.ts`, שירותי DIS ו `adm/shelf-yield.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 20 | enum `listing_status` עם `active`, `sold`, `removed`, וטבלת `listing` עם `item_id`, `seller_id`, `asking_price`, `currency`, `status`, `published_at` | אין אף אינדקס, למרות סינון לפי `status`, `seller_id` ו `item_id` בכל טעינה של השוק. אין partial unique על `item_id where status = 'active'`, ו listing פעיל אחד לפריט נאכף רק דרך מצב החיים של הפריט |
| 22 עד 37 | enum `transaction_type` עם `sale`, `swap`, `transfer`, `consignment`, וטבלת `transaction` עם `code`, `item_ids` jsonb, `buyer_id`, `seller_id`, `price`, `fee`, `frozen_pricing`, `executed_at` | ההערה בשורה 5 קוראת לה בלתי הפיכה ואין טריגר, ואין קוד שמעדכן אותה, כך שהוספה לרשימת ההגנות בטוחה. `frozen_pricing` מקפיא את הכלל ואסור לאבד אותו. `code` בלי unique. השאלה מה קרה לפריט נענית מ `custody_event`, לא מכאן. אין אינדקס על קונה או מוכר ואין GIN על `item_ids` |
| 39 עד 60 | enum `offer_status` עם `pending`, `accepted`, `rejected`, `countered`, וטבלת `offer` עם `listing_id`, `buyer_id`, `amount`, `status`, `parent_offer_id` לשרשור הצעות נגד, ו `proposed_by` עם `$type` של `buyer` או `seller` | הכלל הוא שמי שהציע לא מקבל, ולכן נשמר מי הציע. הצעה נגדית של המוכר נשמרת עם `buyer_id` של הקונה ובסטטוס `pending`. `$type` מגן רק ב TypeScript, לא על SQL גולמי. ה CHECK על `proposed_by` וה partial unique `offer_one_open_per_buyer` קיימים רק ב 0020 |
| 62 עד 75 | enum `swap_status`, וטבלת `swap_proposal` עם `offered_item_ids`, `requested_item_ids`, `proposer_approved` שמתחיל true, `responder_approved` שמתחיל false | אין אינדקסים. `offered_item_ids` שייכים למציע ו `requested_item_ids` למשיב, ואין בדיקת בעלות במסד. `executed` הוא מצב נפרד מ `accepted`. מערכי פריטים ב jsonb בלי שלמות. מעבר לטבלת קישור ישבור את `adm.service.ts` ו `shelf-yield.service.ts` |

#### `apps/api/src/modules/mkt/house.schema.ts`
החנות של Bault. מוצר עם מלאי, והפריט נוצר ברגע התשלום באותה טרנזקציה עם הכסף. דפוס P5. צרכן `mkt/house-store.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 19 | imports והערה על המודל | בעלות לעולם אינה ממתינה לאדם, הפריט קיים מרגע התשלום גם אם עוד לא על מדף |
| 20 עד 44 | enum `house_listing_status` עם `active` ו `removed`, וטבלת `house_listing` עם `code` בצורת `HSE-XXXXXXXX`, `type_class`, `photo_ref`, `asking_price`, `stock`, `created_by` | המכירה מורידה מלאי תחת נעילת שורה. ה CHECK `stock >= 0` מ 0026 הוא רשת הביטחון ואינו מוצהר כאן. אסור לאבד אותו |
| 46 עד 67 | enum `house_order_status` עם `awaiting_stow` ו `stowed`, וטבלת `house_order` עם `code`, `house_listing_id` מסוג uuid, `buyer_id`, `item_id`, `transaction_id`, `price`, `stowed_by`, `stowed_at` | ל `house_listing_id` יש FK במסד, לשאר ההפניות לא, אף שכולן נוצרו באותה מיגרציה. מחיקת `house_listing` עם הזמנות תיכשל, וזה רצוי. אין unique על `item_id`, ו `house-store.service.ts` הוא שמבטיח הזמנה אחת לפריט. אין `updated_at` למרות שהסטטוס משתנה |

#### `apps/api/src/modules/dis/dis.schema.ts`
מסגרת אחת לכל בקשת שירות שאינה מסחר. `type_fields` מחזיק את מה שייחודי לכל סוג. דפוס P5. צרכנים `service.service.ts`, `grading.service.ts`, `consignment.service.ts`, `vlt/vault.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 36 | enum `service_request_type` עם 12 סוגים. שישה מ 0000, `buyout` מ 0012, `video_review`, `condition_inspection`, `deslab`, `remove_commons` מ 0013, ו `custom` מ 0023 | ערך חדש דורש מיגרציה, ואסור להשתמש בו באותה ריצה |
| 38 עד 43 | enum `service_request_status` עם `requested`, `in_progress`, `completed`, `cancelled` | אין שלב הצעת מחיר, ולכן `buyout` ו `custom` שומרים את השלב ב `type_fields.stage` |
| 45 עד 66 | `service_request`. `code` nullable, `type`, `requester_id`, `item_id`, `batch_id`, `status`, `charge_id`, `type_fields`, `fulfillment` jsonb של טופס המפעיל, `fulfilled_by`, `fulfilled_at` | `fulfillment` חייב להכיל את כל שדות הטופס ונכתב באותה טרנזקציה שמעבירה ל `completed`. `code` בצורת `SR-XXXXXXXX` בלי unique, כי נוסף ב 0002 לטבלה קיימת. הקשר לתערוכה ולמשלוח דירוג חי ב `type_fields->>'eventId'` ו `type_fields->>'submissionId'` עם אינדקסי ביטוי בלבד. שינוי שם המפתח ב jsonb ישאיר אינדקס מת וספירת קיבולת בסריקה מלאה. אין אינדקס על `requester_id`, `item_id`, `status` למרות סינון בהם ב `service.service.ts` שורות 154, 155, 182 וב `vlt/vault.service.ts` שורות 464 ו 465. קשר שסופר קיבולת, כמו `eventId`, עדיף כעמודה אמיתית עם FK |

#### `apps/api/src/modules/dis/consignment-event.schema.ts`
תערוכת כרטיסים ש Bault לוקחת בה שולחן, ומאז 0016 גם נקודת איסוף. דפוס P5. צרכנים `consignment.service.ts`, `shp/human-fulfilment.service.ts`, `not/content.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 62 | `consignment_event`. `name`, `venue`, `city`, `starts_at`, `ends_at`, `request_deadline`, `capacity`, `active`, `pickup_enabled`, `pickup_capacity`, `pickup_fee_minor`, `notes` | 0 בקיבולת פירושו בלי הגבלה, 0 בעמלה פירושו ליפול לכלל התמחור, ולכן אי אפשר איסוף חינם. מעבר ל NULL ידרוש שינוי בכל השוואה ל 0 ב `consignment.service.ts` וב `human-fulfilment.service.ts` ו backfill. `pickup_fee_minor` הוא `integer`. אין CHECK על סדר התאריכים. תערוכה לא נמחקת, רק `active`. `consignment_event_open_idx` רק ב 0012 |

#### `apps/api/src/modules/dis/grading-submission.schema.ts`
משלוח מרוכז של כרטיסים לחברת דירוג אחת. כשהוא נשלח, הפריטים עוברים ל `at_grader`. דפוס P5. צרכן יחיד `dis/grading.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 27 | enum `grading_submission_status` עם `open`, `shipped`, `returned` | ב `open` הכרטיסים עדיין על המדף ומתקבלות בקשות. ב `shipped` כולם אצל המדרג. `returned` סופי |
| 29 עד 53 | `grading_submission`. `code` בצורת `GSB-XXXXXXXX` ייחודי, `grading_body` כמו PSA או BGS, `status`, `external_reference`, `tracking_number`, `shipped_at`, `returned_at`, `shipped_by` uuid, `notes`. שני אינדקסים מוצהרים | הטיפוס של `shipped_by` תואם למסד, רק ה FK מ 0013 חסר כאן. החזרת הפריטים ל `stored` כשהמשלוח חוזר נאכפת רק בשירות, אחרת הם נשארים `at_grader` לנצח |

#### `apps/api/src/modules/shp/shipment-group.schema.ts`
חבילה משותפת לכמה אספנים. כל אחד שומר משלוח משלו, כדי לא לשבור את עיקרון הבעלים היחיד. דפוס P5. צרכן `shp/group-shipment.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 26 עד 35 | enum `shipment_group_status` עם `forming`, `locked`, `dispatched`, `cancelled` | `forming` עוד לפני תמחור וחיוב. `locked` אומר שכולם הצטרפו והמשלם שילם לחברת השילוח. `cancelled` מחזיר כל משלוח חבר להיות עצמאי |
| 37 עד 65 | `shipment_group`. `code` ייחודי, `payer_user_id`, `destination_address`, `recipient_name`, `destination_country` עם ברירת מחדל `US`, `destination_postal_code`, `destination_detail` מ 0028, `status`, `locked_at`, `cancelled_at` | הכתובת נשמרת על הקבוצה ולא מושווית בין משלוחי החברים, וההסכמה של כל חבר נאכפת בקוד. `payer_user_id` הוא text כאן ו uuid עם FK במסד. `drizzle-kit push` ינסה להמיר אותו ל text וייכשל על ה FK או ימחק אותו |

#### `apps/api/src/modules/shp/shp.schema.ts`
המשלוח היוצא, הטבלה הרחבה ביותר עם 58 עמודות שנצברו בכל גל תכונות. דפוס P5. צרכנים כל שירותי SHP ו `cst/inventory.service.ts`. ה worker קורא ומעדכן ב `shipment-expiry.ts` וב `tracking-refresh.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 33 | enum `shipment_status` עם 11 ערכים, כולל `awaiting_payment` שנוסף ב 0014 עם `BEFORE 'rates_selected'`, ו `cancelled` | אין טבלת מעברים, המצב נשמר על ידי תנאי `where` בשירותים |
| 35 עד 45 | `code` בצורת `SHP-XXXXXXXX` nullable בלי unique, `user_id`, `item_ids` jsonb, `destination_address` כשורה לבני אדם, `recipient_name` nullable | אין במסד מניעה של פריט בשני משלוחים פתוחים, רק מצב החיים של הפריט |
| 46 עד 65 | `destination_country` עם ברירת מחדל `US`, `destination_postal_code`, `destination_detail` jsonb שהוא snapshot של הכתובת המובנית ברגע ההצעה, כי הכתובת השמורה עשויה להשתנות ותמחור מחדש צריך את אותו יעד | משלוחים מלפני 0014 קיבלו `US` מברירת המחדל, בניגוד להערה במיגרציה |
| 66 עד 79 | `carrier`, `service_level`, `service_key`, `fulfilment_method` text עם `carrier`, `hand_delivery`, `show_pickup` | האיות `fulfilment` כאן ו `fulfillment` בעמודות אחרות באותה טבלה |
| 80 עד 117 | חלונות איסוף ומסירה, `quote_minor` integer שבו NULL אומר שאין הצעה, `quoted_by`, `pickup_event_id`, `handed_to_name`, `handed_over_at`, `handed_over_by` | שלוש ההפניות הן uuid במסד ו text כאן. אין CHECK שקושר עמודות חובה ל `fulfilment_method` |
| 118 עד 140 | `service_mode`, `rush_flag`, `declared_value_minor`, `insured_value_minor`, `insurance_premium_minor` integer, `signature_required`, `add_ons`, `customs_lines`, `customer_notes` | כללי הביטוח והתוספות בקוד ב `shipping-options.ts`, לא במסד |
| 142 עד 158 | `merged_into_shipment_id`, `group_id`, `payment_due_at`, `cancelled_at`, `cancel_reason`, `restocking_fee_minor`, `box_size` | `shipment-expiry.ts` שורות 33 עד 37 מסנן לפי `status` ו `payment_due_at`, ו `shipment_user_status_idx` שמתחיל ב `user_id` אינו משרת אותו. אינדקס חלקי על `payment_due_at` כש `status = 'awaiting_payment'` יתאים. `box_size` נוסף ב 0025 |
| 159 עד 175 | `membership_cover` jsonb מ 0030, ו `provider_shipment_id` עם `provider_rate_id` מ 0028 | ההערה בשורות 159 עד 166 מתארת את עמודות הספק אבל יושבת מעל `membership_cover`, קל לקרוא אותה לא נכון |
| 176 עד 194 | `cost` bigint, `currency`, `status`, `tracking_number`, `estimated_delivery_at`, `label_object_key`, `package_weight_grams`, `fulfillment_notes`, `fulfillment`, `fulfilled_by`, `fulfilled_at` | שלושה טיפוסי מספר לכסף באותה טבלה, `cost` הוא bigint והשאר integer |

**שים לב.** כל שינוי שם עמודה כאן ישבור את ה SQL הגולמי ב worker בלי שגיאת קומפילציה.

#### `apps/api/src/modules/esc/escrow.schema.ts`
עסקת נאמנות בין שני אנשים, Bault מחזיקה כסף וכרטיס עד ששני הצדדים מרוצים. דפוס P5. צרכן `esc/escrow.service.ts`. זו הטבלה עם הפער הגדול ביותר מול המסד.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 37 | imports והערה על שלוש ההחלטות, החזקה כחיוב אמיתי בספר, צד חיצוני בלי חשבון, ושער בדיקה לפני שחרור | |
| 38 עד 66 | enum `escrow_status` עם שמונה מצבים, שלושה סופיים `settled`, `returned`, `cancelled`. enum `escrow_settlement` עם `buyer_vault` או `ship_to_buyer`. enum `escrow_role` | |
| 68 עד 94 | הצדדים. `code`, `raised_by`, `raiser_role`, `counterparty_user_id` כשיש חשבון, או `counterparty_name` ו `counterparty_email` כשאין | ב 0016 נכתב never both, ואין CHECK שאוכף את זה או שלפחות אחד קיים. CHECK כזה צריך להתחיל ב `NOT VALID`, לבדוק כמה שורות מפרות, ורק אז `VALIDATE`. צד חיצוני כשדות טקסט ולא כחשבון צל מצמצם PII. במסד `raised_by` ו `counterparty_user_id` הם uuid עם FK ואינדקסים |
| 95 עד 105 | `description`, `value_minor` integer, `currency` text עם ברירת מחדל `USD`, `fee_minor` integer, `status`, `settlement` | integer ולא bigint, תקרה של כ 21.4 מיליון דולר, ודווקא כאן ערכים גבוהים סבירים. text ולא `char(3)`. ההערה על מתי העמלה מוקפאת סותרת את 0016, הקוד בשירות הוא מקור האמת |
| 106 עד 120 | המימון. `funding_source` עם `wallet` או `external`, `funded_at`, `funding_attested_by`, `funding_reference` | מימון מהארנק כותב שורת `escrow_hold` בספר באותה טרנזקציה, כך שכסף מוחזק אינו ניתן לבזבוז. מימון חיצוני מאושר על ידי מפעיל שנרשם ב `funding_attested_by` |
| 121 עד 140 | הכרטיס והבדיקה. `item_id`, `item_received_at`, `inspected_by`, `inspected_at`, `inspection_matches`, `inspection_notes` | `inspection_matches` הוא text למרות שההערה מדברת על `false` |
| 141 עד 166 | השחרור והסגירה. `buyer_released_at`, `seller_released_at` עם עמודות attested למפעיל שאישר בשם צד חיצוני, `settled_at`, `returned_at`, `cancelled_at`, `close_reason`. רק ה unique על `code` מוצהר | שבע עמודות ההפניה הן uuid במסד ו text כאן |
| 168 עד 192 | `escrow_event`, יומן append only. `deal_id`, `event_type` text, `from_status`, `to_status`, `actor_id`, `on_behalf_of`, `notes`, `metadata`, `occurred_at` | `deal_id` עם FK במסד, כך שאי אפשר למחוק עסקה שיש לה אירוע |

**שים לב.** 13 העמודות שהן `uuid` במסד ו `text` כאן הן שבע ההפניות של `escrow_deal`, `deal_id` ו `actor_id` של `escrow_event`, `quoted_by`, `pickup_event_id`, `handed_over_by` של `shipment`, ו `payer_user_id` של `shipment_group`. שינוי הטיפוסים כאן ל `uuid` משנה רק את TypeScript, הערכים מחרוזות בשני המקרים. השארתם text מזמינה `drizzle-kit` להציע `ALTER COLUMN TYPE text` שישבור את ה FK.

#### `apps/api/src/modules/inv/disposal.schema.ts`
משלוח שהגיע ולא הפך לפריט, חפץ אסור, טיפול יקר מערכו, או מכשיר מעקב. סירוב אינו אירוע משמורת, ולכן לא נרשם כ `item` שאי אפשר למחוק. דפוס P5. צרכן `inv/disposal.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 26 | imports והערה על שלושת המקרים ועל כך שאין חיוב | |
| 27 עד 45 | `arrival_disposal`. `code` בצורת `DSL-XXXXXXXX`, `owner_id`, `category`, `outcome`, `description`, `notes`, `actor_id`, `occurred_at`, `created_at` | `category` ו `outcome` הם text, והקטלוג ב `inv/item-classes.ts` הוא האכיפה היחידה, `DISPOSAL_OUTCOMES` בשורה 198 הם `destroyed`, `given_away`, `recycled`, `returned`. קטגוריה שהוסרה מהקטלוג תישאר בשורות ישנות בלי תרגום. `owner_id` text בלי FK, ממולא ב `disposal.service.ts` שורות 80 עד 100 מתוך `user_account`. `notes` חובה, אבל מחרוזת ריקה עוברת במסד. ה unique על `code`, האינדקס `owner_id, occurred_at` והטריגר append only קיימים רק ב SQL. אין `corrects_id` לקישור תיקון לשורה המקורית. מילוי עמודה חדשה דורש `DISABLE TRIGGER` בתוך המיגרציה, ואין לזה תקדים בריפו |

#### `apps/api/src/modules/inv/facility.schema.ts`
מקום פיזי שמקבל חבילות, `primary` ששומר או `forwarding` שמעביר. דפוס P5. כעשרה צרכנים, בהם `facility.service.ts`, `parcel.service.ts`, `stow.service.ts`, `shp/customs.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 26 | imports, הערה, ו enum `facility_role` עם `primary` ו `forwarding` בשורה 26 | |
| 28 עד 68 | `facility`. `code` קצר ויציב כמו `NJ`, `name`, `role`, כתובת מלאה עם `region` ו `country`, `sales_tax_bps` להנחיה בלבד, 625 הוא 6.25 אחוז ו Bault אינה גובה מס, `forwards_to_facility_id`, `forwarding_days`, `active`. unique על `code` בשורה 67 | אין CHECK על טווח `sales_tax_bps`. `forwards_to_facility_id` הוא text בלי FK ובלי CHECK שמתאים ל `role`, הבדיקה ב `parcel.service.ts` שורה 529. הקוד מעביר קפיצה אחת בלבד, ולכן מחזור בין מתקנים לא יוצר לולאה אבל מנחית חבילה במתקן שאינו primary. מתקן לא נמחק לפי הערה בלבד, אין טריגר, ומחיקה תשאיר חבילות ומדפים יתומים. שינוי `code` ישבור תוויות, כתובות URL ו `facilityByCode` |

**שים לב.** אף מיגרציה לא מכניסה מתקנים ואין ב API קוד שיוצר מתקן. המקור היחיד הוא `seed.ts`, שמתחיל ב `TRUNCATE` של הכל. מסד ייצור חדש יתחיל בלי מתקנים וכל רישום חבילה ייכשל.

#### `apps/api/src/modules/inv/parcel.schema.ts`
החבילה בדרך או במתקן, היומן שלה והתמונות שלה. חבילה היא מכל שיכול להפוך לכמה פריטים, לאף אחד או לבעיה. דפוס P5. צרכנים `parcel.service.ts`, `intake.service.ts`, `shp/direct-ship.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 33 | imports, הערה, ו enum `parcel_status` עם `expected`, `received`, `opened`, `processed`, `unclaimed`, `disposed` | המעברים ב `parcel.service.ts` שורות 42 עד 49. `expected` ל `received` או `disposed`. `received` ל `opened`, `unclaimed`, `disposed`. `opened` ל `processed` או `disposed`. `unclaimed` חוזר ל `received` או `disposed`. `processed` ו `disposed` סופיים. חבילה לא משויכת מוחזקת סגורה כי היא רכוש של מישהו. ערך חדש מחייב גם את הטיפוס `ParcelStatus` בשורות 17 עד 23 של השירות ואת הממשק |
| 35 עד 44 | enum `parcel_condition` עם `sound`, `packaging_damaged`, `contents_damaged` | נרשם בפתיחה, לפני רישום הפריטים, כראיה עם חותמת זמן |
| 46 עד 108 | `parcel`. `code` בצורת `PKG-XXXXXXXX`, `owner_id` nullable, `addressed_to`, `facility_id`, `status`, `carrier`, `tracking_number`, `declared_contents`, `international_origin`, זמני מחזור החיים, `forwarded_from_facility_id`, `condition`, `charges` jsonb, `received_by`, `opened_by`, `unclaimed_at`, `disposed_at` | NULL בבעלים הוא מצב אמיתי, תווית לשם שאינו קיים, ו `addressed_to` שומר את מה שנכתב בתווית. `unclaimed_at` מתחיל את שעון ההחזקה. `international_origin` אומר שהנמען אחראי למכס. `charges` הוא עותק, מקור האמת הוא `charge`. שלושה אינדקסים מ 0009 אינם מוצהרים. אין unique על `tracking_number`, ובדיקת הכפילות ב `parcel.service.ts` שורות 184 עד 205 נעשית מחוץ לטרנזקציה ובלי נעילה. אימוץ רישום מוקדם בשורות 362 עד 369 בוחר שורה ב `expected` בלי `FOR UPDATE`, ושני מפעילים שסורקים במקביל יעדכנו אותה פעמיים. partial unique על `tracking_number` כשהסטטוס פתוח יסגור את זה |
| 109 עד 134 | `parcel_event`, יומן append only. `parcel_id`, `event_type` text עם `registered`, `received`, `forwarded`, `opened`, `processed`, `unclaimed`, `claimed`, `disposed`, `from_status`, `to_status`, `actor_id` ריק כשהאספן רשם, `facility_id`, `notes`, `metadata` | ערכי `event_type` רק בהערה. הסטטוסים text ולא enum. נכתב באותה טרנזקציה דרך `writeEvent(tx, ...)`. הטריגר והאינדקס רק במסד |
| 135 עד 157 | `parcel_photo`. `parcel_id`, `kind` עם `$type` של `arrival` או `condition`, `object_key`, `caption`, `uploaded_by` | ה CHECK על `kind` מ 0022. אינה append only במכוון, כדי שאפשר יהיה להסיר תמונה שצורפה לקופסה הלא נכונה |

#### `apps/api/src/modules/sup/sup.schema.ts`
מערכת הפניות. דפוס P5. צרכן `sup/support.service.ts`. ה worker מכיר רק את אירועי ה outbox.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 37 | imports, הערה, ו enum `support_ticket_status` עם `open`, `awaiting_customer`, `resolved` | הסטטוס עונה רק על השאלה של מי התור. תגובת לקוח לפנייה סגורה פותחת אותה מחדש. מצב `in_progress` ישבור את לוגיקת התור |
| 39 עד 60 | enum `support_ticket_category` עם `parcel`, `shipment`, `item`, `billing`, `account`, `private_sale` מ 0012, `other` | מכירה של אוסף שלם היא שיחה עם מומחה ולכן קטגוריית פנייה ולא סוג בקשה. `other` מונע סיווג שגוי ברשימה סגורה |
| 62 עד 100 | `support_ticket`. `code` ייחודי, `user_id`, `category`, `subject`, `status`, `related_type` ו `related_id` רופפים במכוון, `assigned_to`, `last_message_at`, `resolved_at`, `resolved_by` | `last_message_at` דה נורמלי ונכתב באותה טרנזקציה עם ההודעה, ב `support.service.ts` שורות 91 ו 204. התור בשורות 133 עד 153 מסנן `open` ו `awaiting_customer` בלי `limit`, וזול רק כל עוד יש מעט פניות פתוחות. `related_type` ו `related_id` במקום שישה FK, כי פנייה על רשומה שתוקנה צריכה להיפתח. הודעה בלי עדכון שלו תשאיר פנייה בסוף התור. שני אינדקסי התור מ 0011 אינם מוצהרים |
| 102 עד 124 | `support_message`, append only. `ticket_id`, `author_id`, `author_role` text עם `customer` או `staff`, `body` | אין דגל `internal` במכוון, כך שהערה פנימית לא יכולה לדלוף. הוספת דגל כזה מחייבת סינון בכל שאילתת thread. פרט רגיש שנשלח בטעות אינו ניתן למחיקה בלי להשבית טריגר |

#### `apps/api/src/modules/mem/mem.schema.ts`
מנוי חודשי, שורה אחת לחשבון ושורה לכל מחזור חיוב עם מוני הצריכה. דפוס P5. צרכן `mem/membership.service.ts`. ה worker כותב לשתי הטבלאות ב `membership-renewal.ts` וקורא ב `storage-fee.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 19 | imports והערה על הפיצול לשתי טבלאות | שורות 11 ו 12 קוראות ל `membership_period` append only, וזה לא נכון. הוספתה לרשימת ההגנות תשבור כל חיוב מנוי |
| 20 עד 33 | enum `membership_status` עם `active`, `cancelling`, `ended` | `cancelling` שומר את ההטבה עד `current_period_end`, וה worker מעביר ל `ended` |
| 35 עד 71 | `membership`. `user_id` uuid, `tier` text, `status`, `started_at`, `current_period_start`, `current_period_end`, `scheduled_tier` מ 0030, `cancelled_at`, `ended_at`. `UNIQUE` constraint על `user_id` בשורה 69 | מנוי אחד לחשבון בכלל, לא רק פעיל, וחידוש אחרי `ended` מעדכן את אותה שורה. ה worker כותב ב `membership-renewal.ts` שורות 40 עד 53, ו `storage-fee.ts` שורה 144 כותב `m.user_id::text` כדי להתאים לעמודות text. `tier` הוא מפתח ב `MEMBERSHIP_TIERS`, והמחיר נשלף מ `pricing_rule` עם `membership:<tier>`, כך ששינוי שם דרגה שובר תמחור. אין FK, והוספתו כאן הכי זולה כי שני הצדדים uuid |
| 73 עד 112 | `membership_period`. `membership_id`, `user_id`, `tier`, `period_start`, `period_end`, `fee`, `currency`, `pricing_rule_snapshot`, `consumed` jsonb, `postage_used`, `commission_waived_on`, `insured_shipments_used`. `UNIQUE` על `membership_id, period_start` ואינדקס `user_id, period_start` | `consumed` הוא מפה של פעולה למונה, למשל `{ intake: 3 }`, ויומן צריכה נדחה במכוון כי השאלה היחידה היא כמה נשאר. העמודה במסד היא `fee` והשדה `feeMinor`. המונים מתעדכנים בתנאי atomic בשאילתה אחת ב `membership.service.ts` שורות 503 עד 586, בדיקה ועדכון בלי מרוץ. המחזור הנוכחי נמצא בשוויון על `period_start`, ו `Date` מדויק למילישנייה בלבד. זה כבר גרם לבאג שתוקן ב worker עם `date_trunc('milliseconds', now())`. כל SQL חדש שכותב זמן כזה חייב לעשות אותו דבר. הסרת ה UNIQUE מבטלת את ההגנה מחיוב כפול |

#### `apps/api/src/modules/adm/adm.schema.ts`
שתי טבלאות ניהול. דפוס P5. צרכנים `adm/adm.service.ts`, `cst/inventory.service.ts`, וה worker כותב ל `storage_fee_run` ב `storage-fee.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 8 | imports והערה שמזכירה ש `dashboard_banner` הוסרה ב 0003 | מייבא את כל חמשת העוזרים מ `_helpers.ts` |
| 9 עד 20 | `dispute`. `code` בצורת `DSP-XXXXXXXX`, `transaction_id`, `opened_by`, `assigned_admin_id`, `status` text עם ברירת מחדל `open`, `ruling`, `note` | `code` nullable בלי unique. אין אינדקס ואין FK. ארבעת הסטטוסים רק בהערה. המרה ל enum דורשת ניקוי ואז `ALTER COLUMN TYPE` שכותב את הטבלה מחדש |
| 21 עד 37 | `storage_fee_run`, רשומה של כל ריצת גביית אחסון. `threshold_days`, `run_at`, `triggered_by` עם `system` לריצה האוטומטית, `charged_item_ids` ו `charged_account_ids` jsonb, `total_amount`, `currency` | סיכום ולא מקור אמת, החיובים עצמם ב `charge` עם `action_type` ו `reference_id`. אין אינדקס, ואי אפשר לשאול מהר באיזו ריצה חויב פריט |

#### `apps/api/src/shared/idempotency/idempotency.schema.ts`
התגובה הראשונה לבקשה עם `Idempotency-Key`. דפוס P5. צרכן `idempotency.service.ts`, שמשמש את `purchase.service.ts` ו `house-store.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 26 | `idempotency_key`. `key`, `user_id` nullable, `endpoint`, `status_code`, `response_body`, `expires_at`. unique על `key, endpoint` בשורה 24, כך שמפתח אחד אינו משמש לפעולה אחרת | `endpoint` בנוי כ `purchase:<listingId>` או `house-purchase:<listingId>`. `expires_at` נכתב 24 שעות קדימה ואף אחד אינו קורא אותו. שורה עם `status_code` NULL נחשבת כלא קיימת. `lookup` אינו בודק `user_id` ולא `expires_at`, ומשתמש שני עם אותו מפתח לאותה מודעה יקבל את התגובה של הראשון. אין ניקוי והטבלה גדלה לנצח. `save` נקרא אחרי הטרנזקציה, וההגנה האמיתית היא נעילת השורה ברכישה. הסגירה היא unique על `key, endpoint, user_id` עם בדיקת המשתמש ב `lookup`, `insert ... on conflict do nothing returning` בתחילת הטרנזקציה, ו job שמוחק לפי `expires_at` עם אינדקס עליו |

#### `apps/api/src/shared/confirmation/confirmation.schema.ts`
אסימוני אישור דו שלבי לפעולות בלתי הפיכות. דפוס P5. צרכן `confirmation.service.ts`, ודרכו תרומה, השלכה, משיכה, listing ו trade.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 18 | `confirmation_token`. `user_id`, `action`, `token_hash`, `payload` jsonb של הפעולה הממתינה, `expires_at`, `consumed_at` | `issue` שומר hash בלבד עם תוקף של 300 שניות כברירת מחדל. האסימון צמוד למשתמש ולפעולה, וה `payload` בשרת, כך שהלקוח אינו יכול לשנות פרמטרים בין השלבים. `consume` מעדכן לפי `id` בלבד בלי `consumed_at is null` ובלי טרנזקציה, כך ששתי בקשות מקבילות עוברות. התיקון בשירות, `update ... where consumed_at is null and expires_at > now() returning`. אין אינדקס על `token_hash` |

#### `apps/api/src/db/migrations/0000_natural_stryfe.sql`
הסכמה ההתחלתית, נוצרה ב `drizzle-kit generate` מהסכמה ב TypeScript, ולכן אין בה FK, CHECK או אינדקס על עמודת הפניה. דפוס P6. אסור לערוך, המיגרטור אינו בודק hash ומסדים חדשים וישנים יתפצלו בשקט.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 16 | 16 טיפוסי enum. `item_lifecycle` עם שמונה ערכים, `ledger_type` עם שבעה, `service_request_type` עם שישה, `shipment_status` עם תשעה | כל הרחבה מאוחרת נעשתה ב `ALTER TYPE ADD VALUE`, ואף ערך לא הוסר |
| 17 עד 46 | `login_session`, `user_account` עם `display_name` ו `intake_id` חובה ובלי `username`, `verification_token` | 0002 ו 0004 משנים את שלושת אלה. `password_hash` נשמר כמחרוזת, ו `token_hash` של סשן לא קיבל אינדקס עד 0024 |
| 47 עד 117 | `batch`, `bin` עם `capacity`, `custody_event`, `item`, `item_change_history`, `item_image` | כאן נקבעה המוסכמה של הפניות כ `text`, כי הסכמה ב TypeScript הגדירה `text()` ו `drizzle-kit` תרגם. אין אף FK ואף אינדקס על עמודת הפניה, וכל אינדקס חם נוסף אחר כך על מסד עם נתונים. `capacity` יימחק ב 0018 |
| 118 עד 138 | `audit_record` ו `outbox_message` | בלי אינדקסים עד 0024 |
| 139 עד 205 | `charge`, `external_payment`, `ledger_record`, `withdrawal`, `pricing_rule`. כל הסכומים `bigint` ו `char(3)` | `ledger_record` בשורות 167 עד 178 בלי CHECK על סכום חיובי, כי `drizzle-kit` מייצר רק מה שהוצהר. חישוב יתרה סרק את כל הספר עד 0006. `charge.status`, `external_payment.status`, `withdrawal.status` נולדו כ text |
| 206 עד 285 | `listing`, `offer`, `swap_proposal`, `transaction`, `service_request`, `shipment` | `item_ids` ו `type_fields` ב jsonb. ל `listing` לא יינתן אינדקס לעולם |
| 286 עד 307 | `idempotency_key` ו `confirmation_token` | שתיהן בלי ניקוי עד היום |
| 308 עד 313 | שישה unique, על `email`, `intake_id`, `bin.barcode`, `item.serial_number`, `item.barcode`, `idempotency_key` | אלה כל האינדקסים של הסכמה ההתחלתית. `email` בלי `lower()` |

#### `apps/api/src/db/migrations/0001_petite_betty_brant.sql`
נוצרה ב `drizzle-kit` שמונה שעות אחרי 0000, בלי הערות. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 12 | `shipping_address` | `country` טקסט חופשי עד 0021 |
| 14 עד 24 | `dashboard_banner` | נמחקה ב 0003 |
| 26 עד 48 | `dispute` ו `storage_fee_run` | סטטוס text, מזהים ב jsonb |
| 50 עד 69 | `notification`, `notification_preference`, ו unique על `user_id, event_type` | ה unique מוחלף ב 0015 |

#### `apps/api/src/db/migrations/0002_requirements_pass.sql`
נוצרה ב `drizzle-kit`, והראשונה עם מיגרציית נתונים שנוספה ביד. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 11 | enum `billing_trigger` וטבלת `bin_transfer` | |
| 13 עד 17, 35 | נולד `username`. עמודה nullable, מילוי מהחלק של האימייל לפני `@`, סיומת של ארבעה תווים מה UUID לכפילויות, `NOT NULL`, ו unique בשורה 35 | התנאי `d.id <> u.id` נותן סיומת לשני הצדדים של כפילות. התנגשות סיומות תכשיל את ה unique ואת כל הריצה. על מסד חי זה משנה שמות של אנשים בלי להודיע |
| 18 עד 34 | `code` nullable בלי unique ל `dispute`, `transaction`, `service_request`, `shipment`. עמודות lot ל `item`. `description` ו `billing_trigger` ל `pricing_rule`. עמודות fulfillment ל `service_request` ול `shipment` | `ADD COLUMN` עם ברירת מחדל קבועה אינו משכתב את הטבלה |

#### `apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql`
המיגרציה הראשונה שנכתבה ביד, ומצהירה על כך בשורות 4 עד 8, כי `drizzle-kit` מייצר רק מבנה. מכאן אין snapshot. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 45 | `first_name`, `last_name`, `name_review_required`. שם של שתי מילים בדיוק מתפצל, כל השאר נכנס לשם הפרטי חתוך ל 80 תווים ומסומן לבדיקה. `display_name` משנה שם ל `legacy_display_name` | הכלל תואם ל `splitLegacyDisplayName` ב `shared/names.ts`. `RENAME` ולא `DROP`, אבל קוד ישן שכותב ל `display_name` ייכשל מיד |
| 47 עד 77 | נרמול `username` לאותיות קטנות, CHECK `user_account_username_normalized` לאורך 3 עד 32, ופונקציה וטריגר `BEFORE UPDATE` שדוחים כל שינוי ב `username` | על מסד עם נתונים הנרמול יכול ליצור כפילות, `Bob` ו `bob` יתנגשו ב unique מ 0002, ושם קצר משלושה תווים, למשל מהאימייל `a@x.com`, יכשיל את ה CHECK ואת הריצה. אין דרך לשנות username גם במקרה מוצדק. הדרך המבוקרת היא מיגרציה שמחליפה את הפונקציה ובודקת `current_setting('bault.allow_username_change', true)` |
| 79 עד 93 | `intake_id` מאבד `NOT NULL`. ה unique נשאר | ההערה מתעדת שאף FK אינו מצביע על העמודה. unique על nullable מתיר הרבה NULL, ולכן חשבונות חדשים אינם מתנגשים |
| 99 | `shipment.estimated_delivery_at` | נחתם כשנבחר תעריף, מתוך ה ETA של הספק |
| 101 עד 155 | enums `wallet_request_type` ו `wallet_request_status`, טבלת `wallet_request` עם CHECK `amount > 0` בשורה 129, unique על `code`, אינדקס `user_id, created_at`, partial unique על `settled_ledger_id` בשורות 138 עד 140, וטבלת `wallet_request_event` עם אינדקס | ה CHECK היחיד על סכום במערכת. `settled_ledger_id` ו `reviewed_by` הם text. `wallet_request_event` מקבלת טריגר append only מקובץ ההגנות ולא מכאן. הכתיבה הידנית אפשרה CHECK, טריגר ו partial unique, ובמחיר הזה הסכמה ב TypeScript התחילה להתפצל מהמסד |

#### `apps/api/src/db/migrations/0005_shipment_recipient.sql`
דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 20 | `shipment.recipient_name` nullable. פיצול `destination_address` על הפסיק הראשון היה ניחוש | שורות ישנות נשארות NULL כי המצאת שם היא זיוף |
| 22 עד 23 | `shipment_user_created_idx` על `user_id, created_at` לרשימת המשלוחים | |

#### `apps/api/src/db/migrations/0006_wallet_debt_policy.sql`
דפוס P6. מכאן `IF NOT EXISTS` בכל מקום, להגנה על הרצה ידנית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 19 | `user_account.auto_suspended_at` | בלעדיו ה worker היה מחזיר לפעילות חשבון שמנהל השעה בגלל הונאה |
| 24 עד 25 | `user_account_status_idx` | |
| 27 עד 32 | `ledger_record_user_occurred_idx` על `user_id, occurred_at` | משרת גם את `balanceOf` בכל פעולה כספית, לא רק את ה worker. על ספר גדול הבנייה חוסמת כל כתיבה לספר |

#### `apps/api/src/db/migrations/0007_arrival_disposals.sql`
יוצרת את `arrival_disposal`, ראה `inv/disposal.schema.ts`. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 36 | הערה וטבלה. `notes` חובה בלי ברירת מחדל במכוון | ההערה בשורות 16 עד 19 אומרת שההגנות מוחלות מיד אחרי הקובץ. בפועל רק אחרי כל המיגרציות הממתינות ומחוץ לטרנזקציה |
| 40 עד 45 | unique על `code` ואינדקס על `owner_id, occurred_at` | האינדקס משרת את רשימת האספן ב `disposal.service.ts` שורה 125 |

#### `apps/api/src/db/migrations/0008_item_class_backfill.sql`
מעבירה ערכי `item.type_class` חופשיים לטקסונומיה ב `inv/item-classes.ts`. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 24 | הערה. רק ערכים חד משמעיים ממופים, והמעבר אינו כותב `item_change_history` | גם אינו כותב `custody_event` ואינו מעדכן `updated_at` |
| 26 עד 48 | שמונה `UPDATE` ים, כל אחד ממפה רשימה סגורה למפתח אחד, `trading_card` עד `memorabilia` | ההשוואה רגישה לאותיות. בלי אינדקס על `type_class` כל עדכון סורק את כל `item` ונועל שורות עד סוף הריצה. על מסד חי יש להריץ באצוות מחוץ למיגרטור |

#### `apps/api/src/db/migrations/0009_facilities_and_parcels.sql`
החצי הנכנס של המוצר. עד כאן פריט נוצר רק כשמפעיל הקליד אותו. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 31 | הערה | שורות 29 עד 31 אומרות שמתקנים נזרעים, ואין `INSERT` באף מיגרציה. ראה הערת `facility.schema.ts`. מיגרציה חדשה עם `INSERT ... ON CONFLICT (code) DO NOTHING` למתקנים ולכללי תמחור בסיסיים תפריד נתוני ייחוס מנתוני הדוגמה של ה seed |
| 33 עד 35 | enums `facility_role`, `parcel_status`, `parcel_condition` | |
| 37 עד 58 | `facility` ו unique על `code` | |
| 60 עד 99 | `parcel`, unique על `code`, ואינדקסים על `owner_id, created_at`, `status, received_at`, `tracking_number` | |
| 101 עד 116 | `parcel_event` ואינדקס `parcel_id, occurred_at` | |
| 118 עד 122 | `item.source_parcel_id` nullable ואינדקס | קישור ולא דרישה, פריטים ישנים לא הגיעו מחבילה |

#### `apps/api/src/db/migrations/0010_storage_periods.sql`
דמי אחסון עוברים לתקופה כלולה ואחריה תקופות יחסיות. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 32 | `item.oversized` עם ברירת מחדל false | נקבע בקבלה ולא נגזר, כדי ששינוי טקסונומיה לא ישנה מחיר רטרואקטיבית וכדי שה worker לא יצטרך JOIN |
| 34 עד 35 | מילוי הדגל ל `oversized_card`, `sealed_case`, `memorabilia` | מחלקה לא מוכרת נשארת false |
| 39 עד 43 | `item_state_received_idx` ו `charge_action_reference_idx` | שני הצדדים של שאילתת האחסון ב worker |

#### `apps/api/src/db/migrations/0011_support_tickets.sql`
מערכת הפניות, ראה `sup.schema.ts`. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 26 עד 47 | שני enums, `support_ticket` ו unique על `code` | הקטגוריות עדיין בלי `private_sale` |
| 49 עד 57 | אינדקסים `user_id, last_message_at` ו `status, last_message_at` | הראשון לרשימת הלקוח, השני לתור הצוות |
| 59 עד 69 | `support_message` ואינדקס `ticket_id, created_at` | ההערה בשורות 20 עד 24 חוזרת על אותה אי דיוק לגבי מתי קובץ ההגנות רץ |

#### `apps/api/src/db/migrations/0012_consignment_channels_and_buyout.sql`
תערוכות כיעד קונסיגנציה ובקשת buyout. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 28 | `buyout` ל `service_request_type` ו `private_sale` ל `support_ticket_category` | `IF NOT EXISTS` בטוח להרצה חוזרת. בקשת buyout מחזיקה את שלב הצעת המחיר ב `type_fields.stage`, כי ל enum הסטטוס אין שלב כזה |
| 30 עד 47 | `consignment_event` עם שם, מקום, תאריכים, מועד אחרון, קיבולת ודגל פעיל, ואינדקס `active, request_deadline` | ערוצי מכירה הם קוד ולא שורות, כי הם נבדלים בכללים ולא בנתונים. אותה חשיבה חוזרת בדרגות הדירוג ב 0013 ובדרגות המנוי ב 0027 |
| 50 עד 51 | אינדקס ביטוי על `type_fields ->> 'eventId'` | משרת רק שאילתה שכותבת בדיוק את אותו ביטוי |

#### `apps/api/src/db/migrations/0013_services_on_a_stored_item.sql`
שירותים על פריט במדף. מתקנת באג שבו כרטיס שנשלח לדירוג נשאר `stored` וניתן היה למכור אותו. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 8 עד 16 | הערה שמתעדת את הבאג של כרטיס בדירוג שנשאר `stored` | |
| 46 עד 54 | שבעה ערכי enum. `at_grader` ו `discarded`, `video`, וארבעה סוגי בקשה | הערך שמיש רק אחרי commit, והמיגרטור מבצע commit רק בסוף כל הריצה. גם מיגרציה מאוחרת באותה ריצה אסור לה להשתמש בהם |
| 56 עד 87 | `grading_submission_status` בתוך `DO` עם `duplicate_object`, וטבלה עם `shipped_by uuid`, unique ואינדקס | הדרך לכתוב `CREATE TYPE IF NOT EXISTS` שאינו קיים ב Postgres |
| 89 עד 93 | `grading_submission_shipped_by_fk`, המפתח הזר הראשון בסכמה, `ON DELETE no action` | מכאן טבלאות חדשות מקבלות `uuid` ו FK, בלי לחזור לישנות, וה FK לא מוצהר ב TypeScript. מחיקת משתמש לפי GDPR תיכשל כאן וב 0014, 0016 |
| 97 עד 98 | אינדקס ביטוי על `type_fields ->> 'submissionId'` | |

#### `apps/api/src/db/migrations/0014_outbound_shipping_that_ships.sql`
המשלוח היוצא הופך למוצר. עד כאן כל הצעת מחיר נשענה על יעד מקודד `IL`, מיקוד `00000` ו 500 גרם לפריט. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 48 עד 53 | `awaiting_payment` עם `BEFORE 'rates_selected'`, `cancelled`, ו enum `shipment_group_status` | מיגרציה שתשתמש בערכים החדשים באותה ריצה עם 0014 תיכשל עם `unsafe use of new value` רק על מסד חדש |
| 56 | `item.weight_grams` nullable | NULL פירושו שלא נשקל. משקל מומצא היה הופך את העמודה לחסרת ערך |
| 59 עד 75 | יעד מובנה, `destination_country` עם `US`, `destination_postal_code`, `service_key`, `service_mode`, שלושה סכומי `integer`, `signature_required`, `add_ons`, `customs_lines`, `customer_notes` | כל השורות הישנות קיבלו `US` מברירת המחדל, בניגוד להערה בשורות 121 עד 124 |
| 78 עד 83 | מיזוג, קבוצה, `payment_due_at`, ביטול, סיבה, `restocking_fee_minor` | |
| 85 עד 112 | `shipment_group` עם `payer_user_id uuid`, unique, ו FK `shipment_group_payer_fk` | הקבוצה ישות נפרדת כדי שמשלוח לא יכיל פריט של מישהו אחר, ההסבר בשורות 41 עד 46 |
| 115 עד 119 | אינדקס על `group_id`, ו `shipment_user_status_idx` על `user_id, status` | ההערה אומרת שה sweep משתמש בו, אבל ה sweep אינו מסנן לפי `user_id` |
| 125 עד 127 | `UPDATE` שממלא מיקוד ריק היכן שהוא NULL | פקודה ריקה, העמודה נוספה `NOT NULL DEFAULT ''` |

#### `apps/api/src/db/migrations/0015_notifications_leave_the_app.sql`
התראות יוצאות לאימייל, וההעדפות מקבלות ממד ערוץ. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 19 עד 32 | הערה, ו `notification.provider_ref` עם `failure_reason`, כי אימייל יכול להיכשל | העדפה אחת לאירוע לא יכלה לבטא תגיד לי כשנמכר אבל לא באימייל. ה backfill שמרני, מי שביטל אירוע לא נרשם בכך לאימייל |
| 34 עד 38 | `notification_preference.channel` עם `in_app`, ו `UPDATE` למילוי NULL | ה `UPDATE` ריק, ברירת המחדל כבר מילאה |
| 40 עד 43 | מחיקת ה unique הישן ויצירת unique על `user_id, event_type, channel` | בתוך אותה טרנזקציה אין חלון לכפילות |
| 47 עד 53 | `notification_preference_lookup_idx` ו `notification_user_channel_idx` | הראשון מיותר ומייקר כתיבה. השני אינו כולל `created_at` |

#### `apps/api/src/db/migrations/0016_a_person_in_the_middle.sql`
נאמנות, משלוח יד ביד ואיסוף בתערוכה. ההערה בשורות 1 עד 49 היא התיעוד הטוב ביותר בריפו על הנאמנות. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 51 עד 66 | `escrow_hold`, `escrow_release`, `escrow_refund` ל `ledger_type`, ושלושה enums בתוך `DO` | |
| 68 עד 123 | `escrow_deal`. כל ההפניות `uuid`, הסכומים `integer`, `currency` text עם `USD` | אין CHECK על never both בשורה 78. `inspection_matches` text |
| 125 עד 140 | unique על `code`, אינדקסים על `raised_by`, `counterparty_user_id`, `status`, ושני FK ל `user_account` | |
| 142 עד 165 | `escrow_event`, אינדקס `deal_id, occurred_at`, ו FK ל `escrow_deal` | ברשימת ההגנות. ה FK יחד עם הטריגר אומרים שעסקה עם אירוע אינה ניתנת למחיקה, וזה רצוי. שלושת ה FK בקובץ הם `ON DELETE no action` |
| 169 עד 190 | 14 עמודות ל `shipment`. `fulfilment_method`, חלונות זמן, `quote_minor`, `quoted_by uuid`, `pickup_event_id uuid`, שלוש עמודות מסירה, ואינדקס על `pickup_event_id` | `pickup_event_id` בלי FK. שבע עמודות uuid בקובץ הזה מוגדרות text ב TypeScript |
| 194 עד 201 | `pickup_enabled`, `pickup_capacity`, `pickup_fee_minor` ל `consignment_event` | 0 בקיבולת ובעמלה הוא ערך מיוחד, ראה `consignment-event.schema.ts` |

#### `apps/api/src/db/migrations/0017_money_in_money_out.sql`
טעינה בכרטיס בלי אישור אדם, עמלת משיכה, והחזרי חיוב. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 40 | `chargeback` ל `ledger_type` | `reversed` מצטרף לסטטוסים של `external_payment` בקוד בלבד, הסטטוס text |
| 44 עד 45 | `external_payment_provider_ref_unique` | הבקרה העיקרית נגד זיכוי כפול מ webhook כפול או POST חוזר, והיא שמאפשרת לטעינה בכרטיס לדלג על בודק. על `provider_ref` בלבד, לא על הספק, תיאורטי כל עוד יש ספק אחד. על מסד עם כפילויות היצירה תכשיל את כל הריצה, ולכן מיגרציה כזו מתחילה בשאילתה שמאתרת כפילויות |
| 49 עד 55 | אינדקס `user_id, purpose, status`, ו `pricing_rule_in_force_idx` על `action_type, effective_from DESC` | השני משרת את שאילתת הכלל שבתוקף ברגע נתון, ותלוי בשמות העמודות האלה |

#### `apps/api/src/db/migrations/0018_stow_wherever_it_fits.sql`
מדפים בלי קיבולת, עם מתקן ודגלים. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 53 | הערה. `capacity` היה מספר שאף אחד לא אכף | |
| 55 | `DROP COLUMN capacity` | שובר כל תהליך API ישן שעדיין רץ, כי Drizzle בוחר עמודות לפי שם. הדרך הבטוחה היא לפרוס קודם קוד שאינו קורא אותה |
| 56 עד 64 | `facility_id`, `oversized`, `active`, ומילוי `facility_id` במתקן הראשי הראשון לפי `code` | ההשמה מ `uuid` לעמודת `text` עובדת בלי cast מפורש. בלי מתקנים במסד, כמו בייצור שלא הורץ עליו seed, העמודה נשארת NULL |
| 66 עד 67 | `bin_facility_idx` ו `item_bin_idx` | שאילתת ההקצאה סרקה עד כאן את שני הצדדים |

#### `apps/api/src/db/migrations/0019_bins_get_a_serial.sql`
מחליפה את השם הסדרתי `BIN-<zone>-<nnn>` בסריאל אקראי. הישן חושב מ `count(*)` מחוץ לטרנזקציה וחשף את גודל המחסן. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 53 | הערה על שלוש הבעיות של השם הישן ועל הטריק של ה backfill | |
| 55 | `serial_number` nullable | |
| 57 עד 69 | backfill. `CROSS JOIN` עם `generate_series(1, 8)` ו `GROUP BY` לפי מדף מכריחים שמונה הגרלות לכל מדף מאלפבית של 32 תווים | תת שאילתה סקלרית עם `random()` הייתה מחושבת פעם אחת ונותנת לכל המדפים אותו סריאל |
| 74 | `barcode = serial_number` לכל מדף | כל תווית מודפסת מפסיקה להיסרק ברגע ה commit, והמחסן עוצר עד הדפסה מחדש. חלופה בטוחה הייתה לשמור את הברקוד הישן בעמודה שהסורק מקבל לתקופת מעבר. אף עמודה אינה מפנה למדף לפי ברקוד, ההפניות מחזיקות UUID |
| 76 עד 77 | `NOT NULL` ו `bin_serial_unique` | התנגשות אקראית, זניחה, תכשיל ריצה אחת |

#### `apps/api/src/db/migrations/0020_an_offer_knows_who_made_it.sql`
סוגרת חור הרשאה. המוכר יכול היה לקבל את ההצעה הנגדית של עצמו ולחייב את הקונה. הכלל הוא שמי שהציע לא מקבל. דפוס P6, והדוגמה הטובה בריפו להוספת אילוץ על נתונים קיימים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 31 | `proposed_by` nullable, backfill שבו הצעת שורש של הקונה והצעה נגדית של המוכר, `NOT NULL`, ברירת מחדל `buyer` | הסדר נכון, מילוי ואז אילוץ |
| 33 עד 35 | `DROP CONSTRAINT IF EXISTS` ואז CHECK `offer_proposed_by_check` | ערך חדש מחייב החלפת CHECK, רצוי `NOT VALID` ואז `VALIDATE` |
| 47 עד 56 | כל הצעה ממתינה שיש לה הצעה ממתינה חדשה יותר מאותו קונה על אותה מודעה הופכת `rejected`. השוואת row על `created_at, id` משאירה בדיוק אחת | הקונים שנדחו לא קיבלו הודעה, אין כתיבה ל outbox |
| 58 עד 60 | `offer_one_open_per_buyer`, partial unique על `listing_id, buyer_id` כש `status = 'pending'` | בזמן שהצעה נגדית ממתינה, הקונה אינו יכול להגיש הצעה חדשה |

#### `apps/api/src/db/migrations/0021_an_address_names_a_country_by_its_code.sql`
דפוס P6. השדה היה טקסט חופשי עם ברירת מחדל Israel, והכללים ב `carriers.ts` משווים לקוד כמו `IL`, כך שכתובת בישראל נותבה כבינלאומית ונדחתה דווקא על ידי השירות שמכסה את ישראל.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 43 | `UPDATE` של `shipping_address.country` עם `CASE` על `lower(trim(country))` שממפה כ 40 שמות, כולל עברית, לקוד. אחרת `upper(trim(country))`. ערך באורך שתיים לא נוגע | שם לא מוכר, כמו Deutschland, נשאר שם באותיות גדולות ועדיין ינותב לא נכון. `profile.service.ts` שורה 127 עדיין שומר טקסט גולמי כשהתרגום נכשל ואין CHECK, כך שהבעיה יכולה לחזור. `shipment.destination_country` לא תוקן. CHECK על שתי אותיות גדולות צריך לבוא אחרי תיקון `profile.service.ts`, כ `NOT VALID` ואז ניקוי ו `VALIDATE`, אחרת כל שמירה עם מדינה לא מוכרת תיפול ב 500 |

#### `apps/api/src/db/migrations/0022_a_parcel_can_be_photographed.sql`
דפוס P6. תמונה של קופסה היא ראיה על מכל, לא על פריט.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 29 | הערה, ו `parcel_photo` עם `parcel_id`, `kind`, `object_key`, `caption`, `uploaded_by` | עד כאן שום endpoint לא קיבל תמונה |
| 31 עד 35 | CHECK `parcel_photo_kind_check` ל `arrival` או `condition` אחרי `DROP CONSTRAINT IF EXISTS`, ואינדקס על `parcel_id` | ה CHECK הוא האכיפה האמיתית, ה `$type` בסכמה מגן רק על TypeScript |

#### `apps/api/src/db/migrations/0024_the_queries_that_run_on_every_request.sql`
מעבר אינדקסים על הנתיבים החמים, guard, join ו worker. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 17 | הערה. הסכמה החזיקה 34 אינדקסים טובים וחסרו אלה של guard, join ו worker, והדוגמה הקשה היא `login_session.token_hash`. כולל ההחלטה לא להשתמש ב `CONCURRENTLY` כי המיגרציות רצות בטרנזקציה והטבלאות קטנות | נכון היום. כשטבלה תגדל יש להריץ `CREATE INDEX CONCURRENTLY` מחוץ למיגרטור |
| 23 עד 29 | `login_session_token_active_idx` חלקי על `token_hash` כש `revoked_at IS NULL`, ו `login_session_user_idx` | הראשון תואם ל `session.service.ts` שורה 64 שרצה בכל בקשה מאומתת |
| 33 עד 50 | `item_owner_idx`, ואינדקסים לפי פריט על `custody_event`, `bin_transfer`, `item_change_history`, `item_image` | עד כאן כל טעינת כספת סרקה את כל `item` |
| 55 עד 56 | `outbox_undispatched_idx` חלקי כש `dispatched_at IS NULL` | |
| 59 עד 68 | `charge_user_created_idx`, `audit_record_actor_idx`, `verification_token_hash_idx` | נשארו בלי אף אינדקס `listing`, `transaction`, `swap_proposal`, `dispute`, `withdrawal`, `storage_fee_run`, וגם `service_request.requester_id`, `item_id` ו `confirmation_token.token_hash`. `listing` נשאל לפי `status` ב `browse.service.ts` שורה 49, לפי `seller_id` ב `market-read.service.ts` שורות 136 ו 324, ולפי `item_id` ב `inventory.service.ts` שורה 171. `service_request` נשאל ב `service.service.ts` שורות 154, 155, 182. המומלצים הם `listing (status, published_at)`, `listing (seller_id)`, `listing (item_id)`, partial unique על `listing (item_id)` כשהוא פעיל אחרי בדיקה שאין כפילות, `service_request (requester_id, created_at)`, `service_request (item_id)`, `transaction (buyer_id)`, `transaction (seller_id)`, `confirmation_token (token_hash)` |

#### `apps/api/src/db/migrations/0026_bault_sells_its_own_cards.sql`
חנות הבית, ראה `house.schema.ts`. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 23 | שני enums בתוך `DO` | |
| 25 עד 42 | מוצר ולא פריט, עם `asking_price bigint` ו `currency char(3)`. `house_listing` עם `stock integer NOT NULL CHECK (stock >= 0)` בשורה 35, ו unique על `code` | ה CHECK הוא רשת הביטחון נגד מכירה כפולה של העותק האחרון |
| 44 עד 61 | הזמנה שמחכה שמפעיל ימצא עותק, ידביק תווית וישים על מדף. `house_order` עם `house_listing_id uuid REFERENCES house_listing(id)` בשורה 47, unique על `code`, אינדקס `status, created_at` | FK inline מקבל שם אוטומטי `house_order_house_listing_id_fkey`. אין unique על `item_id` או `transaction_id`, אין `updated_at` |

#### `apps/api/src/db/migrations/0027_one_fee_instead_of_thirty.sql`
מנוי חודשי, ראה `mem.schema.ts`. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 22 | הערה ו enum `membership_status` | שורות 13 עד 16 קוראות ל `membership_period` append only, וזה לא נכון |
| 24 עד 37 | `membership` עם `user_id uuid` ו `CONSTRAINT membership_user_unique UNIQUE(user_id)` | הייחודיות הראשונה שמוגדרת כ constraint ולא כאינדקס, ולכן ניתנת ל `ON CONFLICT ON CONSTRAINT` ומופיעה ב `\d` תחת constraints. אין FK למרות ששני הצדדים uuid, והוספה אפשרית ישירות עם `FOREIGN KEY ... NOT VALID` ואז `VALIDATE CONSTRAINT` |
| 39 עד 59 | `membership_period` עם `UNIQUE(membership_id, period_start)` | ההערה בשורות 39 עד 41 מתארת את ה UNIQUE של `membership`, לא את הטבלה שמתחתיה |
| 65 עד 66 | `membership_period_user_idx` | מוצהר גם ב `mem.schema.ts`, אחד המקרים הבודדים של התאמה מלאה |

#### `apps/api/src/db/migrations/0028_a_label_that_can_be_bought.sql`
קנייה אמיתית של תווית. עד כאן המסלול עבד רק ב sandbox. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 18 | הערה על שלושה פערים שבגללם המסלול עבד רק ב sandbox, יעד כשורה מעוצבת, מזהי ספק שלא נשמרו, ותווית ליעד מקודד `US` `00000` | |
| 19 עד 22 | `shipment.destination_detail` jsonb, `provider_shipment_id`, `provider_rate_id`, ו `shipment_group.destination_detail` | snapshot ולא הפניה, כך ששינוי כתובת שמורה אינו משנה משלוח |

#### `apps/api/src/db/migrations/0029_who_signed_in.sql`
תיעוד של כל ניסיון התחברות. לפני כן כישלון לא השאיר כלום והצלחה השאירה audit עם actor ריק. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 14 | הערה שמתעדת בדיקה מול מסד חי, ו `ip` ו `user_agent` ל `login_session` | ההערה בשורות 10 עד 12 נכונה רק כשמריצים עם `tsx` |
| 16 עד 28 | enum `login_attempt_outcome` בתוך `DO`, וטבלת `login_attempt` עם `identifier`, `user_id` text nullable, `outcome`, `ip`, `user_agent`, `occurred_at` | בלי `created_at`, היחידה מבין טבלאות append only. הוספתו עם `DEFAULT now()` תמלא שורות ישנות בזמן המיגרציה |
| 30 עד 31 | אינדקסים על `occurred_at` ועל `user_id, occurred_at`, מוצהרים גם ב `acc.schema.ts` כי נכתבו באותו commit | אין אינדקס על `identifier` או `ip`, שאילתות האדמין ב `adm.service.ts` שורות 400 עד 427 נשענות על חלון זמן |

#### `apps/api/src/db/migrations/0030_a_downgrade_is_not_a_cancellation.sql`
הורדת דרגה סימנה `cancelling` בלי לשמור יעד, וה worker סיים את המנוי. דפוס P6.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 15 | `membership.scheduled_tier`, שה worker ב `membership-renewal.ts` קורא עם `coalesce(scheduled_tier, tier)` בחידוש | מנויים שנפגעו לפני התיקון לא שוחזרו, היעד שלהם לא נשמר בשום מקום |
| 16 | `shipment.membership_cover` jsonb | חבילה שממתינה לתשלום משתמשת בכיסוי שהמנוי ראה בהצעה |

#### קבצי מיגרציה קטנים

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/db/migrations/0003_drop_dashboard_banner.sql` | שורה אחת בלי תו סוף שורה, `DROP TABLE "dashboard_banner" CASCADE`. הטבלה נוצרה ב 0001 ונמחקה שמונה ימים אחר כך. נוצרה ב `drizzle-kit` |
| `apps/api/src/db/migrations/0023_ask_for_something_we_do_not_list.sql` | שורה 27 מוסיפה `custom` ל `service_request_type`. בקשה שמקבלת הצעת מחיר לפני חיוב, כמו buyout. היחידה בלי תחילית `public` ובלי breakpoint |
| `apps/api/src/db/migrations/0025_the_box_a_parcel_goes_in.sql` | שורה 18 מוסיפה `shipment.box_size` nullable, מפתח מ `SHIPPING_BOXES`. NULL פירושו תמחור לפי משקל והמחסן בוחר קופסה |

#### `apps/api/src/db/migrations/meta`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/db/migrations/meta/_journal.json` | הרשימה שהמיגרטור מריץ, 31 רשומות עם `idx`, `when`, `tag`. קובץ שאינו ביומן לא ירוץ לעולם. ה `when` של 0004 עד 0030 נכתב ביד, מתחיל ב 1785072000000 ועולה ב 100000 בכל רשומה, ואינו קשור למועד הכתיבה |
| `apps/api/src/db/migrations/meta/0000_snapshot.json` | תמונת הסכמה אחרי 0000 כפי ש `drizzle-kit` הבין אותה, 24 טבלאות ו 16 enums. `prevId` של אפסים. נקרא רק על ידי `drizzle-kit` |
| `apps/api/src/db/migrations/meta/0001_snapshot.json` | תמונה אחרי 0001, 30 טבלאות, כולל `dashboard_banner`. משורשרת לקודמת דרך `prevId`. עד 0003 ה snapshot תואם למסד בלי פער |
| `apps/api/src/db/migrations/meta/0002_snapshot.json` | תמונה אחרי 0002, 31 טבלאות ו 17 enums, עם `bin_transfer` ו `billing_trigger`. אינה מכירה את ה `UPDATE` ים שנוספו ביד, כי snapshot מתאר רק מבנה |
| `apps/api/src/db/migrations/meta/0003_snapshot.json` | התמונה האחרונה שקיימת, 30 טבלאות, הסכמה של 2026-07-26, והבסיס ש `drizzle-kit generate` משווה אליו את ה TypeScript. מבחינת `drizzle-kit` אין `wallet_request`, `parcel`, `escrow_deal` או `membership` |

**שים לב.** המיגרטור מריץ רק רשומות שה `when` שלהן גדול מה `created_at` האחרון ב `drizzle.__drizzle_migrations`, ולכן רשומה חדשה עם `when` שאינו גדול מ 1785074600000 של 0030 תדולג בשקט. יש לכתוב `Date.now()`. שינוי `tag` בלי שינוי שם הקובץ מפיל את המיגרטור. `drizzle-kit generate` היום שואל שאלה אינטראקטיבית ומייצר קובץ של כ 426 שורות עם 19 `CREATE TABLE` לטבלאות קיימות ו `DROP COLUMN` ל `display_name` ול `capacity`, שנכשל על כל מסד קיים ועוצר פריסה. כתבו מיגרציה ביד והוסיפו רשומה ליומן בעצמכם, הצהירו ב `*.schema.ts` גם על האינדקסים, ה FK וה CHECK שהיא יוצרת, הוסיפו טבלת היסטוריה חדשה לשני המערכים בקובץ ההגנות, אל תשתמשו בערך enum חדש באותה ריצה, ופצלו שינוי שקוד ישן לא יסבול לשתי פריסות, קודם הרחבה ורק אחר כך צמצום. במסד המקומי 31 ה hash ים ב `__drizzle_migrations` שווים לקבצים וה `created_at` שווה ל `when`, אבל המיגרטור אינו משווה hash, ולכן בייצור צריך להריץ את אותה בדיקה. שתי דרכים לסדר את זה. להכריז שהמיגרציות ידניות, לתעד שה snapshots קפואים ולהוסיף סקריפט שמוסיף רשומה ליומן, או להשלים את הסכמה ב TypeScript ולייצר snapshot בסיס חדש מהמסד. הראשונה זולה ובטוחה יותר.

**שים לב.** כך מתנהגות פעולות נפוצות ב Postgres 16 כשכל המיגרציות הממתינות רצות בטרנזקציה אחת, והנעילה של הראשונה מוחזקת עד סוף האחרונה. לכן כדאי לפתוח כל קובץ חדש ב `SET LOCAL lock_timeout = '5s'` ו `SET LOCAL statement_timeout = '60s'`, ולא לצבור מיגרציות לפריסה אחת.

| פעולה | בטוח על מסד חי | איך עושים נכון |
|---|---|---|
| `ADD COLUMN` nullable או עם ברירת מחדל קבועה | כן, נעילה רגעית בלי שכתוב | `lock_timeout` כדי שתיכשל ולא תחסום תור |
| `ADD COLUMN ... DEFAULT now()` | לא, משכתב ומקבע את זמן המיגרציה בשורות ישנות | בלי ברירת מחדל, מילוי באצוות, ואז ברירת מחדל |
| `SET NOT NULL` | רק בטבלה קטנה, סריקה תחת `ACCESS EXCLUSIVE` | CHECK `IS NOT NULL` כ `NOT VALID`, `VALIDATE`, ואז `SET NOT NULL` בלי סריקה |
| `ADD CONSTRAINT` של CHECK או FK | רק בטבלה קטנה | `NOT VALID` ואז `VALIDATE CONSTRAINT`. `VALIDATE` אינו מפעיל טריגר `UPDATE` ולכן עובד גם על יומן מוגן |
| `CREATE INDEX` ו `CREATE UNIQUE INDEX` | רק בטבלה קטנה, חוסם כתיבות. unique נכשל על כפילות | `CONCURRENTLY` מחוץ למיגרטור ב `psql` מול `DIRECT_DATABASE_URL`, בדיקת `pg_index.indisvalid`, ואחריו מיגרציה עם `IF NOT EXISTS` באותו שם למסדים חדשים. לפני unique, שאילתת כפילויות וניקוי כמו ב 0020 |
| `ALTER COLUMN ... TYPE` | לא, משכתב טבלה ואינדקסים | עמודה חדשה, כתיבה כפולה, backfill באצוות, FK `NOT VALID`, מעבר קריאה, ורק אז מחיקת הישנה. כך ממירים `item.owner_id` ל `uuid` |
| `RENAME COLUMN` ו `DROP COLUMN` | לא, שובר קוד ישן שעדיין רץ | הרחבה וצמצום בכמה פריסות |
| `ALTER TYPE ... ADD VALUE` | כן | לא להשתמש בערך באותה ריצה |
| `UPDATE` גדול של backfill | לא בטבלה גדולה, נועל כל שורה עד סוף הריצה | אצוות של אלפי שורות מחוץ למיגרטור |

**שים לב.** אחרי כל הרצה בייצור כדאי לבדוק ש `select count(*) from pg_trigger where not tgisinternal` מחזיר 12, שה cast מ `text` ל `uuid` קיים ב `pg_cast`, ושהשורה האחרונה ב `drizzle.__drizzle_migrations` תואמת לרשומה האחרונה ביומן. מיגרציה שנבדקה רק על מסד ריק לא נבדקה, ו `infra/ops/backup.sh dump` ואז `verify` נותנים עותק משוחזר להרצה ולמדידה. לעולם לא להריץ `seed.ts` מול נתונים אמיתיים, הוא מתחיל ב `TRUNCATE` ואין בו בדיקת `NODE_ENV`.

## פרק 4. חשבונות, אימות, אבטחה, מדיה, תמיכה, כסף, תמחור ונאמנות

### סקירה

שני נושאים, מי אתה ומה קורה לכסף שלך. `sec` מגדיר את `AuthUser`, התפקידים וה audit. `acc` הופך cookie למשתמש ומנהל רישום, התחברות, סיסמאות ופרופיל. `med` מעלה תמונות, `sup` מנהל כרטיסי תמיכה. בחצי הכסף, `pay` מחזיק את הלדג'ר, הארנק, החיובים, ה checkout ובקשות הארנק, `prc` עונה כמה עולה פעולה, ו `esc` מנהל עסקאות נאמנות שמזיזות כסף ובעלות יחד.

סדר הקריאה הוא סדר הקבצים כאן. קודם `sec`, החוזה המשותף, `roles.guard.ts` וה audit. אחר כך `acc` לפי מסלול בקשה, `session-auth.guard.ts`, `session.service.ts`, ואז `auth.service.ts` ו `auth.controller.ts`. משם media ותמיכה. בכסף מתחילים ב `ledger.service.ts`, כי כל השאר רק כותב אליו שורות, ואז תמחור, `billing.service.ts`, `checkout.service.ts`, בקשות ארנק ולבסוף escrow.

שני פרקי רוחב קודמים לקבצים, מסע של בקשה מאומתת ומסלול הכסף. בסוף האזור יש מה ה SPA מניח, החלטות תכנון, שינויים נפוצים, בדיקות, בקרות, ממצאים לפי חומרה ותוכניות תיקון. שאלה אחת מלווה את כל חצי הכסף. היתרה נגזרת מסכום שורות ואין שורה לנעול. לכן כל בדיקת יתרה ואחריה חיוב היא מקום לבזבוז כפול, E1 ו E18. בכל הריפו אין `pg_advisory_xact_lock` ואין SERIALIZABLE.

```mermaid
flowchart LR
  REQ[בקשה] --> TH[Throttler] --> SA[SessionAuthGuard] --> RG[RolesGuard] --> AU[AuditInterceptor] --> H[handler]
  H --> SVC[services] --> L[(ledger_record)]
  PRC[(pricing_rule)] --> SVC
```

### מסע של בקשה מאומתת

סדר השכבות שכל בקשה עוברת. מי ששובר שכבה אחת צריך לדעת מה נשאר מאחוריה.

1. `main.ts` שורה 68, `trust proxy` לפי `TRUST_PROXY`. ממנו נגזר `req.ip` לרייט לימיט, ל `login_session` ול `login_attempt`, E14.
2. `helmet` בשורה 78 בלי CSP, `json` עם תקרה של 16 MB בשורה 90, ו CORS מפורש עם credentials בשורה 102.
3. `ThrottlerGuard`, `app.module.ts` שורה 98. שני דליים, `default` של `RATE_LIMIT_PER_MINUTE` ו `auth` של `AUTH_RATE_LIMIT_PER_MINUTE`, בזיכרון התהליך.
4. `SessionAuthGuard`, שורה 99. cookie מול המסד, חסימת `suspended` ו `closed`, 401 למסלול לא ציבורי.
5. `RolesGuard`, שורה 100. `@Roles` על handler או class.
6. `AuditInterceptor`, שורה 101, מחשב יעד לפני ה handler ורושם אחרי הצלחה.
7. `ValidationPipe` הגלובלי, `main.ts` שורות 130 עד 137, עם `whitelist`, `transform` ו `forbidNonWhitelisted`.
8. בדיקות בעלות בתוך כל service לפי `userId` מה session. אין שכבת authorization מרכזית.
9. triggers במסד, append only על `audit_record`, `login_attempt`, `support_message`, `ledger_record` וטבלאות אירועים, ו `user_account_username_immutable`.

#### רייט לימיט בפועל

ב `@nestjs/throttler` כל throttler שהוגדר ב `forRoot` רץ על כל מסלול, ואין בקוד אף `@SkipThrottle`. `@Throttle` רק דורס limit של דלי בשם. מפתח המונה הוא class, handler, שם הדלי ו IP. לכן דלי `auth`, ברירת מחדל 30, הוא התקרה של כל מסלול ב API, והמונה הוא per route ולא per IP על כל ה API. מפעיל שסורק 31 פריטים בדקה לאותו מסלול יקבל 429. ה CI מעלה את הערך ל 5000. שני replicas מכפילים כל תקציב ו restart מאפס. התיקון שההערות מתארות הוא `@SkipThrottle({ auth: true })` על controllers שאינם זהות, או להוציא את `auth` מהרשימה הגלובלית.

#### מחזור החיים של session

- **לידה.** רק `AuthService.login` יוצר session. רישום, אימות מייל ואיפוס סיסמה לא מחברים. הטוקן 256 ביט אקראיים, במסד רק `sha256` שלו. `SESSION_COOKIE_SECRET` נדרש בקונפיגורציה ולא נקרא, ומפעיל שמסובב אותו אחרי דליפה לא משיג דבר. התגובה הנכונה לדליפה היא ביטול sessions.
- **cookie.** נכתב רק ב `auth.controller.ts` שורות 194 עד 202.

| מאפיין | ערך | הערה |
|---|---|---|
| שם | `SESSION_COOKIE_NAME`, ברירת מחדל `session` | אין prefix `__Host-` |
| `HttpOnly` | כן | ה SPA לא יכול לקרוא או למחוק |
| `Secure` | רק ב `NODE_ENV === 'production'` | ה Dockerfile קובע production |
| `SameSite` | `Lax` | כל הגנת ה CSRF |
| `Expires` | שבעה ימים, כמו במסד | אין `Max-Age` |
| `Path` ו `Domain` | `/`, בלי Domain | host only |

- **CSRF.** `Lax` שולח cookie בבקשה cross site רק בניווט עליון עם GET. כל מסלולי השינוי הם POST, PUT, PATCH ו DELETE, ואין GET שכותב למסד, כך ש `Lax` ו CORS מספיקים. שני דברים שוברים את זה, GET שמשנה מצב או `CORS_ORIGINS` רחב. אין בדיקה אוטומטית לאף אחד מהם. XSS על subdomain אח עוקף `Lax` ממילא.
- **פקיעה.** שבעה ימים קבועים, בלי sliding ובלי refresh. שורות לא נמחקות לעולם.
- **ביטול.** `logout` מבטל שורה אחת. שינוי סיסמה מבטל הכל חוץ מהנוכחי, איפוס מבטל הכל, ו `sessions/revoke-others` מבטל הכל חוץ מהנוכחי בלי לשנות סיסמה. מיידי, כי כל בקשה עוברת במסד.
- **השעיה וסגירה.** הסטטוס נקרא מחדש בכל בקשה, ולכן השעיה מאדמין ב `PATCH /admin/users/:id` או מה worker `wallet-suspension.ts` חלה בבקשה הבאה. `suspended` מגיע רק ל `@AllowSuspended`, `closed` לא מגיע לשום דבר.

#### תרחישי זהות, מה רץ ומה נכתב

| תרחיש | מה נכתב במסד | תשובה |
|---|---|---|
| רישום | `user_account` ב `pending` עם `role: 'user'`, `verification_token` של אימות, מייל | 201 `pending_verification`, בלי cookie |
| לחיצה על קישור אימות | `consumed_at` על הטוקן, `status: 'active'` | 200, המשתמש עדיין לא מחובר |
| login תקין | `login_session` חדש, `login_attempt` `success`, audit עם actor | 200 `{ id, role }` ו cookie |
| login עם סיסמה שגויה או משתמש לא קיים | `login_attempt` `bad_credentials` | 401 אחיד בגוף, שונה בזמן |
| login של `pending` | `login_attempt` `unverified` | 403 `email_unverified` |
| login של `suspended` | session ו `success` | 200, אבל רק `@AllowSuspended` נגיש אחר כך |
| login של `closed` | `login_attempt` `refused` | 403 `account_suspended` |
| מושעה עם cookie על כל מסלול אחר, כולל logout | כלום | 403 `account_suspended` |
| `closed` עם cookie תקף, גם על login ומסלולים ציבוריים | כלום | 403 עד שה cookie פג |
| logout | `revoked_at` על השורה | 204 ומחיקת cookie |
| שינוי סיסמה | hash חדש, `revoked_at` על כל השאר | 200 עם מספר ה sessions שבוטלו |
| בקשת איפוס לכתובת קיימת | `verification_token` של איפוס ומייל | 202, אבל איטי יותר מכתובת שלא קיימת |
| ביצוע איפוס | `consumed_at`, hash חדש, ביטול כל ה sessions | 200, צריך להתחבר מחדש |
| השעיה אוטומטית על חוב | `user_account.status` מה worker, בלי audit | חלה בבקשה הבאה |

#### שגיאות שהאזור מחזיר

`AppError` ב `shared/errors/app-error.ts` נושא `code` מ `error-codes.ts` ו status. ה SPA מחליט לפי ה code, ולכן שינוי code הוא שינוי חוזה.

| factory או code | status | איפה באזור |
|---|---|---|
| `validation`, `validation_failed` | 400 | DTOs, `Current password is incorrect`, ולידציות ב services |
| `unauthenticated` | 401 | guard, `@CurrentUser`, login שגוי |
| `forbidden` | 403 | `RolesGuard`, הפרדת תפקידים, `isReviewer` |
| `account_suspended` | 403 | guard ו login לחשבון לא פעיל |
| `email_unverified` | 403 | login של `pending`, ה SPA מציע שליחה מחדש |
| `notFound` | 404 | `loadFor` בכל מודול, גם לישות של אחר |
| `conflict`, `insufficient_balance` | 409 | משיכה, מימון escrow, השלמה כפולה, כפילות בקשה |
| `negative_balance_blocked` | 409 | `assertNotBlocked` |
| `tokenExpired`, `token_expired` | 410 | טוקן מייל, `withdrawals/confirm` |
| `Error` רגיל | 500 | אדפטר PayPal, כולל כשל אימות webhook, ו `putObject` |
| SQLSTATE `22P02` | 400 | מזהה שאינו uuid, דרך `all-exceptions.filter.ts` |

### sec, זהות משותפת ו audit

`sec` מגדיר את החוזה שכל controller במערכת נשען עליו, מי המשתמש, איזה תפקיד נדרש, ומה נרשם אחרי שינוי. אין בו לוגיקה עסקית ואין בו בדיקת בעלות.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/sec/sec.module.ts` | דפוס P1. `@Global`, מספק ומייצא `AuditService`, `AuditInterceptor`, `RolesGuard`, `PiiInterceptor`. ה guard וה interceptor הפעילים נוצרים מחדש כ `APP_GUARD` ו `APP_INTERCEPTOR` ב `app.module.ts`, כך שהעותקים כאן לא משרתים בקשות. הסרת `@Global` שוברת את ההזרקה של `AuditService` ב `pay`. |
| `apps/api/src/modules/sec/auth-context.ts` | שורות 7 עד 14 הטיפוסים `Role`, `AccountStatus`, `AuthUser` עם `id`, `role`, `status` בלבד. שורות 16 עד 23 מרחיבות את `Express.Request` כך ש `req.user` typed ואופציונלי. משכפל ידנית את ה enums במסד, אין קשר מכני. תפקיד חדש דורש migration, עדכון כאן, `SupportService.staff` וכל `@Roles`. |
| `apps/api/src/modules/sec/current-user.decorator.ts` | `@CurrentUser()` שולף את `req.user` וזורק 401 אם חסר, כך שה handler מקבל `AuthUser` ולא undefined. רשת ביטחון שנייה אחרי ה guard, משנה רק במסלול `@Public` שמשתמש בו. |
| `apps/api/src/modules/sec/roles.decorator.ts` | `@Roles(...)` שומר רשימה תחת `required_roles`. שינוי המפתח בלי ה guard הופך כל מסלול מוגן לפתוח, fail open. |

#### `apps/api/src/modules/sec/roles.guard.ts`
guard גלובלי שלישי, אחרי ה throttler ו `SessionAuthGuard`, לפי סדר הרישום ב `app.module.ts`. דפוס P2.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 22 | `getAllAndOverride` קורא תפקידים מה handler ואז מה class, הראשון שנמצא מנצח | `@Roles` על method דורס את ה class ולא מתווסף. מעבר ל `getAllAndMerge` ירחיב הרשאות בשקט |
| 22 | אין רשימה או רשימה ריקה, עובר | הפוך מ deny by default. מסלול staff ששכח `@Roles` פתוח לכל לקוח. `@Roles()` ריק שווה לכלום |
| 24 עד 30 | בלי `req.user` 401, תפקיד לא ברשימה 403 עם שמות התפקידים | אין היררכיה, `admin` לא עובר מסלול `warehouse_operator` בלבד, ולכן מסלולי מחסן מסמנים את שניהם. אין בדיקת `status` ואין בדיקת בעלות |

**שים לב.** בעלות על נתונים נבדקת רק בתוך כל service לפי `userId`. מסלול חדש ששוכח לסנן הוא IDOR. הזזת ה guard לפני `SessionAuthGuard` תחזיר 401 לכל מסלול `@Roles`.

#### `apps/api/src/modules/sec/audit.interceptor.ts`
interceptor גלובלי שכותב שורה ל `audit_record` על כל בקשה משנה מצב שהצליחה. נרשם כ `APP_INTERCEPTOR`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13, 19 עד 21 | `MUTATING` הוא POST, PUT, PATCH, DELETE. כל השאר עובר בלי עלות | נכון רק כל עוד אין GET שמשנה מצב, ואין היום |
| 23 עד 34 | לפני ה handler. `targetEntity` הוא המקטע הראשון אחרי `/api/v1/`, `targetId` מאחד משישה שמות params. שורה 34 מטפלת במערך של Express 5 | `targetEntity` הוא שם controller ולא ישות. `batchId`, `binId`, `parcelId`, `paymentId` לא נתפסים ונרשם id ריק |
| 36 עד 49 | `tap` אחרי הצלחה בלבד, `void this.audit.record` בלי await, `actorId` מ `req.user`, `metadata` רק `params` | כישלונות, כולל IDOR שנדחה, לא נרשמים. `.catch(() => undefined)` בולע הכל, וההערה בשורה 38 שטוענת שזה נרשם ללוג שגויה. לא אטומי עם השינוי. worker jobs לא עוברים כאן |

**שים לב.** אין body, query, IP או status code. הוספת `body` ל metadata תכניס סיסמאות וטוקנים לטבלה append only שאי אפשר לנקות, זה השינוי המסוכן ביותר. רישום כישלונות דורש סינון מראש, אחרת כל 401 של סורק נשמר לנצח. הפיכת הרישום ל await בתוך `mergeMap` תעכב כל תשובה ותהפוך כשל ב audit ל 500 אחרי שהשינוי כבר נשמר, גרוע מהמצב היום. `occurred_at` נקבע במסד ברגע ה INSERT, מילישניות אחרי השינוי. `auth.controller.ts` קובע `req.user` ב login בדיוק בשביל השורה הזו, ואין בדיקה שתתפוס את הסרתו.

#### `apps/api/src/modules/sec/audit.service.ts`
INSERT אחד ל `audit_record`. שורות 6 עד 12 `AuditEntry`, רק `action` חובה. שורות 23 עד 32 `record`, משתמש ב `tx` אם הועבר ואחרת בחיבור הרגיל, `metadata` חסר נשמר כ `{}`.

**שים לב.** הקוראים הידניים הם `chargeback.service.ts` ו `wallet-request.service.ts`, בתוך טרנזקציה, כך שכשל ב audit מגלגל את השינוי. הוספת `try` כאן תשבור את זה. אי השינוי נאכף ב trigger של `0001_append_only.sql`, לא בקוד.

#### `apps/api/src/modules/sec/pii.ts`
`@Pii()` ו `PiiInterceptor` להסתרת שדות ממי שאינו admin. קוד מת, אין אף שימוש.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 6 עד 19 | הערה שמתארת מנגנון פעיל ומפנה ל `profile.dto` | הקבצים לא קיימים. ההערה ב `profile.service.ts` חוזרת על הטענה. שתיהן שגויות |
| 20 עד 29 | `PII_FIELDS`, Map מ constructor לשמות שדות, ו `Pii()` שמוסיף אליו | `reflect-metadata` מיובא ולא בשימוש |
| 31 עד 47 | ה interceptor מחשב `isAdmin` ומריץ `redact`, שמוחק שדות לפי `data.constructor` | services מחזירים plain objects שה constructor שלהם `Object`, לכן לא יסונן דבר גם אם יחובר. אובייקטים מקוננים לא נסרקים |

**שים לב.** הגנת ה PII האמיתית היא בחירת עמודות ידנית ב `select` בכל service.

### acc, זהות, sessions ופרופיל

`acc` הוא הבעלים של `user_account` ושל כל מה שמחבר אדם לבקשה. רק `SessionService` מיוצא, כדי שה guard הגלובלי יעלה. שליחת מייל, שינוי סיסמה ופרופיל לא נגישים למודולים אחרים, וזה גבול טוב.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/acc/acc.module.ts` | דפוס P1. שני controllers וחמישה services. ה export של `SessionService` הכרחי, כי `SessionAuthGuard` נבנה כ `APP_GUARD` בהקשר של `AppModule`. בלעדיו האפליקציה לא עולה. ה export של ה guard עצמו מיותר. |
| `apps/api/src/modules/acc/public.decorator.ts` | `@Public()` תחת `is_public`. אם יש cookie תקף, `req.user` עדיין נקבע, ו `@Public` לא פוטר מבדיקת status. על class הוא פותח את כל ה methods ואין decorator הפוך. |
| `apps/api/src/modules/acc/allow-suspended.decorator.ts` | `@AllowSuspended()` תחת `allow_suspended`. בשימוש ב `GET /me/profile` ובחמשת מסלולי הלקוח של התמיכה, למרות שההערה אומרת כרטיסים בלבד. `closed` לא נכלל בכוונה. הוספתו למסלול כספי מבטלת את ההשעיה. |
| `apps/api/src/modules/acc/intake-id.ts` | מחולל `OW-XXXXXX` מאלפבית בלי תווים מבלבלים. קוד מת, הוחלף ב username. |

#### הטבלאות ש acc נוגע בהן

| טבלה | עמודות שהקוד כאן קורא או כותב | הערה |
|---|---|---|
| `user_account` | `email`, `username`, `password_hash`, `status`, `role`, `first_name`, `last_name`, `name_review_required`, `auto_suspended_at` | email ו username ייחודיים, username קבוע ב trigger. `intake_id` ו `legacy_display_name` שרידים, לא נחשפים בפרופיל |
| `login_session` | `user_id` כטקסט, `token_hash`, `expires_at`, `revoked_at`, `ip`, `user_agent` | בלי foreign key, כמו בכל המערכת |
| `login_attempt` | `identifier`, `user_id`, `outcome`, `ip`, `user_agent`, `occurred_at` | append only, אינדקסים לפי זמן ומשתמש בשביל מסך האדמין |
| `verification_token` | `type` אימות או איפוס, `token_hash`, `expires_at`, `consumed_at` | |
| `shipping_address` | `label`, `recipient`, `line1`, `city`, `country`, `postal_code`, `is_default` | אין אינדקס לברירת מחדל יחידה |

#### `apps/api/src/modules/acc/session-auth.guard.ts`
שער הכניסה של כל ה API. guard גלובלי שני, אחרי ה throttler ולפני `RolesGuard`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 32 | `cookieName` נקרא פעם אחת מ `SESSION_COOKIE_NAME` | שינוי דורש restart |
| 39 עד 50 | קורא `@Public` ו `@AllowSuspended` מה handler וה class, ומפרסר את ה cookie | אין `cookie-parser`, `req.cookies` לא קיים |
| 52 עד 61 | `resolve`. cookie פג או מבוטל מתנהג כמו היעדר cookie. מותר `active`, או `suspended` במסלול מסומן, כל השאר 403 `account_suspended`. רק אז `req.user` נקבע | deny by default לסטטוסים עתידיים |
| 63 עד 65 | מסלול ציבורי עובר, אחרת בלי משתמש 401 | |
| 68 עד 72 | `readSessionCookie` עם `parse` של הספרייה `cookie` | שני cookies באותו שם, הראשון מנצח. סיכון cookie tossing תלוי פריסה |

**שים לב.** בדיקת הסטטוס קודמת ל `@Public`, וזה ממצא. חשבון `closed` או `suspended` עם cookie תקף מקבל 403 גם על login ועל מסלולי שוק ציבוריים. `POST /auth/logout` לא `@Public` ולא `@AllowSuspended`, וה cookie `HttpOnly`, כך שמושעה לא יכול להתנתק ונשאר תקוע עד שבעה ימים. אין cache, כל בקשה היא JOIN אחד, וזה מה שהופך logout, השעיה ושינוי תפקיד למיידיים. cache ישבור את זה. אין בדיקת מטריצה למושעה, `tests/integration/acc-status-block.test.ts` שורות 41 ו 42 הן TODO. שני תיקונים אפשריים. להחליף את הסדר כך ש `@Public` עובר לפני ה resolve, והמחיר היחיד הוא audit בלי actor במסלולים ציבוריים. או להמשיך לעשות resolve, ובמסלול ציבורי לא לזרוק על סטטוס אלא רק לא לקבוע `req.user`, ובנוסף לסמן את `logout` כ `@Public` כדי שינקה cookie בכל מצב. ה guard לא כותב כלום, ואין לו גישה ל response, ולכן הוא לא יכול לרענן cookie.

#### `apps/api/src/modules/acc/session.service.ts`
המקום היחיד שנוגע ב `login_session`. קוראים לו ה guard, `auth.service.ts`, `password.service.ts` ו `auth.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 | `SESSION_TTL_MS` שבעה ימים קבועים | אין sliding expiry ואין refresh |
| 12 עד 25 | `ClientOrigin` ו `clampUserAgent`, null לריק וקיצוץ ל 300 תווים | מיוצא ומשמש גם את `login_attempt`. ה IP לא מקוצץ, הוא מגיע מ `req.ip` של Express ולא ישירות מכותרת, ולכן תלוי ב `TRUST_PROXY` |
| 36 עד 50 | `create` מגריל 32 בייטים כ hex, שומר רק `sha256`, מחזיר את הגולמי ואת התוקף | אין מגבלת sessions ואין ביטול session קודם. כל login שורה חדשה |
| 53 עד 69 | `resolve`, JOIN ל `user_account` לפי hash ו `revoked_at IS NULL`, תוקף נבדק ב JS. מחזיר `id`, `role`, `status` עדכניים | שורה 63 כותבת `id::text = user_id`, וה cast על צד ה uuid מונע את אינדקס המפתח הראשי. `eq(userAccount.id, loginSession.userId)` היה משתמש בו. `revokedAt` נבחר ולא נקרא |
| 71 עד 76 | `revoke` מסמן `revoked_at` לפי hash | בלי תנאי ובלי ספירה, logout עם cookie מזויף מצליח בשקט |
| 96 עד 107 | `revokeAllFor` מבטל את כל הפעילים של משתמש, עם חריג אופציונלי לטוקן הנוכחי, ומחזיר ספירה | סופר גם sessions שפגו ולא בוטלו, כך שהמספר למשתמש מנופח |

**שים לב.** אין ניקוי. שורות לא נמחקות לעולם, ומיגרציה 0024 יוצרת אינדקס `login_session_user_idx` ל sweep שלא קיים, וההערה שם קוראת לפונקציה `verify` שאינה קיימת. האינדקס החלקי `login_session_token_active_idx` תואם בדיוק את ה WHERE של `resolve`. העברת בדיקת התוקף ל SQL עם `gt(loginSession.expiresAt, new Date())` בטוחה. הפיכת ה TTL למשתנה סביבה לא דורשת שינוי ב cookie, כי `setSessionCookie` מקבל את `expiresAt` מכאן. sliding expiry יהפוך את `resolve` לכותב בכל בקשה, ויש לעשות אותו מדורג. `SESSION_COOKIE_SECRET` נדרש בקונפיגורציה ולא נקרא, כי אין חתימה, ה DB הוא מקור האמת.

#### `apps/api/src/modules/acc/acc.dto.ts`
DTOs של `/auth` ושל `/me/profile` ב class-validator, לא zod. דפוס P4 במהות. ה `ValidationPipe` הגלובלי עם `transform` ו `forbidNonWhitelisted` מריץ transforms ואז validators ומפיל כל שדה לא מוכר, וזה מה שמונע הזרקת `role`, `status` או `username`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 23 | `trimmed` מקצץ מחרוזות לפני הוולידציה. `NAME_PART_RULE` אוסר `<`, `>` ותווי בקרה C0 | לא חוסם תווי כיווניות כמו `U+202E` ולא C1, הטעיה חזותית במסכי אדמין |
| 26 עד 70 | `RegisterDto`. email בלי trim, ולכן כתובת עם רווח נדחית כאן אף שה service מקצץ, username 3 עד 32 עם `[A-Za-z0-9_.-]`, שמות 1 עד 80, סיסמה `MinLength(8)` בלי trim | ה regex בלי `@` הוא מה שמאפשר ל login לחפש email או username בשדה אחד. אין MaxLength, blocklist או MFA. אין שדה הסכמה לתנאים, חלק מ E21 |
| 72 עד 85 | `LoginDto`, `identifier` מקוצץ 3 עד 254, סיסמה בלי מינימום | בכוונה, לא לחסום חשבונות ישנים |
| 87 עד 113 | `TokenDto`, `EmailDto`, `ResetPasswordDto`, `ChangePasswordDto` | שינוי מדיניות סיסמה חייב לגעת בשלושה DTOs יחד. `trimmed` על סיסמה ישבור התחברות של סיסמאות קיימות עם רווח |
| 121 עד 135 | `UpdateProfileDto`, רק שני חלקי השם | שכבה ראשונה לאי שינוי username. השנייה trigger ממיגרציה 0004 |

#### `apps/api/src/modules/acc/auth.service.ts`
רישום והתחברות. נקרא רק מ `auth.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 33 עד 50 | נרמול. email ל lowercase, username דרך `normalizeUsername` ו `isValidUsername`, שמות דרך `normalizeNamePart` | בדיקה כפולה אחרי ה DTO, מכוונת |
| 52 עד 64 | שתי שאילתות ייחודיות עם הודעות שונות | Email is already registered חושף קיום email, בניגוד לזהירות ב reset. 30 בדיקות לדקה ל IP. התיקון המלא הוא להחזיר תמיד `pending_verification` ולשלוח מייל לבעל הכתובת. איחוד ההודעה של username ישבור את `sec-validation.test.ts` שורה 246 |
| 66 | `argon2.hash` בברירות מחדל, argon2id, 64 MiB, שלוש איטרציות וארבעה threads | כל hash או verify תופס 64 MiB, ומאה ניסיונות במקביל הם כ 6.4 GB. רייט לימיט per IP לא עוצר תוקף מבוזר. אין `needsRehash`, ופרמטרים חדשים חלים רק על hashes חדשים כי `verify` קורא אותם מה hash |
| 71 עד 92 | INSERT עם `status: 'pending'` ו `role: 'user'` קבועים, `23505` הופך להודעה כללית, ואז `issueEmailVerification` | ה unique index הוא הערובה. המייל מחוץ לטרנזקציה, כשל SMTP מחזיר 500 על חשבון שכבר נוצר, וניסיון חוזר נתקל ב Email is already registered |
| 100 עד 120 | login. חיפוש `email = x OR username = x`, וכישלון רושם `bad_credentials` וזורק 401 אחיד | E13 בשורה 117. בלי משתמש ה `\|\|` מדלג על `argon2.verify`, התשובה מהירה בעשרות מילישניות וחושפת קיום חשבון. התיקון verify מול hash דמה. אין נעילה per account |
| 131 עד 136 | `pending` מקבל 403 `email_unverified` ונרשם `unverified` | |
| 155 עד 159 | כל מה שאינו `active` או `suspended` מקבל 403 ונרשם `refused` | `suspended` מקבל session בכוונה, כדי להגיע לתמיכה. הסרת `'suspended'` כאן תנעל מושעה על חוב |
| 161 עד 163 | `sessions.create`, רישום `success`, החזרת משתמש וטוקן | session נוצר רק אחרי כל הבדיקות, אין fixation |
| 174 עד 192 | `recordAttempt`, INSERT ל `login_attempt` עטוף ב `try` עם `console.error`, מזהה מקוצץ ל 254 | שומר את מה שהוקלד, כולל emails של מי שאינו לקוח וסיסמה שהוקלדה בשדה המזהה, בטבלה append only בלי retention. `adm.service.ts` מציג אותה לאדמין ב `GET /admin/logins`. הנתונים מספיקים לנעילה per account, ושום קוד לא קורא אותם לשם כך |
| 196 עד 198 | `isUniqueViolation` מזהה SQLSTATE `23505` | |

#### `apps/api/src/modules/acc/auth.controller.ts`
כל מסלולי `/auth`, והמקום היחיד שכותב ומוחק את ה cookie. דפוס P2 עם `@Throttle` ו `@Res({ passthrough: true })`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22, 34 | `CREDENTIAL_ROUTE` דורס את דלי `auth` לערך `AUTH_RATE_LIMIT_PER_MINUTE`. `MAIL_ROUTE` חמש לדקה | `CREDENTIAL_ROUTE` לא עושה כלום, זה הערך הגלובלי ממילא. imports מופיעים גם אחרי ההגדרות, חוקי בגלל hoisting |
| 68 עד 80 | `POST register`, ציבורי, מחזיר `pending_verification` בלי session | |
| 82 עד 88 | `POST verify-email`, ציבורי, מחזיר `active` | לא מחבר את המשתמש |
| 90 עד 97 | `POST verify-email/resend`, חמש לדקה, תמיד 202 `sent_if_pending` | חוץ מכשל SMTP, שמחזיר 500 רק לכתובת קיימת. המונה per route, כך שעם `reset-request` יוצאים עשרה מיילים לדקה ל IP |
| 99 עד 121 | `POST login`. מעביר `req.ip` ו user agent, קובע `req.user` בשורה 118 בשביל ה audit, כותב cookie ומחזיר `{ id, role }` | login עם cookie קיים דורס אותו בדפדפן אבל לא מבטל את השורה הישנה. הסרת `passthrough` תתקע את הבקשה |
| 123 עד 129 | `POST logout`, מבטל את השורה ו `clearCookie`, 204 | לא ציבורי ולא `@AllowSuspended`, מושעה לא מתנתק. `clearCookie` שולח `Expires` של 1970 עם `Path=/`, ושינוי ה path של ה cookie ל `/api` מחייב שינוי גם כאן |
| 131 עד 138 | `POST password/reset-request`, ציבורי, חמש לדקה, תמיד 202 `sent_if_exists` | הגוף אחיד, הזמן לא, ראה `verification.service.ts`. מכוסה בקצב ב `sec-authorization.test.ts` שורות 389 עד 410 |
| 140 עד 147 | `POST password/reset`, ציבורי, מחזיר `password_changed` | טוקן לא תקף, נצרך או פג מחזיר 410. לא מחבר, המשתמש צריך להתחבר מחדש |
| 156 עד 171 | `POST password/change`, דורש session, מעביר את הטוקן הגולמי כדי לשמור את ה session הנוכחי, ומחזיר `otherSessionsEnded` | סיסמה נוכחית שגויה מחזירה 400, לא 401 |
| 181 עד 186 | `POST sessions/revoke-others`, מבטל את כל השאר בלי לשנות סיסמה ומחזיר ספירה | הספירה כוללת sessions שפגו ולא בוטלו |
| 189 עד 192 | `rawSessionToken`, parse של כותרת ה cookie | כפילות של `readSessionCookie` ב guard ושל הקוד ב `logout` |
| 194 עד 202 | `setSessionCookie`, כתיבת cookie עם `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` כמו במסד, `Secure` רק ב `NODE_ENV === 'production'` | אותו parse כתוב שלוש פעמים בקוד. אין prefix `__Host-`. הרצה מחוץ ל Docker בלי `NODE_ENV` שולחת cookie על HTTP |

**שים לב.** הרייט לימיט האמיתי מוסבר במסע של בקשה מאומתת. הגנת CSRF היא רק `SameSite=Lax` ו CORS, ו E8 מראה שה API מקבל גם גוף טופס ב login. כתובת ה IP תלויה ב `TRUST_PROXY`, E14.

#### `apps/api/src/modules/acc/password.service.ts`
שינוי סיסמה, בקשת איפוס וביצוע איפוס. נקרא מ `auth.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 39 עד 62 | `change` מאמת את הסיסמה הנוכחית, 400 ולא 401 על טעות, UPDATE של hash, ואז `revokeAllFor` חוץ מהנוכחי | 400 כדי שה SPA לא יחשוב שה session פג. ניחושים לא נרשמים ב `login_attempt` |
| 64 עד 66 | `requestReset` מנרמל ומעביר ל `issuePasswordReset` | |
| 68 עד 83 | `reset` מחפש טוקן לפי סוג ו hash, 410 אם חסר, נצרך או פג | הבדיקה מחוץ לטרנזקציה |
| 85 עד 94 | טרנזקציה שמסמנת `consumed_at` ומעדכנת hash, עם `argon2.hash` בפנים, כך שנעילות על הטוקן והמשתמש מוחזקות עשרות מילישניות | ה UPDATE לא מותנה ב `consumed_at IS NULL`. שתי בקשות מקבילות עם אותו טוקן יצליחו. תיקון מקומי, `isNull` ובדיקת `returning` |
| 100 | `revokeAllFor` בלי חריג | מחוץ לטרנזקציה. הכנסתו פנימה דורשת ש `revokeAllFor` יקבל `tx`. ביטול גם של מי שמאפס נכון, כי הוא לא מחזיק session |

**שים לב.** האיפוס לא בודק `status`, חשבון `pending` נשאר `pending`. טוקני איפוס אחרים לא מבוטלים ואין מייל התראה על שינוי, כך שמי שגנב session ומכיר את הסיסמה מחליף אותה בשקט.

#### `apps/api/src/modules/acc/verification.service.ts`
הנפקה וצריכה של טוקני מייל, אימות 24 שעות ואיפוס שעה, שורות 12 ו 13.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 28 עד 31 | `emailLink` בונה `<base>/#/<route>?token=` מ `APP_BASE_URL` | הטוקן ב fragment, לא מגיע ללוגים ול `Referer`. שינוי מבנה דורש שינוי ב SPA ב `verify-email` ו `reset-password` |
| 45 עד 59 | `issueEmailVerification`, INSERT של hash ואז `email.send` סינכרוני | בלי outbox. כשל משאיר טוקן יתום ומעלה חריגה |
| 62 עד 89 | `verifyEmail`, בדיקה מחוץ לטרנזקציה, ואז `consumed_at` ו `status: 'active'` | אותו חוסר אטומיות כמו `reset`. אין `WHERE status = 'pending'`, ולכן מחזיר ל `active` חשבון שאדמין סגר לפני האימות |
| 92 עד 100 | `resend`, רק ל `pending` | טוקנים קודמים נשארים תקפים, כל resend מוסיף טוקן. טוקנים שפגו לא נמחקים, כמו sessions |
| 103 עד 123 | `issuePasswordReset`, שקט כשאין חשבון, INSERT ושליחה כשיש | נשלח לכל סטטוס, כולל `closed` |

**שים לב.** השליחה הסינכרונית היא timing oracle, ותקלת SMTP מחזירה 500 רק לכתובות קיימות. שליחה דרך `OutboxService` תסגור את שניהם במחיר עיכוב, ותשבור בדיקות שמחכות למייל מיד.

#### `apps/api/src/modules/acc/profile.controller.ts`
`/me/profile` ו `/me/addresses`. אין מסלול שמקבל מזהה משתמש מבחוץ, וזו הגנת ה IDOR העיקרית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 40 | `CreateAddressDto` ו `UpdateAddressDto` מקומיים, `country` דרך `IsShippableCountry` מ `shp` | אין `MaxLength` ולא `MinLength`, מחרוזת ריקה או ענקית עוברת ומגיעה ל carrier |
| 56 עד 60 | `GET profile`, היחיד עם `@AllowSuspended` | ה probe שה SPA מריץ בעלייה |
| 62 עד 65 | `PATCH profile`, רק שני חלקי השם | `forbidNonWhitelisted` דוחה `username` ב 400. לא `@AllowSuspended` |
| 67 עד 75 | `GET addresses` ו `POST addresses` בשם `user.id` | |
| 77 עד 85 | `PATCH addresses/:id` ו `DELETE addresses/:id` עם `user.id` מה session ו `id` מה path | `id` בלי `ParseUUIDPipe`, מזהה לא תקין הופך ל 400 דרך `22P02` במסנן הגלובלי. `acc-addresses.test.ts` ו `sec-authorization.test.ts` שורה 339 מכסים גישה זרה |

**שים לב.** מסלול אדמין על כתובות של אחרים צריך controller נפרד עם `@Roles('admin')`.

#### `apps/api/src/modules/acc/profile.service.ts`
קריאה ועדכון פרופיל וכתובות שמורות. כל שאילתה מסוננת לפי userId של הקורא.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 45 | `ProfileView`, `AddressInput`, `AddressPatch` | בלי `passwordHash` ושדות פנימיים. ההערות על PII interceptor שגויות |
| 57 עד 75 | `get`, `select()` מלא ומיפוי ידני | המיפוי הוא ה allowlist. שדה שיתווסף כאן נחשף גם למושעה |
| 86 עד 97 | `update` מנרמל, מאמת, מאפס `nameReviewRequired` ומחזיר `get` | |
| 103 עד 109 | `listAddresses`, החדשות קודם | בלי עימוד ובלי מגבלת כמות |
| 111 עד 135 | `addAddress` בטרנזקציה, מבטל ברירת מחדל קודמת אם צריך, שומר `country` מנורמל | |
| 141 עד 166 | `updateAddress` בטרנזקציה, SELECT לפי `id` ו `userId`, 404 לכתובת זרה, `set` רק משדות שנשלחו, 400 אם ריק | ה UPDATE לפי `id` בלבד, בטוח רק בזכות ה SELECT |
| 169 עד 178 | `deleteAddress`, בדיקת בעלות ו DELETE | משלוחים קיימים לא נפגעים, `parcel-profile.service.ts` מעתיק את השדות |

**שים לב.** הסרת `eq(shippingAddress.userId, userId)` מאחד ה SELECTs פותחת IDOR מלא, והבדיקה ב `sec-authorization.test.ts` תופסת רק מחיקה. ברירת מחדל יחידה נאכפת בקוד בלבד, בלי אינדקס חלקי, ושתי בקשות מקבילות יכולות להשאיר שתיים.

### med, העלאת תמונות

העלאה בשני שלבים. קודם הבייטים נשלחים ל `POST /media/uploads` ומקבלים מפתח, ואחר כך מסלול צוות ב `inv` מצמיד את המפתח לחבילה או לפריט. אין קשר בין מי שהעלה למי שהצמיד. ב `STORAGE_PROVIDER=s3` גוף ההעלאה חתום ב SigV4 ב `packages/adapters/src/s3.ts`, וקריאה היא רק דרך presigned URL של חמש דקות. ה bucket ב origin אחר מה SPA, כך שגם קובץ שאינו תמונה לא נוגע ב cookie של Bault.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/med/med.module.ts` | דפוס P1, `@Global` עם `MediaService` ו controller אחד. רק `inv/parcel.service.ts` מזריק אותו, `vlt` ו `mkt` חותמים ישירות דרך ה adapter. מלכודת שמות, יש `MediaService` אחר לגמרי ב `dis/media.service.ts`, ו import אוטומטי של IDE יביא את הלא נכון. |

#### `apps/api/src/modules/med/med.controller.ts`
מסלול אחד, `POST /media/uploads`, תמונה כ base64 בתוך JSON. דפוס P2 בלי `@Roles` ובלי `@Throttle`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 | `MAX_BASE64_LENGTH` מ 10 MiB מפוענחים כפול ארבע חלקי שלוש ועוד 128 ל prefix | מתחת לגבול ה body של 16 MB, כך שגדול מדי נדחה עם הודעה ברורה |
| 15 עד 19 | `UploadDto`, `contentType`, `dataBase64`, ו `purpose` שהוא `item_intake` או `parcel` | `contentType` בלי אורך מקסימלי |
| 35 עד 43 | מעביר ל service עם `uploaderId` | E9. כל משתמש מחובר ופעיל, גם לקוח, מעלה עד 30 קבצים לדקה ל IP. `uploaderId` לא נשמר. `@Roles('warehouse_operator', 'admin')` סוגר את המשטח בלי לשבור מסלול לקוח |

#### `apps/api/src/modules/med/media.service.ts`
מאמת ומעלה תמונה ל object storage עם מפתח שהשרת בוחר, ומפיק קישורי קריאה חתומים. ה adapter לפי `STORAGE_PROVIDER`, דפוס P11.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 32 עד 55 | `ALLOWED_TYPES` של JPEG, PNG, WebP, HEIC, HEIF עם סיומות, `MAX_IMAGE_BYTES` 10 MiB, `PURPOSE_PREFIX` | בלי SVG, נכון. HEIC מוצג רק ב Safari, צוות על Chrome לא יראה אותו |
| 68 עד 80 | בדיקת `contentType` המוצהר מול ה allowlist | אין בדיקת magic bytes, כל רצף בייטים שהוצהר `image/png` נשמר, E9 |
| 84 עד 86 | זורק prefix של data URL עד הפסיק | ה MIME שבתוך ה data URL לא נבדק |
| 88 עד 99 | `Buffer.from(payload, 'base64')`, ואז דחייה של ריק ושל מעל 10 MiB | `Buffer.from` לא זורק על קלט פגום, ה `try` קוד מת וזבל הופך לבייטים. בדיקת magic bytes נכנסת בין 93 ל 94, ול HEIC בודקים `ftyp` בבייט 4 |
| 101 עד 110 | מפתח `<prefix>/<YYYY>/<MM>/<uuid>.<ext>` ו `putObject` | אין קלט לקוח במפתח, אין path traversal. E10, `putObject` לא עטוף, bucket לא זמין הופך ל 500 כללי |
| 114 עד 132 | `signed` מחזיר presigned GET לחמש דקות או null. `signAll` חותם בלולאה ומשמיט כשלונות | חתימה היא HMAC מקומי, הלולאה הסדרתית זולה |

**שים לב.** base64 ב JSON עולה שליש בנפח, ובקשה מלאה מחזיקה כ 14 MB מחרוזת ועוד 10 MB buffer בזיכרון. אין `deleteObject` ב adapter, ותמונה שלא הוצמדה נשארת לנצח. שמירת `uploaderId` כ metadata או בתוך המפתח תאפשר למסלולי ההצמדה לבדוק מי העלה, אבל דורשת לשנות גם אותם. המסלולים המצמידים ב `inv/parcel.service.ts` וב `inv/intake.service.ts` מקבלים כל מחרוזת כמפתח, בלי לבדוק prefix או מעלה, כך שאיש צוות יכול להצמיד כל אובייקט ב bucket ולקבל עליו קישור חתום.

### sup, helpdesk

ערוץ הפנייה היחיד, וגם המפתח מבפנים של חשבון מושעה. לקוח רואה רק את הכרטיסים שלו, `warehouse_operator` ו `admin` רואים הכל, כולל שרשורים מלאים של `billing`. `closed` לא מגיע לכאן בכלל.

```mermaid
stateDiagram-v2
  [*] --> open: open
  open --> awaiting_customer: תגובת צוות
  awaiting_customer --> open: תגובת לקוח
  open --> resolved: resolve
  awaiting_customer --> resolved: resolve
  resolved --> open: תגובת לקוח
  resolved --> awaiting_customer: תגובת צוות
```

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/sup/sup.module.ts` | דפוס P1, controller ו service בלי exports, כך שאף מודול אחר לא פותח כרטיס בשם משתמש. הטבלאות הן `support_ticket` עם `code`, `category`, `status`, `related_type`, `related_id`, `assigned_to`, `last_message_at`, `resolved_by`, ו `support_message` עם `author_id`, `author_role` ו `body`. `OutboxService` מגיע מ `NotModule` הגלובלי. אם `NotModule` יפסיק להיות גלובלי, צריך לייבא אותו כאן. |

#### `apps/api/src/modules/sup/sup.controller.ts`
מסלולי `/support`. דפוס P2 עם תפקידים per method ולא על ה class.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 22 | `CATEGORIES`, `OpenTicketDto` עם נושא עד 200, גוף עד 5000, `relatedType` ו `relatedId`, ו `ReplyDto` | `private_sale` חסר בטיפוס `TicketCategory` ב service, פער טיפוסים בלבד |
| 45 עד 49 | `GET tickets`, `listMine` של `user.id` | `@AllowSuspended` על כל חמשת מסלולי הלקוח, ערוץ ההחלמה של מושעה על חוב. הסרתו תנעל אותו ואין בדיקה שתתפוס |
| 51 עד 55 | `POST tickets`, פתיחה בשם `user.id` | בלי מגבלה per user על כרטיסים פתוחים, רק הרייט לימיט. מושעה או בוט יכולים להציף את התור |
| 58 עד 62 | `GET awaiting`, מונה כרטיסים שממתינים למשתמש | מתואר כתג בסרגל, ה SPA לא קורא לו היום |
| 68 עד 72 | `GET tickets/:id`, שרשור עם `{ id, role }` | הבעלות נבדקת ב `loadFor` |
| 75 עד 79 | `POST tickets/:id/messages`, תגובה | הסטטוס מתהפך לפי מי שכתב |
| 83 עד 93 | `GET queue` ו `GET queue/count`, `@Roles('warehouse_operator', 'admin')` | `@Roles` על ה class יחסום לקוחות |
| 95 עד 105 | `POST tickets/:id/assign` ו `POST tickets/:id/resolve`, `@Roles` ובדיקת תפקיד שוב ב service | איש צוות מושעה חסום כאן. מסלולי הלקוח פתוחים גם לצוות, ואיש צוות שקורא ל `GET tickets` רואה רק כרטיסים שפתח בעצמו |

#### `apps/api/src/modules/sup/support.service.ts`
כרטיסי תמיכה. שלושה מצבים, `open` אצל הצוות, `awaiting_customer` אצל הלקוח, `resolved`. תגובת לקוח על כרטיס סגור פותחת אותו מחדש. `support_message` append only ב trigger.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 30 | `TicketCategory`, `TicketStatus`, `TicketActor`, `MAX_SUBJECT`, `MAX_BODY` | הגבולות משכפלים את ה DTO |
| 52 עד 54 | `staff`, `warehouse_operator` או `admin` | ההגדרה היחידה של צוות. תפקיד חדש צריך להיכנס כאן |
| 63 עד 68 | `loadFor`, 404 גם לכרטיס של אחר | בדיקת הבעלות של כל המודול. ההערה על מזהים ניתנים לניחוש שגויה, זה uuid |
| 71 עד 105 | `open`, ולידציה ואז טרנזקציה של כרטיס עם `code` מ `prefixedId` והודעה ראשונה עם `authorRole: 'customer'` | `relatedId` נשמר בלי בדיקת קיום או בעלות. התנגשות `code` על `support_ticket_code_unique` מחזירה 500. איש צוות שפותח כרטיס נרשם כלקוח, וכשהוא עונה עליו הכרטיס עובר ל `awaiting_customer` ומחכה לו עצמו |
| 108 עד 124 | `listMine`, עמודות מפורשות לפי `userId` | בלי עימוד |
| 133 עד 154 | `listQueue`, כל מה שלא `resolved`, הוותיק קודם, עם `customerUsername` ו `customerStatus` | username ולא email. כל מפעיל מחסן רואה גם כרטיסי `billing` |
| 157 עד 172 | `thread`, `loadFor` ואז כל ההודעות עם username הכותב | הכרטיס חוזר מלא, כולל uuid של איש הצוות |
| 182 עד 228 | `reply`, `loadFor` מחוץ לטרנזקציה, ובפנים הודעה, סטטוס הבא, איפוס `resolvedAt`, הקצאה לאיש הצוות הראשון שעונה, ו `outbox.emit` של `support_ticket_replied` רק לתגובת צוות | transactional outbox נכון. `assignedTo` מחושב מקריאה שלפני הטרנזקציה |
| 231 עד 252 | `resolve`, בדיקת תפקיד, 409 אם סגור, ובטרנזקציה UPDATE ו outbox | הבדיקה מחוץ לטרנזקציה וה UPDATE לא מותנה, שתי סגירות מקבילות שולחות שתי התראות |
| 255 עד 263 | `assign` מעדכן `assignedTo` לקורא | לוקח גם כרטיס שכבר מוקצה או סגור, בניגוד להערה |
| 266 עד 281 | `openCount` ו `awaitingMe`, `count(*)::int` | |

**שים לב.** `loadFor` בתוך הטרנזקציה עם `FOR UPDATE` ב `reply` וב `resolve` סוגר את שני ה races. אין סגירה בידי הלקוח ואין סגירה אוטומטית. החלפת ה 404 ב `loadFor` ל 403 לא תיתפס, כי הבדיקות ב `sec-authorization.test.ts` שורות 256 עד 283 מקבלות את שניהם. התראה נשלחת רק ללקוח, אף פעם לא לצוות, והתור נקרא רק בסקירה.

### מסלול הכסף

אין טבלת יתרות. `ledger_record` מחזיקה תנועה בכל שורה, סכום חיובי, `debit` או `credit`, סוג ומטבע. היתרה היא תמיד שאילתה. trigger ב `0001_append_only.sql` מסרב לכל UPDATE ו DELETE, ולכן תיקון הוא שורה מפצה. `charge`, `external_payment`, `wallet_request` ו `escrow_deal` רק מסבירות שורה דרך `reference_type` ו `reference_id`, טקסט חופשי בלי foreign key.

כסף אמיתי נכנס היום רק דרך בקשת cash_in שאדמין משלים ידנית. checkout עם PayPal לא עובד, E3, וה webhook מאומת ונגמר בקיר. `FOR UPDATE` קיים רק על השורה העסקית, וזה לא מונע משתי פעולות על אובייקטים שונים לרוקן את אותו ארנק.

| סוג שורה | כיוון | כותבים עיקריים |
|---|---|---|
| `credit_topup` | credit | `checkout.service.ts`, השלמת cash_in |
| `withdrawal` | debit | השלמת cash_out |
| `fee` | debit | `marketplace_fee` ב billing, עמלות משיכה, chargeback ו escrow, שירותים ב `dis` |
| `service_charge` | debit | billing לכל השאר, `adm`, `mem`, `shp`, workers של אחסון ומנוי |
| `purchase`, `sale_credit` | debit, credit | `mkt`, `dis` |
| `interest` | debit | worker `interest-accrual.ts` |
| `escrow_hold`, `escrow_release`, `escrow_refund` | debit, credit, credit | `escrow.service.ts` |
| `chargeback` | debit | `chargeback.service.ts` |

#### בקשת ארנק, מי מזיז מה

```mermaid
stateDiagram-v2
  [*] --> submitted: המשתמש מגיש
  submitted --> pending_review: admin
  submitted --> approved: admin
  submitted --> rejected: admin
  submitted --> cancelled: המבקש
  pending_review --> approved: admin
  pending_review --> rejected: admin
  pending_review --> cancelled: המבקש
  approved --> processing: admin
  approved --> completed: admin, כאן נכתב הלדג'ר
  approved --> rejected: admin
  processing --> completed: admin
  processing --> rejected: admin
```

המבקש רק מבטל, ורק לפני אישור. כל השאר admin שאינו המבקש. רק `complete` מזיז כסף.

#### checkout מקצה לקצה, ומה נשבר

1. ה SPA ב `apps/web/src/areas/customer/finance/MoneyPanels.tsx` שולח `POST /finance/checkout` עם סכום, מסלול ו `idempotencyKey` חדש בכל לחיצה, בלי `paymentMethodToken`.
2. `checkout.service.ts` בודק מסלול מיידי וגבולות, ומחפש replay לפי `providerRef`.
3. `payment.createTopup` מחוץ לטרנזקציה. ב PayPal זה capture של הזמנה קיימת, ובלי מזהה הזמנה האדפטר זורק `Error` רגיל, 500. ב sandbox, שחסום ב production ב `adapters.module.ts`, הצלחה מיידית.
4. בדיקות סכום ומטבע, ואז טרנזקציה של `external_payment`, `credit_topup` ו outbox.

| תקלה | תוצאה |
|---|---|
| רשת נופלת אחרי capture ולפני הטרנזקציה | כסף אצל PayPal, אין שורה. ניסיון חוזר מה SPA עם מפתח חדש מבקש capture שני ונכשל. אין מנגנון פיוס |
| שתי בקשות מקבילות עם אותו מפתח | שתיהן עוברות את ה SELECT, אחת נופלת על האינדקס הייחודי ב 500, הלדג'ר מזוכה פעם אחת |
| PayPal מחזיר סטטוס שאינו `COMPLETED` | שורה `pending`, בלי זיכוי, ואיש לא משלים אותה. replay מחזיר `pending` לנצח |
| כישלון בתוך הטרנזקציה | הכל מתגלגל, כולל שורת התשלום, והכסף אצל PayPal בלי עקבה |

#### webhook

`POST /webhooks/payment` הוא `@Public`, אבל ה throttler חל. `pay.controller.ts` מסדר מחדש את הגוף המפורסר ומעביר ל `TopupService.handleWebhook`. שם `verifyWebhook` מאמת מול PayPal עם `PAYPAL_WEBHOOK_ID`, או מפרסר בלבד ב sandbox. אחר כך חיפוש לפי `webhookEventId` ויציאה בכל מקרה. שום דבר לא נכתב. השורה התחתונה, ב PayPal זיכוי בכרטיס לא עובד בכלל, וב sandbox הוא קורה רק בתשובה הסינכרונית.

#### איפה בודקים יתרה ואז מחייבים

כל אחד מאלה הוא בדיקה בלי נעילה על הארנק, ושניים מהם במקביל יכולים לרוקן אותו מתחת לאפס.

| מקום | שורה | הערה |
|---|---|---|
| `pay/wallet-request.service.ts` | 392 | בתוך הטרנזקציה, בלי נעילה על הארנק |
| `esc/escrow.service.ts` | 335 | מחוץ לטרנזקציה |
| `mkt/purchase.service.ts` | 121 | בתוך הטרנזקציה |
| `mkt/house-store.service.ts` | 187 | בתוך הטרנזקציה |
| `mkt/offer.service.ts` | 173 | מחוץ לטרנזקציה |
| `dis/custom-request.service.ts` | 203 | בתוך הטרנזקציה |
| `shp/human-fulfilment.service.ts` | 212, 348 | |
| `pay/withdrawal.service.ts` | 55, 70 | קוד לא מנותב |

`assertNotBlocked` נקרא בעוד שבעה מקומות ב `dis`, `mem` ו `shp`, ומתנהג אותו דבר. נעילה מייעצת לפי משתמש עוזרת רק אם כל המקומות בטבלה לוקחים אותה.

#### חוב, ריבית והשעיה

המדיניות מפוזרת בין ה API ל worker, וכדאי לראות אותה כשרשרת אחת.

1. `billing.service.ts`, `chargeback.service.ts` ועמלות escrow מחייבים בלי בדיקת יתרה, כך שהארנק יכול לרדת מתחת לאפס.
2. `assertNotBlocked` חוסם פעולות חדשות ב `dis`, `mem` ו `shp` כל עוד היתרה שלילית.
3. ה worker `interest-accrual.ts` מוסיף שורת `interest` debit לחשבון שלילי אחרי תקופת חסד, לפי `WALLET_DEBT_INTEREST_BPS`.
4. ה worker `wallet-suspension.ts`, פעם ביום, משעה חשבון `active` שהיתרה שלו מתחת ל `WALLET_SUSPEND_BELOW_MINOR`, ברירת מחדל מינוס 20 דולר, ומסמן `auto_suspended_at`. הוא גם מחזיר ל `active` חשבון שהושעה אוטומטית וחזר מעל הסף. אין audit לאף אחד מהם.
5. מושעה מגיע רק לתמיכה ול `GET /me/profile`. הוא לא יכול להגיש בקשת cash_in, כי הנתיב לא `@AllowSuspended`, ואדמין לא יכול להגיש בשמו.

המשמעות המעשית. ההחלמה עוברת דרך כרטיס תמיכה ואדמין שמחזיר ידנית ל `active` ב `PATCH /admin/users/:id`, ואז המשתמש מגיש cash_in ואדמין משלים. אם ה sweep היומי רץ לפני שהיתרה עלתה מעל הסף, החשבון מושעה שוב. מי שמוסיף `@AllowSuspended` ל `POST /finance/wallet-requests` פותר את זה, וזה המסלול הכספי היחיד שבו זה סביר, כי הגשה לא מזיזה כסף.

#### דוגמאות במספרים

כל הסכומים בסנטים במסד. כאן בדולרים לקריאה.

| תרחיש | שורות שנכתבות | הערה |
|---|---|---|
| checkout של 100 ב sandbox | `external_payment` `succeeded` של 100, credit `credit_topup` 100, outbox `topup_settled` | ב PayPal זה נגמר ב 500 לפני כל שורה |
| cash_in של 500 שאדמין השלים | `wallet_request` עד `completed`, credit `credit_topup` 500 עם `settledLedgerId`, אירועים בכל מעבר | אין `external_payment`, ולכן אין chargeback אפשרי עליו |
| cash_out של 50 | עמלה 3, שישה אחוזים מתחת לפס. לספק נשלח 47. debit `withdrawal` 50, `charge` של 3 ו debit `fee` 3 | הארנק ירד ב 53 והלקוח קיבל 47. ה SPA הבטיח 47 מתוך 50, זו העמלה הכפולה |
| cash_out של 200 | מעל הפס, 5 ועוד אחוז, כלומר 7. לספק 193, מהארנק 207 | |
| cash_out של 1000 | עמלה 5 ועוד 10, כלומר 15. לספק 985, מהארנק 1015 | אותו באג, מעל הפס |
| קליטת פריט עם כלל `fixed` של 3 | `charge` `settled` של 3 עם snapshot, debit `service_charge` 3 | מנוי שמכסה את הפעולה, שום שורה |
| chargeback על checkout של 100 | debit `chargeback` 100, `charge` ו debit `fee` 25, `external_payment` ל `reversed` | הארנק יכול לרדת מתחת לאפס |
| escrow של 1000, קונה ומוכר עם חשבון | בהעלאה `feeMinor` 25 מוקפא. במימון debit `escrow_hold` 1000 לקונה. בסגירה credit `escrow_release` 1000 למוכר, `charge` ו debit `fee` 25 למעלה, והפריט עובר לקונה | בהחזרה במקום סגירה, credit `escrow_refund` 1000 לקונה ובלי עמלה |
| escrow של 3000 | עמלה 30, אחוז אחד מעל הרצפה | מתחת ל 2500 העמלה תמיד 25 |

#### מי משנה איזה סטטוס

| טבלה ועמודה | ערכים | מי כותב |
|---|---|---|
| `external_payment.status`, טקסט חופשי | `pending`, `succeeded`, `failed`, `reversed` | `checkout.service.ts` כותב לפי תשובת הספק, `wallet-request.service.ts` כותב payout, `chargeback.service.ts` מעדכן ל `reversed`. שום קוד לא מעדכן `pending` |
| `external_payment.purpose` | `topup`, `payout` | checkout ו payout בהתאמה. רק `topup` ניתן ל chargeback |
| `charge.status` | `settled` בפועל תמיד | billing, עמלת משיכה, עמלת chargeback, עמלת escrow |
| `wallet_request.status`, enum | שבעת המצבים | רק `applyTransition` ו `complete` |
| `escrow_deal.status`, enum | שמונת המצבים | כל פעולה ב `escrow.service.ts`, בלי תנאי ב WHERE |
| חותמות ב `escrow_deal` | `funded_at`, `item_received_at`, `inspected_at`, `buyer_released_at`, `seller_released_at`, `settled_at`, `returned_at`, `cancelled_at` | הפעולה המתאימה. `funding_attested_by` ועמודות `*_release_attested_by` רק כש staff פועל בשם צד חיצוני |

#### הטבלאות של הכסף

| טבלה | מה היא מחזיקה | הערה |
|---|---|---|
| `ledger_record` | `user_id`, `type`, `amount`, `direction`, `currency`, `reference_type`, `reference_id`, `occurred_at` | append only. ההפניה טקסט חופשי, `charge`, `external_payment`, `wallet_request`, `escrow_deal` או `interest` |
| `charge` | `action_type`, `pricing_rule_snapshot`, `amount`, `payment_means`, `status`, `reference_id` | מבנה ה snapshot שונה לפי הכותב. עמלות שאינן מ billing נרשמות עם `action_type` `service` |
| `external_payment` | `provider`, `provider_ref` ייחודי, `purpose`, `status`, `amount`, `webhook_event_id` | ב checkout `provider` הוא שם המסלול, ב payout הוא `payout`. `webhook_event_id` לא נכתב |
| `wallet_request` | `code`, `type`, `status`, `amount`, `funding_source`, `destination_account`, `beneficiary_name`, `reference`, `document_key`, `notes`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `settled_ledger_id`, `completed_at` | `CHECK (amount > 0)`, `settled_ledger_id` ייחודי |
| `wallet_request_event` | `request_id`, `actor_id`, `actor_role`, `from_status`, `to_status`, `reason`, `metadata` | append only, היסטוריה מלאה לכל בקשה |
| `withdrawal` | `destination_account`, `status`, `confirmed_at` | נכתבת רק מהקוד הישן שאינו מנותב |
| `escrow_deal` | צדדים, `value_minor` ו `fee_minor` כ `integer`, `settlement`, `funding_source`, `item_id`, תוצאת בדיקה וחותמות זמן | יחידה בכסף שאינה `bigint` |
| `pricing_rule` | `action_type`, `item_class`, `model`, `value`, `billing_trigger`, `parameters`, `effective_from`, `effective_to`, `updated_by` | נזרעת רק ב `apps/api/src/db/seed.ts`, אף migration לא מכניס כללים |

#### תחקור תקלה בכסף

היתרה של משתמש, כפי ש `balanceOf` מחשב.

```sql
SELECT sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
FROM ledger_record WHERE user_id = $1;
```

escrow שמומן פעמיים, הסימן של E18.

```sql
SELECT reference_id, count(*) FROM ledger_record
WHERE type = 'escrow_hold' GROUP BY reference_id HAVING count(*) > 1;
```

escrow שגם שוחרר וגם הוחזר, הסימן של מרוץ ה P0.

```sql
SELECT reference_id FROM ledger_record
WHERE type IN ('escrow_release', 'escrow_refund')
GROUP BY reference_id HAVING count(DISTINCT type) = 2;
```

משיכות שהושלמו עם payout שעדיין ממתין, וכסף שאולי לא הגיע.

```sql
SELECT * FROM external_payment WHERE purpose = 'payout' AND status = 'pending';
```

תשלומי checkout שנשארו `pending` בלי זיכוי.

```sql
SELECT * FROM external_payment WHERE purpose = 'topup' AND status = 'pending';
```

שורות לא חיוביות, מה שה worker `ledger-invariant-check.ts` מחפש.

```sql
SELECT * FROM ledger_record WHERE amount <= 0;
```

תיקון הוא תמיד שורה מפצה עם `reference_type` ו `reference_id` שמסבירים אותה, כי ה trigger מסרב לכל UPDATE ו DELETE גם לבעל הטבלה.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/pay/pay.module.ts` | דפוס P1, `@Global`, שני controllers ושמונה services. שורה 31 קושרת `BILLING_PORT` ל `BillingService` עם `useExisting`, ו `inv`, `dis` ו `mkt` מזריקים את הסמל כדי לשבור תלות מעגלית. `BillingModule` עם `NoopBillingAdapter` ב `shared/billing` לא מיובא. אם ייובא, כל חיוב עלול להפוך להדפסה ללוג בשקט. |

#### `apps/api/src/modules/pay/money-terms.ts`
נתונים ופרדיקטים טהורים בלי imports. הצרכנים `wallet.service.ts`, `wallet-request.service.ts`, `checkout.service.ts`, `chargeback.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 37 עד 48 | פס של 100 דולר. מתחתיו 6 אחוזים עם רצפה 99 סנט, מעליו 5 דולר ועוד אחוז | `CASHOUT_FEE_ACTION` לא נקרא |
| 57 עד 68 | `cashOutFeeMinor` מעגל למעלה עם `Math.ceil`, אפס לסכום לא חיובי. החלוקה ב 10000 בנקודה צפה, הקלט והפלט שלמים. `cashOutNetMinor` הוא הסכום פחות העמלה, לא פחות מאפס | ה SPA מציג את הנטו כמה שיגיע לחשבון. `wallet-request.service.ts` לא מכבד את זה, ראה שם. המספרים מקובעים ב `pay-money-in-out.test.ts` |
| 83 עד 84 | `CHARGEBACK_FEE_MINOR` 25 דולר | `CHARGEBACK_FEE_ACTION` לא נקרא |
| 104 עד 155 | `FundingRoute` ו `FUNDING_ROUTES`, `card` ו `paypal_gs` מיידיים, `paypal_ff` ו `bank_transfer` ידניים, עם תיאורים שה SPA מציג. `ROUTE_BY_KEY` נבנה פעם אחת, `fundingRoute` ו `isInstantRoute` | `feeBps` אפס ולא נקרא. מפתח לא מוכר נחשב לא מיידי. מסלול חדש עם `instant: true` נפתח ל checkout מיד |

**שים לב.** סכומים הם שלמים ביחידות מינימליות, `bigint` במצב number ב `db/schema/_helpers.ts`, בטוח עד 2 בחזקת 53. העמלות כאן קבועים בקוד, בעוד שה seed מכניס כללי `cash_out_fee` ו `chargeback_fee` ל `pricing_rule` והמחירון הציבורי מציג אותם. אדמין שמשנה אותם משנה את מה שהלקוח קורא, לא את מה שהוא משלם.

#### `apps/api/src/modules/pay/ledger.service.ts`
הלב של הכסף. כמעט כל מודול שמזיז כסף קורא לו. ה workers כותבים לאותה טבלה ב SQL ישיר, דפוס P7, ו `wallet-request.service.ts` כותב ב `tx.insert` כדי לקבל מזהה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 30 | `DEFAULT_CURRENCY` USD ו `LedgerEntry`, אחד עשר סוגים שמשכפלים את ה enum `ledger_type` | `amount` חיובי רק בהערה |
| 44 עד 55 | `record`, INSERT אחד. עם `tx` בטרנזקציה של הקורא, בלעדיו autocommit | אין ולידציה ובמסד אין `CHECK (amount > 0)`. סכום שלילי ב `debit` הוא זיכוי, ורק `ledger-invariant-check.ts` מגלה אחרי מעשה |
| 57 עד 67 | `balanceOf`, סכום credit פחות debit לכל ההיסטוריה, דרך text כי `sum` של bigint חוזר כמחרוזת | לא נועל דבר, גם בתוך `tx`. ב READ COMMITTED שתי טרנזקציות רואות אותה יתרה, המקור של E1 ו E18. לא מסנן לפי מטבע |
| 69 עד 75 | `list`, כל השורות מהחדשה לישנה, ל `GET /finance/ledger`. האינדקס `ledger_record_user_occurred_idx` ממיגרציה 0006 משרת גם את `balanceOf` | בלי עימוד. `tests3/integration/fin-invariants.test.ts` סוכם הכל ומשווה ליתרה, ועימוד ישבור אותו |

**שים לב.** התיקון הקטן ביותר ל double spend הוא עזר שקורא ל `pg_advisory_xact_lock(hashtext(user_id))` בתוך הטרנזקציה לפני כל בדיקת יתרה שאחריה חיוב, בכל השירותים יחד.

#### `apps/api/src/modules/pay/wallet.service.ts`
שכבה דקה מעל הלדג'ר. נצרך ב `pay.controller.ts` ובשירותים ב `dis`, `mem` ו `shp`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 26 עד 28, 58 עד 60 | `balance` ו `ledgerList` מעבירים ללדג'ר בלי `tx` | |
| 41 עד 56 | `cashOutQuote` מחזיר סכום, עמלה, נטו ואת פרמטרי הלוח | בלי הנחת מנוי, כך שהציטוט יכול להיות גבוה מהחיוב בפועל |
| 62 עד 71 | `assertNotBlocked` זורק 409 `NEGATIVE_BALANCE_BLOCKED` ביתרה שלילית | לא נועל גם כשמעבירים `tx`, בדיקה אינפורמטיבית. `mem/membership.service.ts` מעביר `tx`, `shp/shipment.service.ts` לא. ה SPA לא מטפל בקוד הזה במיוחד ומציג את ההודעה כמו שהיא. נעילה כאן לא תעזור אם היא לא מוחזקת עד כתיבת החיוב |

**שים לב.** המדיניות היא שיתרה שלילית מותרת וחוסמת רק פעולות חדשות. כל שירות חדש צריך לזכור לקרוא ל `assertNotBlocked`.

### prc, תמחור

כל מחיר של פעולה קבועה הוא שורה ב `pricing_rule`. אדמין רק מוסיף שורות דרך `POST /pricing/rules`, ואין עריכה, מחיקה או סגירה. הכללים ההתחלתיים נזרעים ב `apps/api/src/db/seed.ts`, כולל כללי `cash_out_fee`, `chargeback_fee` ו `escrow_fee` שמוצגים במחירון ולא נגבים. `PricingService` בוחר כלל לחיוב, `PriceListService` מציג את כל מה שבתוקף.

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/prc/prc.module.ts` | דפוס P1, `@Global`, מייצא רק את `PricingService`, כך ש `pay`, `esc`, `mkt`, `shp` ו `dis` מזריקים בלי import. הסרת `@Global` תתגלה רק בעליית האפליקציה. |

#### `apps/api/src/modules/prc/pricing.service.ts`
מנוע התמחור. מחזיר סכום ו snapshot של הכלל, כדי שהחיוב ישמור את מה שהיה בתוקף. הצרכן המרכזי `billing.service.ts`, ואחריו `esc` ושירותים ב `mkt`, `shp`, `dis`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 25 | `BillingTrigger`, `CreateRuleInput`, `PriceResult` עם `amount` ו `snapshot` | ה snapshot נשמר ב `charge.pricing_rule_snapshot`. שירותים אחרים כותבים לשם מבנים אחרים, כך ש `ruleId` לא תמיד קיים |
| 45 עד 66 | `createRule`, דורש תיאור, INSERT עם `effectiveFrom` עכשיו, USD קבוע, `updatedBy` | לא סוגר את הכלל הקודם, `effective_to` לא נכתב לעולם, והחדש מנצח רק בזכות המיון. מי שיסגור ידנית כלל חדש יחזיר לתוקף בשקט את הישן שעדיין פתוח. אין בדיקה ש `value` חיובי ואין תקרה על אחוזים, מיליון נקודות בסיס יתקבלו |
| 77 עד 87 | `tryPrice` עוטף את `price` ומחזיר null על כל שגיאה | בולע גם שגיאת מסד בתוך טרנזקציה, שאחריה הטרנזקציה כבר בוטלה והשגיאה הבאה מבלבלת |
| 89 עד 108 | `price`, שאילתה לפי `action_type`, `item_class` NULL או שווה, ותאריכי תחולה מול `now()`, מיון `item_class nulls last` ואז `effective_from desc` | כלל ספציפי מנצח כללי, ובתוך כל קבוצה החדש מנצח. `now()` הוא תחילת הטרנזקציה. שינוי סדר המיון משנה מחיר של כל פעולה |
| 110 עד 111 | אין כלל, 400 | fail closed. בלי seed אף migration לא מכניס `pricing_rule`, ולכן מסד חדש לא מתמחר דבר, E6 |
| 113 עד 116 | `fixed` מחזיר את הערך, `percentage` דרך `applyBasisPoints` עם `Math.round` | בלי `base` התוצאה אפס, וכלל אחוזים לפעולה קבועה הופך אותה לחינמית בשקט |
| 118 עד 129 | snapshot של מזהה, סוג, מחלקה, מודל, ערך, מטבע ותאריך | |

#### `apps/api/src/modules/prc/price-list.service.ts`
המחירון שהלקוח רואה. קורא את אותם כללים, משאיר את מה שבתוקף, ומקבץ לפי מה שאדם עושה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 31 עד 40 | `PRICE_GROUPS`, שבע קבוצות | שינוי שם קבוצה שובר את התרגום ב SPA |
| 48 עד 73 | `groupFor`, קודם קידומות כמו `grading_fee:` ו `parcel_`, אחר כך שמות מוכרים, ברירת מחדל `services` | `cash_out_fee`, `chargeback_fee` ו `escrow_fee` מוצגים אף שהקוד שגובה אותם לא קורא אותם |
| 86 עד 97 | שליפת כללים בתוקף, ממוינים לפי פעולה ואז תאריך יורד | `effective_from` מושווה לשעון Node, `effective_to` לשעון המסד |
| 107 עד 113 | שורה אחת לכל צירוף פעולה ומחלקה, החדשה | משכפל את כלל הבחירה של `price` בכוונה, לשאילתה אחת. שינוי כלל הבחירה צריך לגעת בשני המקומות |
| 115 עד 142 | קיבוץ, מיפוי לשדות ציבוריים בלי `id` ו `updatedBy`, סינון קבוצות ריקות, `note` ו `generatedAt` | |

#### `apps/api/src/modules/prc/prc.controller.ts`
שלושה נתיבים תחת `/pricing`. דפוס P2, ומזריק `DRIZZLE` ישירות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 15 עד 24 | `CreateRuleDto`, `actionType` חופשי, `model` fixed או percentage, `value` `@IsInt()`, `billingTrigger` מארבעה | אין `@Min(0)`. כלל `fixed` שלילי יגרום ל billing לכתוב debit שלילי, כלומר זיכוי בכל חיוב |
| 43 עד 47 | `GET list`, `@Public`, מחזיר את המחירון | |
| 49 עד 52 | `GET rules`, שאילתה ישירה בלי `@Roles` | כל מחובר מקבל את כל הכללים, כולל ישנים ו `updated_by`. ה SPA קורא לו רק מ `AdminConsole.tsx`, ו `PriceListPanel.tsx` עבר ל `/pricing/list`, כך ש `@Roles('admin')` לא ישבור מסך לקוח |
| 54 עד 66 | `POST rules`, `@Roles('admin')`, ל `createRule` | אין עריכה ואין מחיקה |

### pay, חיובים וכניסת כסף

שלושה ערוצים כותבים כסף מבחוץ. `billing.service.ts` לחיובי שירות דרך ה port, `checkout.service.ts` לזיכוי מיידי מספק, ו `wallet-request.service.ts` לכסף ידני בשני הכיוונים. `chargeback.service.ts` הופך זיכוי של checkout. `topup.service.ts` ו `withdrawal.service.ts` הם שרידים, ורק ה webhook וה 410 שלהם נגישים.

#### `apps/api/src/modules/pay/billing.service.ts`
המימוש של `BillingPort`. קליטה, שירות, עיבוד חבילה ועמלת מסחר מגיעים מ `inv`, `dis` ו `mkt` דרך `BILLING_PORT`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 31 | `charge(tx, action)`, `tx` חובה לפי החוזה ב `billing.port.ts` | החיוב בטרנזקציה של הקורא ומתגלגל איתה. אין חיוב יתום |
| 50 עד 52 | `memberships.consume` על `feeActionType` או `actionType`. מכוסה, חוזר בלי כתיבה | נקודת הבדיקה היחידה להטבות מנוי. עמלות שעוקפות את ה port קוראות ל `memberships.waive` בעצמן |
| 60 עד 63 | `tryPrice` על `feeActionType` אם נשלח, ונפילה ל `price` על הפעולה הכללית | הכללית זורקת אם אין כלל, fail closed |
| 64 | סכום אפס חוזר בלי כתיבה | כאן כלל אחוזים בלי בסיס נעלם בשקט |
| 66 עד 79 | INSERT ל `charge`, `settled`, עם snapshot, `paymentMeans: 'wallet'`, `referenceId` של הפריט | |
| 81 עד 92 | debit מסוג `fee` ל `marketplace_fee`, אחרת `service_charge`, עם הפניה ל `charge` | שינוי המיפוי משנה את דף התנועות ואת `adm/shelf-yield.service.ts` |

**שים לב.** אין בדיקת יתרה, בכוונה. חיוב יכול להוריד ארנק מתחת לאפס, וה worker של החוב והריבית מטפל. הוספת בדיקה כאן תשבור קליטה ללקוח עם ארנק ריק, כולל `fin-invariants` שקולט שלושה פריטים. קוראים שהפעולה בה יוזם הלקוח קוראים ל `assertNotBlocked` לפני כן. מי שמחפש את המימוש דרך go to definition על `BILLING_PORT` לא יגיע לכאן, הקשר הוא דרך הסמל ב `pay.module.ts`.

**איך פעולה מוצאת מחיר.** `BillableAction` ב `shared/billing/billing.port.ts` נושא `actionType` כללי מרשימה סגורה, `intake`, `storage`, `service`, `shipping`, `marketplace_fee`, `parcel_processing`, `parcel_forwarding`, ו `feeActionType` ספציפי אופציונלי. דוגמאות לספציפי הן `intake_lot` ב `inv/intake.service.ts`, `service_fee:deslab`, `service_fee:video_review` ו `service_fee:condition_inspection` ב `dis`, ודרג הדירוג ב `dis/grading.service.ts`. הקצאת מנוי נבדקת לפי הספציפי אם יש. המחיר נלקח מהספציפי אם יש לו כלל, אחרת מהכללי. `charge.action_type` שומר תמיד את הכללי, ולכן דוח לפי עמלה ספציפית חייב לקרוא את `actionType` מתוך ה snapshot.

#### `apps/api/src/modules/pay/checkout.service.ts`
זיכוי ארנק בלי אדם, במסלול שספק מאשר, ופרסום מסלולי המימון. הצרכן היחיד `pay.controller.ts`. דפוס P11 דרך `PAYMENT_ADAPTER`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 55 עד 89 | `routes`. קורא `BANK_*` ו `PAYPAL_FF_HANDLE` מהסביבה בכל בקשה, `clean` הופך ריק ל null. מיידי תמיד זמין, בנק זמין אם שדה אחד מוגדר ואז כל ששת השדות נחשפים, PayPal חברים לפי handle. מחזיר גם את גבולות ה cash_in | `referenceNote` מבקש username בהפניה, הקישור היחיד בין העברה לחשבון, ואדמין עושה אותו בעיניים |
| 102 עד 117 | דוחה מסלול לא מוכר או ידני, אוכף `WALLET_REQUEST_LIMITS.cash_in`, דורש מפתח | |
| 119 עד 130 | `providerRef` הוא המסלול ועוד `idempotencyKey`. שורה קיימת של אותו משתמש מחזירה replay. האינדקס גלובלי וה SELECT לפי משתמש, כך ששני משתמשים עם אותו מפתח, השני מגיע לספק ונופל ב 500. שינוי פורמט `providerRef` שובר replay לתשלומים ישנים | ה SELECT רק קיצור. ההגנה האמיתית היא האינדקס הייחודי הגלובלי `external_payment_provider_ref_unique`. בקשה מקבילה שנייה מקבלת 500 אבל הלדג'ר מזוכה פעם אחת |
| 132 עד 138 | `payment.createTopup` מחוץ לטרנזקציה. ב PayPal זה capture של ההזמנה ש `paymentMethodToken` מזהה, עם `PayPal-Request-Id` שווה ל `providerRef`. ב sandbox הצלחה מיידית | E3. ה SPA לא שולח `paymentMethodToken` ואין יצירת הזמנה בשום מקום, ולכן ב PayPal כל checkout נגמר ב 500 מהאדפטר. השרת לא בודק שההזמנה שייכת למבקש |
| 140 עד 177 | מסרב ב 409 אם `failed`, אם הסכום שנתפס שונה, או אם המטבע אינו USD | `settledAmountMinor` שהוא undefined מתקבל ומזכה לפי מה שהלקוח שלח. בסירוב על סכום הכסף כבר נתפס אצל PayPal ואין שורה |
| 179 עד 216 | טרנזקציה של `external_payment`, ואם `succeeded` גם `credit_topup` ו outbox `topup_settled` | `provider` נשמר כשם המסלול. מזהה ה capture של PayPal לא נשמר, ולכן אין פיוס ואין קישור ל webhook או ל dispute. `pending` נשאר `pending` לנצח |
| 220 עד 226 | `listMine`, תשלומי topup של המשתמש בסדר עולה | |

**שים לב.** ה capture קורה לפני שיש שורה. כל כישלון אחריו משאיר כסף אצל PayPal בלי עקבה. ה SPA מייצר מפתח חדש בכל לחיצה, כך ש `PayPal-Request-Id` לא מגן על ניסיון חוזר. התיקון המקובל הוא לכתוב `external_payment` כ `pending` לפני הקריאה ולעדכן אחריה.

#### `apps/api/src/modules/pay/topup.service.ts`
שירות זיכוי ישן ומטפל ה webhook.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 25 עד 60 | `topup` קורא לספק בלי token, כותב `provider: 'sandbox'` קבוע עם `providerRef` של הספק, ו `credit_topup` אם הצליח | קוד מת, לא מנותב. בלי replay, בלי גבולות ובלי בדיקת סכום, ועם PayPal היה נכשל תמיד. ניתוב מחדש מסוכן |
| 63 עד 66 | `handleWebhook` קורא ל `payment.verifyWebhook` | ב PayPal אימות חתימה מול PayPal, ב sandbox `JSON.parse` בלבד. כל האבטחה של הנתיב הציבורי כאן |
| 67 עד 75 | dedupe לפי `webhookEventId`, ובשני המקרים חוזר בלי לכתוב | העמודה בלי אינדקס ואף קוד לא כותב אליה. ה docblock שאומר שהזיכוי קורה ב webhook שגוי |

**שים לב.** מי שיממש זיכוי כאן חייב אינדקס ייחודי על מזהה האירוע באותה טרנזקציה, קישור לפי מזהה capture שהיום לא נשמר, ולדעת שב sandbox אין אימות. `adapters.module.ts` שחוסם sandbox ב production הוא המחסום היחיד.

#### `apps/api/src/modules/pay/withdrawal.service.ts`
שירות המשיכה הישן עם אסימון אישור. רק `retiredConfirmEndpoint` נקרא.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 48 עד 52 | `retiredConfirmEndpoint` מחזיר `AppError.tokenExpired`, 410 | הבקר זורק אותו עבור `POST /finance/withdrawals/confirm` |
| 54 עד 60 | `request`, בדיקת יתרה בלי טרנזקציה והנפקת אסימון | לא מנותב |
| 62 עד 116 | `confirm`, צורך אסימון לפני הטרנזקציה, בודק יתרה בלי נעילה, כותב `withdrawal`, קורא ל `createPayout` בתוך הטרנזקציה, ואז debit ו `paid` בכל מקרה | באג אמיתי בקוד לא נגיש, ספק שסירב עדיין מחייב ומדווח שולם. ניתוב מחדש מחזיר משיכה בלי סקירה. מחיקת `request` ו `confirm` לא שוברת דבר |

#### `apps/api/src/modules/pay/wallet-request.rules.ts`
כללי בקשת ארנק בלי מסד, משוקפים ב SPA ב `apps/web/src/shared/walletRequests.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 47 | `WalletRequestType`, `WalletRequestStatus` ו `WALLET_REQUEST_TRANSITIONS`, רשימת שכנויות מ `submitted` דרך `pending_review`, `approved`, `processing` אל `completed`, `rejected`, `cancelled` | מקור האמת. כולל `submitted` ישר ל `approved` ו `approved` ישר ל `completed`, שחסרים בהערות. מעבר חדש מותר מיד דרך `applyTransition` |
| 50 עד 63 | `OPEN_WALLET_REQUEST_STATUSES`, ארבעת המצבים הלא סופיים, `isOpenStatus`, ו `canTransition` עם `?? []` נגד מצב לא מוכר | הרשימה הפתוחה משמשת גם את בדיקת הכפילות וגם את `openTotals` |
| 66 | `REQUESTER_TRANSITIONS`, רק `cancelled` | לא נקרא, השירות משכפל את הכלל |
| 76 עד 97 | גבולות cash_in 10 עד 20000 דולר, cash_out 20 עד 20000, USD בלבד, חמישה `FUNDING_SOURCES`, אורכי שדות | `card` ו `crypto` הם תוויות בלבד. `checkout.service.ts` לוקח מכאן את גבולות ה cash_in. שינוי גבולות חייב לקרות גם ב SPA |
| 125 עד 194 | `validateWalletRequestDraft` מחזיר רשימת הפרות. סכום, מטבע, מקור ל cash_in, יעד ומוטב ל cash_out, אורכים | היתרה לא נבדקת כאן בכוונה |
| 211 עד 221 | `isDuplicateOf`, סוג, סכום, מטבע והפניה שווים | לא נקרא, השירות משכפל ב SQL. ה 409 בבדיקת `fin-invariants` הוא הכלל הזה מול בקשה פתוחה מהרצה קודמת, E16 |

#### `apps/api/src/modules/pay/wallet-request.service.ts`
זרימת בקשות cash_in ו cash_out, והנתיב היחיד שבו כסף אמיתי נכנס לארנק היום. הגשה לא מזיזה כסף, רק `complete` כותב לדג'ר ומבצע payout. דפוס P3 עם `FOR UPDATE` על הבקשה, outbox ו audit ידני באותה טרנזקציה. הקוראים `wallet-request.controller.ts` ו `pay.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 28 עד 37 | `RequestActor` ו `WalletRequestFilters` | |
| 68 עד 76 | `isReviewer` הוא `admin` בלבד, `assertReviewer` זורק 403 | `warehouse_operator` לא יכול לסקור, ולהוסיף אותו ב `@Roles` לא יעזור בלי לשנות כאן |
| 90 עד 97 | `submit`, נרמול מטבע והרצת `validateWalletRequestDraft`. ההפרה הראשונה היא ההודעה וכל ההפרות ב details | |
| 102 עד 124 | בדיקת כפילות ב SQL מול בקשות פתוחות של אותו משתמש, סוג, סכום, מטבע והפניה, עם `isNull` להפניה ריקה, 409 עם `existingCode` | בלי נעילה ובלי אינדקס ייחודי, שתי הגשות מקבילות עוברות. עניין של נוחות, לא של כסף |
| 126 עד 135 | cash_out גדול מהיתרה נדחה ב 409 `INSUFFICIENT_BALANCE` | בלי עמלה ובלי בקשות פתוחות אחרות, בדיקת נוחות בלבד |
| 137 עד 186 | טרנזקציה של בקשה `submitted` עם קוד `WR-`, אירוע ראשון עם `fromStatus: null`, outbox `wallet_request_submitted` ו audit | שדות שלא שייכים לסוג מאופסים ל null. `documentKey` מחרוזת חופשית שלא נבדקת מול `med` |
| 194 עד 200 | `listMine`, רק של המשתמש | |
| 206 עד 235 | `listForReview`, דורש סוקר, מסננים אופציונליים, JOIN לשם, email ו username, החדשה קודם | `new Date` על מחרוזת לא תקינה מגיע למסד ומחזיר 500. בלי עימוד. ה JOIN של uuid מול text עובד בזכות cast ימפליציטי מ `0001_append_only.sql` |
| 246 עד 273 | `detail`, `loadFor`, פרטי הבעלים וכל ההיסטוריה | אותה פונקציה ללקוח ולאדמין |
| 281 עד 288 | `loadFor`, 404 גם לבקשה של אחר אם הקורא לא סוקר | |
| 295 עד 301 | `cancel`, רק המבקש עצמו, גם אדמין, עם `actorRole: 'user'` | הטבלה מתירה ביטול רק מ `submitted` ו `pending_review` |
| 304 עד 307 | `markUnderReview`, סוקר, ל `pending_review` | |
| 309 עד 312 | `approve`, סוקר, עם `stampReview` שכותב `reviewedBy` ו `reviewedAt` | אישור לא מזיז כסף. `fin-invariants` בודק שאין זיכוי לפני השלמה |
| 314 עד 325 | `reject`, סוקר, סיבה אחרי trim חובה, נשמרת ב `rejectionReason` | |
| 328 עד 331 | `markProcessing`, סוקר, ל `processing` | אין לו תוכן כספי, רק סימון |
| 345 עד 369 | `complete`, טרנזקציה, `FOR UPDATE` על הבקשה, הפרדת תפקידים, 409 אם `completed`, אם המעבר לא חוקי, או אם יש `settledLedgerId` | השלמה כפולה נחסמת פעמיים, בנעילה ובאינדקס `wallet_request_settled_ledger_unique` |
| 382 עד 389 | עמלת משיכה מחושבת עכשיו, ו `memberships.waive` על `cash_out_fee` | |
| 391 עד 404 | cash_out, `balanceOf` בתוך הטרנזקציה מול סכום ועוד עמלה | לא נועל את הארנק. שתי משיכות מקבילות של אותו משתמש, או משיכה ורכישה ב `mkt`, עוברות שתיהן, אותו שורש כמו E1 |
| 418 עד 449 | cash_out, `createPayout` בתוך הטרנזקציה עם `request.amount - feeMinor` ומפתח `wallet_request:<id>`. `failed` זורק 409, אחרת `external_payment` מסוג `payout` | שורה 422 שולחת נטו, בעוד שהלדג'ר מחייב סכום מלא ועוד שורת עמלה, כך שהעמלה נגבית פעמיים. `pending`, שהוא מה ש PayPal מחזיר כמעט תמיד, נחשב הצלחה ואיש לא מעדכן אותו. `destinationAccount` חופשי, ו PayPal מצפה למייל |
| 453 עד 465 | שורת לדג'ר ב `tx.insert` ישיר, `credit_topup` או `withdrawal` על הסכום המלא | ישיר כדי לקבל מזהה ל `settledLedgerId` |
| 475 עד 507 | עמלה כ `charge` עם `actionType: 'service'` ו snapshot בלי `ruleId`, ושורת `fee` נפרדת | לא מקוזזת בכוונה, כדי שהלקוח יראה שני מספרים |
| 509 עד 572 | עדכון ל `completed` עם `settledLedgerId`, אירוע עם כל המספרים, outbox `wallet_request_completed` ו audit | כשל ב audit מגלגל הכל, אבל ה payout כבר יצא. ניסיון חוזר מתכנס בזכות המפתח, אבל דחייה מ `approved` משאירה payout בלי חיוב |
| 583 עד 589 | `assertSeparationOfDuties`, המבצע אינו המבקש | הבדיקה היחידה. אותו אדמין מאשר ומשלים, וגם cash_in של חשבון שהוא שולט בו עובר עד 20000 דולר בלי ראיה חובה |
| 596 עד 678 | `applyTransition`, טרנזקציה, `FOR UPDATE`, הפרדת תפקידים חוץ מביטול, `canTransition`, עדכון, אירוע, outbox `wallet_request_${toStatus}` ו audit | שם אירוע דינמי, מצב חדש יוצר סוג אירוע שה worker של ההתראות צריך להכיר |
| 681 עד 702 | `appendEvent` ל `wallet_request_event`, append only | |
| 705 עד 720 | `openTotals`, סכום בקשות פתוחות לפי סוג ב JS | לתצוגה בלבד |

**שים לב.** תיקון העמלה הכפולה בכיוון הלדג'ר ישבור את `tests/integration/pay-money-in-out.test.ts` שורה 152 ושורות 163 עד 183, ובכיוון הספק ישנה את מה שה SPA מבטיח. דרישה שהמשלים שונה מ `reviewedBy` תשבור את `tests3/integration/fin-invariants.test.ts`, שבו אדמין אחד מאשר ומשלים. נעילה מייעצת כאן לבד מגינה רק על עצמה.

#### `apps/api/src/modules/pay/wallet-request.controller.ts`
נתיבי בקשות הארנק, `@Controller()` בלי prefix. דפוס P2.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 23 עד 46 | `SubmitWalletRequestDto` עם סוג, סכום שלם חיובי, מטבע ומקור מהרשימות, אורכים. `CancelDto`, `ReviewNoteDto`, `RejectDto` | דרישות לפי סוג נאכפות בשירות |
| 63 עד 76 | `POST /finance/wallet-requests`, ממלא null לשדות חסרים ו USD כברירת מחדל, ומגיש בשם `user.id` | לא `@AllowSuspended`, ולכן מושעה על חוב לא יכול להגיש cash_in, ראה חוב, ריבית והשעיה |
| 78 עד 81 | `GET /finance/wallet-requests`, רק של המשתמש | |
| 83 עד 86 | `GET /finance/wallet-requests/:id`, 404 אם לא שלו | אדמין שקורא כאן מקבל כל בקשה, כי `loadFor` מתיר סוקר |
| 88 עד 91 | `POST /finance/wallet-requests/:id/cancel` עם סיבה אופציונלית | רק המבקש, ורק לפני אישור |
| 95 עד 106 | `GET /admin/wallet-requests` עם מסננים מ query בלי ולידציה | enum לא חוקי חוזר 400 דרך `22P02` במסנן הגלובלי, תאריך לא חוקי 500 |
| 108 עד 112 | `GET /admin/wallet-requests/:id`, אותה `detail` כמו ללקוח | |
| 114 עד 118 | `POST :id/review`, ל `pending_review` | |
| 120 עד 124 | `POST :id/approve` עם הערה אופציונלית | מסמן `reviewedBy`, ולא נבדק אחר כך מול המשלים |
| 126 עד 130 | `POST :id/reject`, `RejectDto` דורש סיבה | מותר גם מ `approved` ו `processing` |
| 132 עד 136 | `POST :id/processing` | מצב ביניים בלי משמעות כספית |
| 138 עד 143 | `POST :id/complete`, הנתיב היחיד שמסלק בקשה | הכל ב `WalletRequestService.complete`. הסרת `@Roles` לא תפתח, השירות בודק שוב |

#### `apps/api/src/modules/pay/chargeback.service.ts`
רישום ידני של תשלום כרטיס שבעל הכרטיס ביטל. אין webhook ואין קשר ל PayPal, מפעיל מזין. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 46 עד 48 | `terms` מחזיר את העמלה | לא נקרא |
| 63 | סיבה חובה | |
| 65 עד 85 | טרנזקציה, `FOR UPDATE` על `external_payment`, רק `topup` בסטטוס `succeeded`, 409 אם `reversed` | רישום כפול נחסם. רק תשלומי checkout, ולכן cash_in שהושלם לא ניתן לביטול כאן, וכל עוד checkout לא עובד אין תשלום אמיתי לבטל |
| 91 עד 102 | debit `chargeback` על הסכום המקורי | אין ביטול חלקי |
| 107 עד 140 | עמלה 25 דולר כ `charge` ו `fee`, אלא אם `chargeFee` הוא false | |
| 142 עד 145 | `status: 'reversed'` על `external_payment` | הטבלה הזו אינה append only |
| 147 עד 176 | audit ו outbox `payment_reversed`, החזרת סכומים | |
| 181 עד 188 | `reversible`, מאה תשלומים אחרונים שאפשר לבטל | בלי עימוד |

**שים לב.** אין בדיקת יתרה, הביטול יכול להוריד למינוס בכוונה, ומדיניות החוב מטפלת. אין הפרדת תפקידים, אדמין יכול לבטל כל תשלום והפעולה נרשמת ב audit. הרחבה לבקשות cash_in שהושלמו דורשת קישור בין `wallet_request` לביטול ושינוי הבדיקה בשורה 73. פריטים שנקנו בכסף שבוטל נשארים אצל הקונה. חיבור ל webhook דורש קודם לשמור את מזהה ה capture ב `checkout.service.ts`.

#### `apps/api/src/modules/pay/pay.controller.ts`
כל נתיבי הכספים שאינם בקשות ארנק, וה webhook. `@Controller()` בלי prefix. כל נתיב משתמש לוקח את המזהה מ `@CurrentUser()`, ולכן אין IDOR. דפוס P2.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 42 | `TopupDto`, `WithdrawRequestDto`, `WithdrawConfirmDto` של הנתיבים הישנים, `CheckoutDto` עם מפתח עד 120 ו token עד 200, `ChargebackDto` | |
| 87 עד 90 | `GET /finance/funding-routes`, `routes` של checkout | פתוח לכל מחובר, כולל פרטי בנק מהסביבה |
| 99 עד 102 | `POST /finance/checkout` עם `user.id` | E3, ראה `checkout.service.ts` |
| 104 עד 107 | `GET /finance/payments`, תשלומי topup של המשתמש | |
| 116 עד 120 | `GET cash-out-quote`, `parseInt` על query, לא מספר הופך ל 0 | |
| 124 עד 138 | `GET chargebacks/reversible` ו `POST chargebacks/:paymentId`, `@Roles('admin')` | `paymentId` לא נתפס ב audit |
| 140 עד 148 | `GET /finance/wallet` יתרה נגזרת, `GET /finance/ledger` כל השורות | בלי עימוד |
| 151 עד 154 | `GET /finance/wallet/pending`, `openTotals` | כסף שמיועד לבקשות פתוחות, לתצוגה בלבד, לא מנוכה מהיתרה |
| 160 עד 175 | `POST wallet/topups` shim, מגיש cash_in עם `bank_transfer` קבוע ומחזיר `pending_approval` | נותן ללקוחות ישנים 2xx אמיתי במקום שבירה, אבל המשמעות השתנתה, אין זיכוי מיידי |
| 182 עד 198 | `POST withdrawals` shim, מגיש cash_out עם `beneficiaryName` שווה ליעד | שם המוטב הוא IBAN בעיני הסוקר. לא נושא הפניה, ולכן מקור ה 409 ב `fin-invariants`, E16. מחיקת ה shims שוברת את הבדיקה |
| 205 עד 208 | `POST withdrawals/confirm` זורק 410 | |
| 210 עד 232 | `POST /webhooks/payment`, `@Public()`, בונה מחדש את הגוף עם `JSON.stringify` ומעביר עם הכותרות | לא מאמת על הבייטים הגולמיים, מה שעלול להכשיל אימות של הודעות אמיתיות. `rawBody` אמיתי דורש `verify` ב `express.json` ב `main.ts`. כישלון אימות זורק `Error` רגיל, ולכן 500 ולא 4xx כמו בהערה |

### esc, עסקאות נאמנות

עסקה פרטית שבה Bault מחזיקה כסף של קונה וכרטיס של מוכר, בודקת את הכרטיס, ומשחררת רק כששני הצדדים מסכימים. זה המקום היחיד שמזיז כסף ובעלות על פריט באותה פעולה. אין טבלת מעברים כמו בבקשות ארנק, כל פעולה קוראת ל `assertStatus` עם רשימה משלה, והדיאגרמה היא האיחוד שלהן.

```mermaid
stateDiagram-v2
  [*] --> proposed: raise
  proposed --> agreed: agree
  proposed --> cancelled: cancel
  agreed --> cancelled: cancel
  agreed --> funded: fund, escrow_hold או קבלה חיצונית
  funded --> inspecting: receiveItem
  inspecting --> awaiting_release: inspect
  awaiting_release --> settled: שני שחרורים, settle
  funded --> returned: returnDeal
  inspecting --> returned: returnDeal
  awaiting_release --> returned: returnDeal
```

#### מי רשאי לעשות מה בעסקה

| פעולה | קונה עם חשבון | מוכר עם חשבון | staff | צד חיצוני |
|---|---|---|---|---|
| `raise` | כן, כמעלה | כן, כמעלה | כן, כמשתמש רגיל | לא |
| `agree` | רק אם הוא הצד השני | רק אם הוא הצד השני | כן, גם בשם בעל חשבון | staff בשמו |
| `fund` | כן | לא | כן, גם מהארנק של הקונה | staff מאשר קבלה עם הפניה |
| `receiveItem`, `inspect` | לא | לא | כן, דרך `@Roles` בלבד | לא |
| `release` | בשם עצמו | בשם עצמו | רק בשם הצד החיצוני | staff בשמו |
| `returnDeal` | כן | כן | כן | לא |
| `cancel` | כן, לפני מימון | כן, לפני מימון | כן | לא |

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/esc/esc.module.ts` | דפוס P1, לא גלובלי, controller ו service. כל התלויות, `CustodyService`, `LedgerService`, `PricingService`, `OutboxService`, `MembershipService`, מגיעות ממודולים גלובליים. ה export של `EscrowService` לא בשימוש. |

#### `apps/api/src/modules/esc/escrow-terms.ts`
נתונים ופרדיקטים, משוקפים ב SPA ב `apps/web/src/shared/escrow.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 27 | עמלה אחוז אחד, מינימום עמלה 25 דולר, מינימום עסקה 500 דולר, `ESCROW_FEE_ACTION` | העמלה מקבוע בקוד, לא מ `pricing_rule`, כמו עמלת המשיכה. כלל `escrow_fee` ב seed מוצג במחירון ולא נגבה |
| 29 עד 32 | `escrowFeeMinor`, `Math.ceil` של אחוז עם רצפה, אפס לסכום לא חיובי. מועבר כפונקציה ל `memberships.waive` ב `settle` | מתחת ל 2500 דולר תמיד 25. שינוי כאן לא משנה עסקאות קיימות, אבל משנה את חישוב הנחת המנוי ב `settle` |
| 46 עד 83 | `checkDeal` מחזיר רשימת בעיות ולא זורק. סכום שלם מעל המינימום, תיאור, צד שני מוגדר בדיוק פעם אחת, כחשבון או כשם ומייל. `raise` הופך את הבעיה הראשונה להודעה | אין תקרה, ו `value_minor` הוא `integer`, כך שסכום ענק חוזר כ 500 |
| 92 עד 100 | מוכר שמעלה עם קונה חיצוני לא יכול לבחור `buyer_vault` | |
| 113 עד 115 | `feePayer` מחזיר את המעלה | לא נקרא, `settle` משתמש ב `raisedBy` ישירות |

#### `apps/api/src/modules/esc/escrow.service.ts`
דפוס P3 בלי השורה החשובה שלו. בשום פעולה אין `FOR UPDATE` על `escrow_deal`, העסקה נקראת מחוץ לטרנזקציה, וכל UPDATE מסנן לפי `id` בלבד. הקורא היחיד `esc.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 37 | `Deal`, `EscrowActor`, `isStaff` של `warehouse_operator` או `admin` | |
| 70 עד 79 | `terms`, הקבועים ו `configuredBps` מ `tryPrice('escrow_fee')` בלי בסיס | לכלל אחוזים מחזיר 0, לכלל קבוע סנטים ולא נקודות בסיס. `raise` מתעלם מהכלל ממילא. ה SPA לא קורא את השדה |
| 81 עד 104 | `writeEvent` ל `escrow_event` append only, כולל `onBehalfOf` | |
| 107 עד 112 | `sides` מתרגם מעלה וצד שני לקונה ומוכר. null הוא צד חיצוני | |
| 114 עד 134 | `load` בלי נעילה, `loadFor` מחזיר 404 למי שאינו צד ואינו staff | בדיקת הבעלות של המודול |
| 136 עד 144 | `assertStatus`, 409 אם הסטטוס לא ברשימה | רץ על שורה שנקראה מחוץ לטרנזקציה, ולכן לא מגן ממרוצים |
| 162 עד 172 | `raise`, פתרון username לחשבון, דחייה אם לא נמצא או אם זה המעלה | |
| 174 עד 187 | `checkDeal` והקפאת `feeMinor` על העסקה | |
| 189 עד 226 | טרנזקציה, INSERT עם קוד מ `prefixedId`, סטטוס `proposed`, אירוע `raised`, ו outbox `escrow_proposed` לצד שני עם חשבון | |
| 237 עד 249 | `agree`, סטטוס `proposed`. צד חיצוני רק staff, צד עם חשבון הוא עצמו או staff | `&& !isStaff` מאפשר למפעיל להסכים בשם בעל חשבון, והאירוע לא מסמן שזה נעשה בשמו |
| 251 עד 272 | עדכון ל `agreed`, אירוע, outbox `escrow_agreed` למעלה | |
| 292 עד 329 | `fund` לקונה חיצוני, staff בלבד עם הפניה חובה, עדכון ל `funded` עם `fundingSource: 'external'`, `fundingAttestedBy` ו `fundingReference`, ואירוע | אין שורת לדג'ר, בכוונה, כי הכסף לא בארנק. בהחזרה אין שום רישום של חובה להחזיר אותו |
| 331 עד 342 | קונה עם חשבון, הקונה או staff, בדיקת יתרה מחוץ לטרנזקציה מול הערך בלבד | staff יכול לחייב ארנק של קונה שלא לחץ, ויחד עם `agree` בשמו לקחת כסף לעסקה שלא אושרה |
| 344 עד 385 | טרנזקציה של debit `escrow_hold`, עדכון ל `funded` עם `fundingSource: 'wallet'`, אירוע ו outbox למוכר | E18. לחיצה כפולה כותבת שני `escrow_hold` לעסקה אחת, ו `returnDeal` מחזיר רק אחד. `fund` מקביל ל `cancel` משאיר עסקה `cancelled` עם חיוב ש `returnDeal` לא מקבל |
| 393 עד 418 | `receiveItem`, `load` בלי בדיקת צד, סטטוס `funded`, פריט קיים ב `lifecycleState` `stored`, עדכון ל `inspecting` עם `itemId`, ואירוע עם המספר הסידורי | E4. לא בודק שהפריט של המוכר, לא בעסקה אחרת, ולא מסמן `holdFlag`, כך שהמוכר יכול למכור אותו ב marketplace בינתיים |
| 428 עד 471 | `inspect`, הערות חובה, `inspectionMatches` כ `yes` או `no`, תמיד ל `awaiting_release`, outbox לשני הצדדים | ממצא שלילי לא מחזיר את העסקה, הקונה צריך לבחור החזרה |
| 484 עד 505 | `release`, קונה ומוכר בשם עצמם. staff רק בשם הצד החיצוני ורק כשהוא מציין אותו נכון | בקרה טובה, staff לא משחרר בשם בעל חשבון |
| 507 עד 529 | חותמת שחרור ואירוע בטרנזקציה קצרה בלי outbox, ואם `buyerDone` ו `sellerDone` קורא ל `settle` בטרנזקציה נפרדת | שניהם מחושבים מהשורה הישנה. שני שחרורים מקבילים של אותו צד אחרי שהשני כבר שחרר קוראים ל `settle` פעמיים |
| 539 עד 560 | `settle` בתוך `custody.run`, טוען בלי נעילה ובלי בדיקת סטטוס, credit `escrow_release` למוכר על הערך המלא | מוכר חיצוני לא מקבל שורה, החוב אליו לא רשום בשום מקום |
| 566 עד 607 | `memberships.waive` על `escrow_fee`, ואז `charge` ושורת `fee` על המעלה | בלי בדיקת יתרה |
| 611 עד 613 | `custody.transferOwnership` לקונה אם יש פריט ויש לקונה חשבון | לא בודק בעלים צפוי, ולכן פריט שנמכר בינתיים עובר שוב, E4. לקונה חיצוני הפריט נשאר אצל המוכר ואין יצירת משלוח |
| 615 עד 637 | סטטוס `settled`, אירוע ו outbox `escrow_settled` | |
| 652 עד 674 | `returnDeal`, סיבה חובה, כל צד או staff, מ `funded`, `inspecting` או `awaiting_release`, credit `escrow_refund` לקונה רק כשהמימון מהארנק, בלי עמלה. הכרטיס לא זז, כי הבעלות לא עברה | ההערה אומרת שצד מחזיר רק אחרי ממצא, הקוד מתיר כבר ב `funded`. מימון חיצוני לא משאיר רישום של חובת החזר |
| 675 עד 700 | עדכון ל `returned` עם `closeReason`, אירוע ו outbox | `release` ו `return` מקבילים מזכים גם את המוכר וגם את הקונה מאותו חיוב, והקונה נשאר עם הכרטיס |
| 704 עד 724 | `cancel` מ `proposed` או `agreed`, בלי כסף | המרוץ עם `fund` שלמעלה |
| 731 עד 761 | `listMine` לפי מעלה או צד שני, `queue` של כל הפתוחות, `detail` עם אירועים מהחדש לישן, `buyerId` ו `sellerId` | בלי עימוד. `queue` כולל גם `proposed`, שאין בו עבודה לצוות |
| 770 עד 788 | `heldFor`, סכום עסקאות שמומנו מהארנק בסטטוס פתוח כשהמשתמש הוא הקונה | |

**שים לב.** התיקון המינימלי הוא להעתיק את הדפוס של `wallet-request.service.ts`, לטעון את העסקה בתוך הטרנזקציה עם `FOR UPDATE` ולבדוק שם סטטוס, או להוסיף `AND status = <expected>` לכל UPDATE ולבדוק שעודכנה שורה. `holdFlag` על הפריט בזמן העסקה הוא התיקון הטבעי ל E4, כי `mkt/listing.service.ts`, `mkt/purchase.service.ts` ו `mkt/trade.service.ts` כבר מסרבים לפריט מסומן, אבל צריך לשחרר אותו ב `settle` וב `returnDeal`. אין שום תפוגה, וכסף של קונה יכול להיות מוחזק ללא הגבלת זמן.

#### `apps/api/src/modules/esc/esc.controller.ts`
נתיבי `/escrow`. דפוס P2. הנתיבים הסטטיים מוגדרים לפני `:id` כדי ש Express לא יתפוס אותם כמזהה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 48 | `RaiseDealDto`, `NotesDto`, `FundDto`, `ReceiveItemDto`, `InspectDto`, `ReleaseDto`, `ReasonDto` | `counterpartyUsername` בלי אורך. `itemId` לא uuid חוזר 400 דרך המסנן הגלובלי |
| 65 עד 85 | `GET terms`, `mine`, `held`, ו `queue` עם `@Roles('warehouse_operator', 'admin')` | העברת `:id` מעליהם תשבור אותם |
| 87 עד 90 | `POST /escrow`, המעלה הוא המשתמש המחובר | |
| 92 עד 95 | `GET :id`, 404 למי שאינו צד, staff רואה הכל | |
| 97 עד 100 | `POST :id/agree` עם הערות | ההרשאה בשירות, כולל הפתח של staff בשם בעל חשבון |
| 103 עד 106 | `POST :id/fund` עם הפניה אופציונלית | הפניה חובה רק לקונה חיצוני, נבדק בשירות |
| 108 עד 119 | `receive-item` ו `inspect` עם `@Roles` | מעבירים רק `user.id`, השירות לא בודק תפקיד. הסרת `@Roles` תאפשר לכל משתמש לשייך פריט ולכתוב ממצא |
| 121 עד 124 | `POST :id/release` עם צד אופציונלי | `side` נדרש רק ל staff שרושם צד חיצוני |
| 126 עד 134 | `POST :id/return` ו `POST :id/cancel` עם סיבה חובה | ההרשאה בשירות. שתי בקשות מקבילות מכאן ומ `release` הן המרוץ P0 |

### מה ה SPA מניח על האזור

שינוי באחד מאלה דורש שינוי מקביל ב `apps/web`.

- `GET /me/profile` הוא ה probe בעלייה, ולכן חייב להישאר `@AllowSuspended` ולהחזיר `status`.
- הקוד `email_unverified` מפעיל ב `SignInPage.tsx` הצעה לשלוח מייל מחדש. שאר הקודים מוצגים כהודעה בלבד, כולל `negative_balance_blocked`.
- נתיבי ה hash `verify-email` ו `reset-password` עם `token` ב query של ה fragment, כפי ש `emailLink` בונה.
- גבולות `WALLET_REQUEST_LIMITS` ומכונת המצבים משוקפים ב `apps/web/src/shared/walletRequests.ts`.
- עמלות escrow ומינימום העסקה משוקפים ב `apps/web/src/shared/escrow.ts`, והמספרים מגיעים מ `GET /escrow/terms`.
- `GET /finance/cash-out-quote` מחזיר `netMinor`, שה SPA מציג כמה שיגיע לחשבון.
- שמות הקבוצות ב `PRICE_GROUPS` הם מפתחות תרגום במחירון.
- `MoneyPanels.tsx` מייצר `idempotencyKey` חדש בכל לחיצה ולא שולח `paymentMethodToken`.
- `SupportPage.tsx` קורא לארבעת מסלולי הכרטיסים של הלקוח. `GET /support/awaiting` מתואר כתג בסרגל, אבל ה SPA לא קורא לו היום.
- `apps/web/src/shared/session.ts` טוען את `/me/profile` ומאחד קריאות מקבילות להבטחה אחת, כך ששינוי צורת `ProfileView` משנה את `SessionProfile` ב SPA.

### החלטות תכנון שכדאי להכיר

| החלטה | למה | מחיר |
|---|---|---|
| טוקן אטום שנבדק מול המסד, לא JWT | ביטול, השעיה ושינוי תפקיד מיידיים, אין מפתח חתימה לנהל | שאילתת JOIN בכל בקשה |
| sha256 לטוקנים ולא argon2 | לטוקן של 256 ביט אין צורך ב hash איטי | אין |
| `@Public` ו `@AllowSuspended` כ metadata, deny by default רק לסטטוס | פשוט לקרוא על כל מסלול | מסלול בלי `@Roles` פתוח לכל מחובר, הפוך מ deny by default |
| audit גנרי ברמת HTTP, fire and forget | כל מסלול חדש מכוסה אוטומטית, audit לא מכשיל תשובה | השורה אומרת מה נקרא ולא מה השתנה, ולא אטומית. `pay` משלים ידנית בתוך טרנזקציה |
| שליחת מייל סינכרונית | פשטות, ושגיאה מגיעה למשתמש | timing oracle ו 500 שחושף קיום חשבון |
| יתרה נגזרת מלדג'ר append only | אמת אחת, תיקון הוא שורה מפצה | אין שורה לנעול, double spend בכל בדיקת יתרה |
| יתרה שלילית מותרת, חוסמת פעולות חדשות | אפשר לחייב אחסון כשהארנק ריק | כל שירות חדש צריך לזכור `assertNotBlocked` |
| מחיר ככלל עם תאריך תחולה ו snapshot על החיוב | היסטוריה מלאה, חיוב ישן לא משתנה | הטבלה רק גדלה, כללים ישנים פתוחים לנצח |
| חיוב דרך port בטרנזקציה של הקורא | אין חיוב יתום, ושוברים תלות מעגלית בין `inv` ל `pay` | go to definition לא מוביל למימוש |
| עמלות משיכה, chargeback ו escrow כקבועים | ציטוט וחיוב קוראים לאותה פונקציה | שני מקורות אמת מול `pricing_rule` והמחירון |
| ספק נקרא מחוץ לטרנזקציה ב checkout, ובתוכה ב payout | checkout לא מחזיק חיבור על רשת, payout מתגלגל על `failed` | ב checkout כסף בלי שורה, ב payout כסף שיצא בלי חיוב |
| הגשה אף פעם לא מזיזה כסף | סקירה אנושית לכל כסף ידני | כסף נכנס רק כשאדמין זמין |
| מכונת מצבים כנתונים בבקשות ארנק, ופזורה ב escrow | בבקשות, כל מעבר בשורה אחת | ב escrow אין מקום אחד לבדוק, ואין נעילה |
| staff פועל בשם צד חיצוני בעמודות ייחוס נפרדות | רישום ברור של מי אישר | נאכף ב `release` בלבד, לא ב `agree` וב `fund` |

### שינויים נפוצים, איפה נוגעים

| שינוי | קבצים שצריך לגעת בהם | מלכודת |
|---|---|---|
| תפקיד חדש, למשל `support_agent` | migration ל enum `user_role`, `auth-context.ts`, `SupportService.staff`, `isStaff` ב `escrow.service.ts`, `isReviewer` ב `wallet-request.service.ts`, כל `@Roles` רלוונטי | אין היררכיה, וכל מקום שבודק תפקיד ידנית צריך עדכון נפרד |
| מסלול חדש פתוח למושעה | `@AllowSuspended()` על ה handler | אף פעם על מסלול כספי. אין בדיקת מטריצה שתתפוס טעות |
| מסלול staff חדש | `@Roles('warehouse_operator', 'admin')` על ה method | בלי `@Roles` המסלול פתוח לכל לקוח. רשימת המסלולים ב `sec-authorization.test.ts` לא מתעדכנת לבד |
| מסלול שמקבל מזהה ישות של משתמש | סינון לפי `userId` מה session ב service, ו 404 ולא 403 | השכבה היחידה נגד IDOR |
| שינוי מדיניות סיסמה | `RegisterDto`, `ResetPasswordDto`, `ChangePasswordDto` יחד | trim על סיסמה שובר התחברות קיימת |
| עמלה חדשה על פעולה קבועה | כלל ב `pricing_rule` וקריאה דרך `BILLING_PORT` בתוך טרנזקציית הפעולה | כלל percentage בלי בסיס יוצא אפס בשקט. בלי seed אין כלל ואין מחיר |
| שינוי עמלת משיכה, chargeback או escrow | `money-terms.ts` או `escrow-terms.ts`, וה SPA דרך `cash-out-quote` ו `escrow/terms` | הכלל ב `pricing_rule` לא משפיע. בדיקות `pay-money-in-out` מקבעות מספרים |
| סוג שורת לדג'ר חדש | migration ל enum `ledger_type`, `LedgerEntry.type`, ה worker `ledger-invariant-check.ts` ודף התנועות ב SPA | `balanceOf` סוכם כל סוג, כולל שגוי |
| מסלול מימון חדש | `FUNDING_ROUTES`, ואם ידני גם `checkout.service.ts` `routes` | `instant: true` פותח checkout מיד דרך אותו אדפטר |
| מעבר חדש בבקשת ארנק | `WALLET_REQUEST_TRANSITIONS` ו `apps/web/src/shared/walletRequests.ts` | מותר מיד דרך `applyTransition`, ונוצר אירוע outbox חדש בשם `wallet_request_<status>` |
| פעולה חדשה שמחייבת ארנק | בדיקת יתרה בתוך הטרנזקציה, ורצוי נעילה מייעצת משותפת | להוסיף את המקום לטבלת האתרים במסלול הכסף |
| שדה חדש בפרופיל | `ProfileView` ו `get` ב `profile.service.ts`, ו `SessionProfile` ב SPA | נחשף גם למושעה, כי המסלול `@AllowSuspended` |
| הסתרת PII ממי שאינו admin | בחירת עמודות ב `select` של ה service | `PiiInterceptor` לא יעבוד על plain objects, אל תסמוך עליו |
| audit לפעולה שקורית ב worker | INSERT ישיר ל `audit_record` מה job, כי `AuditService` לא זמין שם | היום השעיה אוטומטית וריבית לא נרשמות כלל |
| מצב חדש ב escrow | `assertStatus` בכל פעולה רלוונטית, `queue`, `heldFor` וה SPA | אין טבלת מעברים, קל לפספס פעולה |

### בדיקות שמכסות את האזור

| קובץ | מה הוא מוכיח | מה חסר |
|---|---|---|
| `tests3/integration/sec-authorization.test.ts` | 401 לכל מסלול לא ציבורי, 403 לרשימת מסלולי מחסן ואדמין, IDOR על כרטיסים, כתובות ופריטים, logout שמבטל cookie, cookie מזויף, איפוס בלי חשיפה בגוף ובקצב | לא בודק זמן תגובה, לא בודק מושעה, וההשוואה לרשימה קבועה של מסלולים |
| `tests3/integration/sec-validation.test.ts` | סכומים שליליים, שדות לא מוכרים, מזהים פגומים מחזירים 4xx, username כפול, סיסמה קצרה, username לא ניתן לשינוי | |
| `tests/integration/acc-*.test.ts` | רישום ב `pending`, נרמול username, שמות, כתובות עם ברירת מחדל יחידה ובלי חשיפה לזר | `acc-status-block.test.ts` שורות 41 ו 42 הן TODO של חסימת מושעה |
| `tests/integration/pay-money-in-out.test.ts` | מסלולים, checkout מיידי ואידמפוטנטי ב sandbox, גבולות, ציטוט עמלה, עמלה כשורה נפרדת בהשלמה, chargeback, מחירון ציבורי | לא בודק את הסכום שנשלח ל payout, ולכן העמלה הכפולה עוברת. אין מקביליות ואין webhook |
| `tests3/integration/fin-invariants.test.ts` | סכום הלדג'ר שווה ליתרה, רכישה מזיזה גם פריט, אין מחיקת שורות, הפרדת תפקידים, אין זיכוי לפני השלמה, השלמה כפולה נחסמת, snapshot מחיר | לא אידמפוטנטי על מסד ישן, ה 409 של E16. אותו אדמין מאשר ומשלים |
| `tests/integration/esc-and-human-fulfilment.test.ts` | רצפה, צד שני, `buyer_vault` לקונה חיצוני, החזקה, בדיקה וסגירה, החזרה, קונה חיצוני באישור, הסתרה מזר | אין `Promise.all` על `fund`, `release` ו `return`, ולכן מרוצי ה P0 לא נתפסים |

### בקרות שעובדות, לא לשבור

| בקרה | איפה | מה ישבור אותה |
|---|---|---|
| טוקן session אקראי של 256 ביט, במסד רק hash | `session.service.ts` 40 עד 48 | שמירת הטוקן הגולמי, או מעבר לטוקן שנגזר ממזהה |
| אימות מול המסד בכל בקשה, סטטוס ותפקיד עדכניים | `session.service.ts` 53 עד 69 | cache על `resolve`, או JWT |
| deny by default לסטטוס לא מוכר | `auth.service.ts` 155, `session-auth.guard.ts` 56 עד 58 | החלפת התנאי ברשימה של סטטוסים אסורים |
| `forbidNonWhitelisted` חוסם הזרקת `role` ו `status` | `main.ts` 130 עד 137 | כיבוי הדגל, או DTO שמכיל שדות כאלה |
| username נכתב במקום אחד ומוגן ב trigger | `auth.service.ts` 71 עד 84, מיגרציה 0004 | מסלול עדכון שעוקף את ה trigger, אין כזה |
| טוקני מייל ב fragment, hash במסד, TTL | `verification.service.ts` 12 עד 31 | מעבר מ hash router ל path בלי לשנות את מבנה הקישור |
| 404 ולא 403 למי שאינו בעלים | `profile.service.ts`, `support.service.ts` 63 עד 68, `wallet-request.service.ts` 281 עד 288, `escrow.service.ts` 128 עד 134 | הסרת התנאי על `userId` או על הצדדים |
| מפתח אחסון שהשרת בוחר, allowlist בלי SVG, תקרה על בייטים מפוענחים | `media.service.ts` 32 עד 48, 94 עד 107 | שם קובץ מהלקוח במפתח, או הוספת `image/svg+xml` |
| outbox באותה טרנזקציה כמו השינוי | `support.service.ts`, `checkout.service.ts`, `wallet-request.service.ts`, `escrow.service.ts` | `emit` מחוץ ל `tx` |
| append only על `ledger_record`, `wallet_request_event`, `escrow_event`, `audit_record`, `login_attempt`, `support_message` | `0001_append_only.sql` | migration שמסיר טבלה מרשימת `history_tables` |
| אינדקס ייחודי על `external_payment.provider_ref` | מיגרציה 0017 | שינוי פורמט `providerRef` או הסרת האינדקס |
| אינדקס ייחודי חלקי על `settled_ledger_id` ו `CHECK (amount > 0)` על `wallet_request` | מיגרציה 0004 | |
| `FOR UPDATE` על הבקשה בהשלמה ובכל מעבר, ועל התשלום בביטול | `wallet-request.service.ts` 348 עד 353, 608 עד 613, `chargeback.service.ts` 66 עד 71 | קריאת השורה מחוץ לטרנזקציה, כמו ב escrow |
| payout לפני חיוב, וגלגול על `failed` | `wallet-request.service.ts` 418 עד 433 | העברת ה payout אחרי כתיבת הלדג'ר בלי טיפול בכישלון |
| השוואת סכום ומטבע מהספק לבקשה | `checkout.service.ts` 163 עד 177 | זיכוי לפי `input.amountMinor` בלי ההשוואה |
| חיוב בתוך טרנזקציית הקורא, fail closed על פעולה בלי מחיר | `billing.service.ts` 31 עד 93, `pricing.service.ts` 111 | `tryPrice` במקום `price` על הפעולה הכללית |
| snapshot של הכלל על כל חיוב | `pricing.service.ts` 118 עד 129 | עריכת כלל במקום יצירת חדש |
| staff משחרר escrow רק בשם צד חיצוני | `escrow.service.ts` 495 עד 502 | הוספת `!isStaff` לתנאי, כמו ב `agree` |
| sandbox חסום ב production | `shared/adapters/adapters.module.ts` | הרצה עם `NODE_ENV` שאינו production בפריסה אמיתית |
| worker שמתריע על שורה לא חיובית ועל חיוב בלי שורה | `apps/worker/src/jobs/ledger-invariant-check.ts` | שינוי `reference_type` של חיובים בלי לעדכן את ה worker |

### ממצאים לפי חומרה

| חומרה | מקום | מה | תיקון מינימלי |
|---|---|---|---|
| P0 | `escrow.service.ts` 484 עד 701 | `release` ו `return` מקבילים, או שני `settle`, מזכים כסף פעמיים, כי אין נעילה ו `settle` לא בודק סטטוס | `FOR UPDATE` על העסקה בתוך כל טרנזקציה ובדיקת סטטוס שם, ו `settle` שבודק `awaiting_release` |
| P1 | `escrow.service.ts` 292 עד 386 | `fund` כפול כותב שני `escrow_hold`. `fund` מקביל ל `cancel` נועל כסף, E18 | אותה נעילה, ואינדקס ייחודי חלקי על `ledger_record` לסוג `escrow_hold` ולהפניה |
| P1 | `escrow.service.ts` 393 עד 418 | פריט לא נבדק ולא מסומן `holdFlag`, ו `settle` לוקח אותו מקונה של ה marketplace, E4 | לבדוק שהבעלים הוא המוכר, לסמן `holdFlag`, ולשחרר ב `settle` וב `returnDeal` |
| P1 | `wallet-request.service.ts` 419 עד 507 | עמלת משיכה נגבית פעמיים, בארנק ובסכום שנשלח | להחליט על מודל אחד. שליחת `request.amount` לספק לא שוברת בדיקה |
| P1 | `wallet-request.service.ts` 419 עד 449 | payout `pending` נחשב הצלחה ואיש לא מעדכן | webhook של payouts או job התאמה שמעדכן `external_payment` ומפצה בלדג'ר |
| P1 | `ledger.service.ts` 57 עד 67 | אין נעילה לפי משתמש, double spend בכל אתרי הטבלה במסלול הכסף, E1 | עזר אחד עם `pg_advisory_xact_lock(hashtext(user_id))`, שכל אתר קורא לו בתוך הטרנזקציה |
| P1 | `wallet-request.service.ts` 309 עד 356 | אדמין יחיד מאשר ומשלים cash_in לחשבון שהוא שולט בו | לדרוש ש `reviewedBy` שונה מהמשלים מעל סף סכום, ו `documentKey` חובה ל cash_in |
| P1 | `checkout.service.ts` 132 עד 216 | checkout עם PayPal לא עובד, ו capture לפני שורה משאיר כסף בלי עקבה, E3 | יצירת הזמנה ב SPA, שורת `pending` לפני הקריאה, ומפתח שנשמר בין ניסיונות |
| P2 | `checkout.service.ts` 179 עד 191 | מזהה ה capture לא נשמר, אין פיוס ואין קישור ל webhook | עמודה למזהה ה capture עם אינדקס ייחודי |
| P2 | `topup.service.ts` 63 עד 75 | webhook ריק, `pending` לא מזוכה לעולם | טיפול באירועי capture לפי מזהה, וכתיבת `webhook_event_id` עם אינדקס ייחודי באותה טרנזקציה |
| P2 | `ledger.service.ts` 44 עד 55, `prc.controller.ts` 20 | אין `CHECK (amount > 0)` ואין `@Min(0)`, כלל שלילי הופך חיוב לזיכוי | migration עם `CHECK`, ו `@Min(0)` ב DTO |
| P2 | `money-terms.ts`, `escrow-terms.ts` | עמלות מקבועים, המחירון מציג כללים שלא נגבים | לקרוא את הכללים בחיוב, או להסיר אותם מהמחירון |
| P2 | `escrow.service.ts` 247, 331 | staff מסכים ומממן בשם בעל חשבון | להגביל staff לצד חיצוני כמו ב `release`, או לרשום `onBehalfOf` |
| P2 | `escrow.service.ts` 609 עד 613 | קונה חיצוני עם `ship_to_buyer` משלם ולא מקבל | ליצור משלוח ב `settle` או להחזיק את הפריט עם `holdFlag` עד המשלוח |
| P2 | `auth.service.ts` 52 עד 64, 117, `verification.service.ts` 91 עד 123 | חשיפת קיום חשבון ברישום, בזמן login, E13, ובזמן ושגיאות של מייל | verify מול hash דמה, תשובה אחידה ברישום, ושליחת מייל דרך outbox |
| P2 | `app.module.ts` 59 עד 69 | דלי `auth` הוא תקרת כל מסלול | `@SkipThrottle({ auth: true })` מחוץ למסלולי הזהות |
| P2 | `session-auth.guard.ts` 51 עד 66 | מושעה לא מתנתק, `closed` תקוע עד שבעה ימים | לא לזרוק על סטטוס במסלול ציבורי, ו `logout` כ `@Public` |
| P2 | `acc.dto.ts` | סיסמה של 8 תווים בלי blocklist ובלי MFA, ואין נעילה per account | blocklist, מינימום גבוה יותר, והשהיה לפי `login_attempt` |
| P3 | `password.service.ts` 69 עד 94, `verification.service.ts` 63 עד 88 | טוקן חד פעמי לא אטומי | `isNull(consumedAt)` ב UPDATE ובדיקת `returning` |
| P3 | `verification.service.ts` 79 עד 88 | אימות מחזיר ל `active` חשבון שנסגר | `WHERE status = 'pending'` |
| P3 | `audit.interceptor.ts` 36 עד 47 | כשל ב audit נבלע בשקט, כישלונות לא נרשמים | לוג ברמת error ו metric בתוך ה catch |
| P3 | `media.service.ts` 74 עד 110 | כל לקוח מעלה, אין magic bytes, אין מחיקה, E9 ו E10 | `@Roles` לצוות, בדיקת חתימת קובץ, ו `putObject` עטוף |
| P3 | `support.service.ts` 230 עד 263 | `resolve` ו `assign` בלי נעילה | UPDATE מותנה בסטטוס ובדיקת `returning` |
| P3 | `withdrawal.service.ts` 88 עד 114 | `confirm` מחייב ומחזיר `paid` גם בכישלון, לא מנותב | למחוק את `request` ו `confirm` |

### תוכניות תיקון לממצאים הכבדים

**מרוצי escrow, P0 ו P1.**
1. ב `escrow.service.ts` להוסיף `loadLocked(tx, dealId)` שקורא עם `.for('update')`, כמו `complete` ב `wallet-request.service.ts` שורות 348 עד 353.
2. בכל פעולה לפתוח טרנזקציה קודם, לטעון נעול, ורק אז `assertStatus` ובדיקות הצד.
3. ב `release` לחשב `buyerDone` ו `sellerDone` מהשורה הנעולה, ולקרוא ל `settle` עם אותו `tx` במקום טרנזקציה נפרדת. `settle` מקבל `tx` ובודק `awaiting_release`.
4. בדיקות עם `Promise.all` על שני `fund`, על `release` מול `return`, ועל `fund` מול `cancel`, ב `tests/integration/esc-and-human-fulfilment.test.ts`.

**פריט ב escrow, E4.**
1. ב `receiveItem` לבדוק שהבעלים של הפריט הוא `sellerId`, ולקרוא ל `custody.setHold(tx, itemId, true, operatorId)`, שנועל את הפריט ורושם `custody_event`.
2. ב `settle` וב `returnDeal` לשחרר את הדגל לפני העברת הבעלות או בסוף.
3. לזכור ש `relocate` מסרב לפריט מסומן, כך שהצבת הפריט במדף צריכה לקרות לפני הסימון או לשחרר אותו זמנית.

**נעילת ארנק, E1 ו E18.**
1. עזר אחד ב `ledger.service.ts`, למשל `lockWallet(tx, userId)` שמריץ `pg_advisory_xact_lock(hashtext(user_id))`.
2. לקרוא לו בתוך הטרנזקציה לפני כל בדיקת יתרה בטבלת האתרים במסלול הכסף. בדיקה שנמצאת היום מחוץ לטרנזקציה, כמו ב `fund` וב `mkt/offer.service.ts`, צריכה לעבור פנימה.
3. סדר נעילות קבוע, ארנק לפני שורה עסקית, כדי לא ליצור deadlock עם `FOR UPDATE` קיימים.

**עמלת משיכה כפולה.**
1. להחליט מה הלקוח משלם. אם הנטו שה SPA מציג נכון, הלדג'ר צריך לחייב `amount - fee` כ `withdrawal` ועוד `fee`, וזה שובר את `pay-money-in-out.test.ts` שורה 152 ושורות 163 עד 183.
2. אם החיוב הנוכחי נכון, לשלוח `request.amount` לספק ולשנות את התווית ב `MoneyPanels.tsx`.
3. להוסיף אדפטר תשלום מדומה שמתעד את הסכום שנשלח, ובדיקה שמשווה אותו לחיוב.

**checkout עם PayPal, E3.**
1. ב SPA ליצור ולאשר הזמנה עם PayPal JS SDK ולשלוח את מזהה ההזמנה כ `paymentMethodToken`, עם מפתח שנשמר בין ניסיונות.
2. ב `checkout.service.ts` לכתוב `external_payment` כ `pending` לפני ה capture, ולעדכן אחריו באותה שורה.
3. לשמור את מזהה ה capture בעמודה ייעודית עם אינדקס ייחודי, ולממש ב `topup.service.ts` השלמה של `pending` לפי האירוע.
4. לשמור raw body ב `express.json` כדי שהאימות ירוץ על הבייטים המקוריים.

### תלויות, טבלאות וסביבה

- **נכנסות.** `app.module.ts` רושם את ה guards וה interceptor מ `acc` ו `sec`, כך שכל controller במערכת עובר כאן. `BILLING_PORT` נצרך ב `inv`, `dis` ו `mkt`. `LedgerService` ב `mkt`, `dis`, `shp`, `adm`, `mem`, `esc`. `WalletService` ב `dis`, `mem`, `shp`. `PricingService` ב `pay`, `esc`, `mkt`, `shp`, `dis`. `MediaService` ב `inv/parcel.service.ts`.
- **יוצאות.** `acc` תלוי ב `shp/country.validator.ts` ו `shp/countries.ts`, `shared/tokens.ts`, `shared/names.ts` ו `EMAIL_ADAPTER`. `pay` תלוי ב `PAYMENT_ADAPTER`, `OutboxService`, `AuditService`, `MembershipService` ו `ConfirmationService`. `esc` תלוי ב `CustodyService.run` ו `transferOwnership`.
- **worker.** כותב ל `ledger_record` ב SQL ישיר ב `interest-accrual.ts`, `storage-fee.ts` ו `membership-renewal.ts`, קורא ב `debt.ts`, `wallet-suspension.ts` ו `ledger-invariant-check.ts`, ומשנה `user_account.status` ב `wallet-suspension.ts`. אין לו audit.
- **SPA.** `MoneyPanels.tsx`, `WalletRequestForms.tsx`, `EscrowTab.tsx`, ומראות של כללים ב `apps/web/src/shared/walletRequests.ts` ו `apps/web/src/shared/escrow.ts`. נתיבי ה hash `verify-email` ו `reset-password`.
- **סביבה.** `SESSION_COOKIE_NAME`, `NODE_ENV`, `AUTH_RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `CORS_ORIGINS`, `APP_BASE_URL`, `EMAIL_PROVIDER` ו `SMTP_*`, `STORAGE_*`, `BANK_*`, `PAYPAL_FF_HANDLE`, `PAYMENT_PROVIDER` ו `PAYPAL_*`. `SESSION_COOKIE_SECRET` ו `PAYPAL_PAYOUT_NOTE` מוגדרים ולא נקראים.
- **טבלאות.** `user_account`, `login_session`, `login_attempt`, `verification_token`, `shipping_address`, `audit_record`, `support_ticket`, `support_message`, `pricing_rule`, `ledger_record`, `charge`, `external_payment`, `wallet_request`, `wallet_request_event`, `withdrawal`, `escrow_deal`, `escrow_event`, `outbox_message`, ודרך `transferOwnership` גם `item` ו `custody_event`.

## פרק 5. קליטה, משמורת, הכספת, חברויות וקונסולת הניהול בצד השרת

### סקירה

זה הצד הפיזי של Bault. `inv` מטפל במה שמגיע למחסן, מתקנים, חבילות, קליטת פריטים, אצוות, תיקונים וסילוקים. `cst` הוא גרעין המשמורת, הטבלאות `item`, `bin`, `custody_event`, `bin_transfer` ומכונת המצבים של פריט. כל שינוי בבעלים, במדף או במצב של פריט אמור לעבור ב `CustodyService` ולכתוב אירוע באותה טרנזקציה. מעליהם שלושה מודולים שסובבים סביב שאלה כספית אחת, כמה עולה להשאיר קלף על מדף. `vlt` הוא חלון הקריאה של הלקוח, `mem` מוכר מנוי שמכסה חלק מהחיובים, ו `adm` היא קונסולת המנהל שיכולה לשנות את העובדות שעליהן כל השאר נשען. חיוב האחסון עצמו רץ ב worker, ב `apps/worker/src/jobs/storage-fee.ts`, ולא כאן.

סדר קריאה. `lifecycle.ts` ו `custody.service.ts`, כי כל השאר קורא להם. אחר כך `stow.service.ts`, ואז מסלול הקופסה, `parcel.service.ts` ואחריו `intake.service.ts`. בסוף `vault.service.ts`, `membership.service.ts` ו `adm.service.ts`.

```mermaid
flowchart LR
  P[parcel.service] --> I[intake.service]
  B[batch.service] --> C[custody.service]
  I --> C
  I --> S[stow.service]
  C --> E[(item, custody_event, bin_transfer)]
  V[vault.service] --> E
  A[adm.service] -- bypass --> E
  M[membership.service] --> CH[(charge)]
  W[worker storage-fee] --> CH
```

### מסלולים ונקודות חיבור

כל הבקרים כאן הם דפוס P2 עם הבדל אחד משותף. הוולידציה היא DTO של `class-validator`, וה `ValidationPipe` הגלובלי ב `apps/api/src/main.ts` רץ עם `whitelist`, `forbidNonWhitelisted` ו `transform`, כך ששדה לא מוצהר מחזיר 400. אין zod, אין מפתח idempotency ואין אישור כפול באף נתיב באזור הזה. `RolesGuard` מאשר כל נתיב שאין עליו `@Roles` לכל משתמש מחובר.

מסע של קלף מהדואר אל המדף, עם הטבלאות שנכתבות וגבול הטרנזקציה בכל שלב.

| שלב | נתיב וקוד | טבלאות שנכתבות | טרנזקציה |
|---|---|---|---|
| אספן מודיע שחבילה בדרך | `POST /me/parcels`, `ParcelService.register` | `parcel` במצב `expected`, `parcel_event` | אחת, בדיקת הכפילות מחוץ לה |
| החבילה מגיעה לדלפק | `POST /parcels/receive` או `receive/batch`, `ParcelService.receiveIn` | `parcel` במצב `received` או `unclaimed`, `parcel_event`, `parcel_photo`, `outbox` | אחת לחבילה, או אחת לכל הערימה |
| פותחים ובודקים | `POST /parcels/:id/open` | `parcel` במצב `opened`, תמונות, אירוע, ובנזק `outbox` | אחת |
| יוצרים פריט | `POST /intake/items` או `items/batch`, `IntakeService.intakeItem` ו `createOne` | `item`, `custody_event`, `bin_transfer`, `charge`, `ledger_record`, `item_image`, `outbox` | אחת לכל עותק, לא לכל בקשה |
| בחירת מדף | `resolveStowBin` ו `StowService.suggest` | קריאה בלבד | לפני טרנזקציית הפריט |
| שעון האחסון מתחיל | `createWithIntake` שורה 95 | `item.received_at` | ה worker סופר ממנו תקופות |
| סוגרים את החבילה | `POST /parcels/:id/process` | `parcel` במצב `processed`, `charge` של `parcel_processing`, אירוע, `outbox` | אחת, עם `FOR UPDATE` |

נקודות שבהן אותה לוגיקה חיה ב API וב worker. כל שינוי באחד מהם מחייב שינוי בשני.

| נושא | ב API | ב worker | פער ידוע היום |
|---|---|---|---|
| פרמטרי אחסון וברירות מחדל | `storage-policy.ts` | `storage-fee.ts` שורות 77 עד 112 | כשאין כלל `storage` בתוקף ה worker לא מחייב דבר והכספת מציגה ברירות מחדל. כשאין `storage_oversized`, ה worker משתמש בכלל הרגיל והכספת ב `OVERSIZED_STORAGE`. |
| סכום לתקופה | `periodChargeMinor` | `storage-fee.ts` שורה 228, `GREATEST(1, ...)` | הכספת יכולה להציג אפס, ה worker מחייב לפחות סנט. |
| מצבים שמחויבים | `nextChargeAt` רק ב `stored` | שורות 173 ו 194, `lifecycle_state = 'stored'` | ה worker לא מסנן `lot_broken`. |
| כיסוי מנוי לאחסון | `tiers.ts`, `storedItems` | שורה 143, `pricing_rule.parameters ->> 'storedItems'` | שני מקורות אמת. הכספת לא יודעת על הכיסוי בכלל. |
| מחזור חי | `isCycleLive` | `storage-fee.ts` | זהה היום. |
| חידוש מנוי | `renewDue`, קוד מת | `membership-renewal.ts`, כל שעה בדקה 40 לפי `index.ts` שורה 60 | בלי כלל מחיר ה worker משאיר פג וה API מוכר במחיר קטלוג. ה worker מתחיל מחזור מ `date_trunc('milliseconds', now())`. |

עמודות `item` שהאזור הזה קובע, ומי נשען עליהן. ההגדרה עצמה ב `cst.schema.ts`, דפוס P5.

| עמודה | נקבעת ב | נקראת ב | שים לב |
|---|---|---|---|
| `owner_id` | `createWithIntake`, `transferOwnership`, עריכת מנהל | כל הכספת, החיוב, `break-even`, `shelf-yield` | `text` ולא `uuid`, וה joins נשענים על cast מרומז. ערך לא חוקי מפיל רשימות שלמות. |
| `bin_id` | `createWithIntake`, `relocate`, עריכת מנהל | `stow`, הדוח, הכספת, `shelf-yield` | `text`. לא מתאפס לעולם כשהפריט עוזב, למרות ההערה בסכמה. |
| `lifecycle_state` | `createWithIntake`, `changeState`, עריכת מנהל | ה worker מחייב רק `stored`, הכספת לפי `LIVE` ו `TERMINAL` | ברירת המחדל בסכמה `received`, ב `createWithIntake` היא `stored`. |
| `hold_flag` | `setHold`, עריכת מנהל | `relocate`, `purchase`, `trade`, בקשות שירות, הכספת | לא נבדק ב `changeState` ו `transferOwnership`. |
| `received_at` | `createWithIntake`, `new Date()` של שרת ה API | ה worker לספירת תקופות, `break-even`, `shelf-yield` | עמודה nullable, ואין קוד שמעדכן אותה אחר כך. |
| `oversized` | מועתק מהמחלקה בקליטה | ה worker, `storageFor`, `stow` | לא נגזר מחדש, גם לא כשמתקנים מחלקה. |
| `is_lot`, `lot_size`, `lot_broken` | קליטה, `breakLot` | `listOpenLots`, הכספת | ה worker לא קורא `lot_broken`. |
| `serial_number`, `barcode` | `labels.ts` או הכתבה של מפעיל | `resolveItem`, תוויות | אינדקסים ייחודיים רגישים לרישיות, לכל עמודה בנפרד. |
| `source_parcel_id`, `source_batch_id` | קליטה ופיצול | `process` לספירת תוכן, `detailFor` | אין מפתח זר. |

מודל הנעילה באזור. רמת הבידוד היא ברירת המחדל של Postgres, `READ COMMITTED`, ולכן כל הגנה מפני מרוץ היא נעילת שורה מפורשת או `UPDATE` מותנה.

| משאב | מה מגן עליו | איפה חסר |
|---|---|---|
| שורת `item` | `lockItem` ב `CustodyService`, `FOR UPDATE` ב `correct`, `updateItem` ו `purchase` | `breakLot` קורא את הלוט בלי נעילה ומסמן `lotBroken` בסוף, מחוץ לטרנזקציה. |
| שורת `parcel` | `FOR UPDATE` ב `cancelRegistration`, `forward`, `open`, `process`, `claim`, `dispose` | `receiveIn` מחפש הרשמה בלי נעילה. `assertParcelOpenFor` בקליטה קורא בלי נעילה. |
| מספר מעקב | כלום | הבדיקה ב `register` מחוץ לטרנזקציה ובלי אינדקס ייחודי. |
| שורת `batch` | `FOR UPDATE` ב `split` | |
| שורת `membership` | `FOR UPDATE` ב `subscribe`, ו `membership_user_unique` למשתמש חדש | `cancel` בלי נעילה. |
| מונה הכללה | `UPDATE` מותנה על `membership_period` ב `consume`, `waive`, `spendShippingCover` | |
| בעלים צפוי של פריט | אין, E4 | כל קורא של `transferOwnership` אחראי בעצמו. |

נתיבים באזור שפתוחים לכל משתמש מחובר, או לגמרי ציבוריים. כל השאר דורש `warehouse_operator` או `admin`, ובקונסולה רק `admin`.

| נתיב | מי | ההגנה שנשארת |
|---|---|---|
| `/me/parcels`, `/me/parcels/:id/cancel`, `/me/inbound-addresses`, `/me/disposals` | כל מחובר | הכול מסונן לפי `user.id` מהסשן. |
| `GET /parcels/:id`, `GET /parcels/:id/photos` | כל מחובר | `detailFor` מחזיר 404 למי שאינו הבעלים. |
| `GET /parcels/workflow/status`, `GET /intake/vocabulary` | כל מחובר | מידע תפעולי וציבורי, בכוונה. |
| `/vault/*` | כל מחובר | `owner_id` מהסשן, ו `hasHeld` לציר. |
| `GET /membership/me`, `POST subscribe`, `POST cancel` | כל מחובר, כולל צוות | שורת המנוי של המשתמש בלבד. |
| `GET /membership/tiers`, `GET /content/intake-policy` | ציבורי, `@Public` | קטלוג ומדיניות בלבד. |

אירועי outbox שהאזור כותב. כולם נכתבים באותה טרנזקציה של השינוי, דפוס P3, ו `apps/worker/src/jobs/notification-events.ts` הופך אותם להודעות. העמודה האחרונה אומרת אם הם נשלחים גם במייל כברירת מחדל לפי `EMAIL_BY_DEFAULT`.

| אירוע | נכתב ב | מייל |
|---|---|---|
| `item_received` | `IntakeService.createOne` | כן |
| `hold_placed` | `CustodyService.setHold`, לא בעריכת מנהל | כן |
| `arrival_not_accepted` | `DisposalService.record` | כן |
| `parcel_received` | `receiveIn` ו `claim` | כן |
| `parcel_damaged` | `open` כשיש נזק, עם הערות המפעיל | כן |
| `parcel_processed`, `parcel_disposed` | `process`, `dispose` | כן |
| `parcel_forwarded` | `forward`, רק כשיש בעלים | לא |

בקרות שקיימות ועובדות, ואסור לשבור אותן בשינוי.

| בקרה | איפה |
|---|---|
| `FOR UPDATE` על הפריט בכל שינוי בעלות, מדף, מצב והחזקה | `custody.service.ts` שורות 33 עד 42 |
| פריט, אירוע ו `bin_transfer` באותה טרנזקציה | `custody.service.ts` שורות 76 עד 118 |
| append only בטריגר ובהרשאות, ואין מחיקת `item` | `db/sql/0001_append_only.sql` שורות 42 עד 51 ו 120 עד 122 |
| קליטה רק לחבילה פתוחה של אותו בעלים | `intake.service.ts` שורות 202 עד 221 |
| מדף מושבת או במתקן אחר נדחה בקליטה | `intake.service.ts` שורות 168 עד 181 |
| `processed` בלי יציאות ונעילה, אין חיוב עיבוד כפול | `parcel.service.ts` שורות 42 עד 58 ו 658 עד 716 |
| קבלה מרובה אטומית | `parcel.service.ts` שורות 460 עד 476 |
| נעילת אצווה מונעת פיצול כפול | `batch.service.ts` שורות 116 עד 120 |
| רשימה לבנה לתיקון ולעריכת משתמש | `correction.service.ts` שורה 10, `adm.service.ts` שורות 118 עד 130 |
| 404 ולא 403 לחבילה ולפריט של אחר | `parcel.service.ts` שורות 265 עד 286, `vault.service.ts` שורות 91 עד 129 |
| escape והחלפת תווים לא מודפסים ב PDF | `report-pdf.ts` שורות 22 עד 28 |
| חתך דוח מרשימה סגורה, סריאל מדף נמטבע | `cst.controller.ts` שורות 119 עד 142, `inventory.service.ts` שורה 224 |
| ניצול הכללה מותנה ב `WHERE` | `membership.service.ts` שורות 501 עד 521 |
| `@Roles` ברמת המחלקה | `inv.controller.ts` שורה 111, `adm.controller.ts` שורה 44 |

הכסף שהאזור מזיז, ואיפה המנוי נכנס.

| חיוב | נוצר ב | הכללת מנוי | מקור המחיר |
|---|---|---|---|
| `intake` | `createOne`, `split`, `breakLot` | `intake`, 4, 10 או 25 במחזור | כלל `intake`, אפשר לפי מחלקה |
| `intake` עם `feeActionType: 'intake_lot'` | `createOne` ללוט | נספר כ `intake` דרך `ALLOWANCE_ALIASES` | כלל `intake_lot` ונפילה ל `intake` |
| `parcel_processing` | `ParcelService.process` | 2, 5 או בלי תקרה | כלל `parcel_processing` |
| `parcel_forwarding` | `ParcelService.forward`, רק עם בעלים | ב `registry` 2, ב `trust` בלי תקרה | כלל `parcel_forwarding` |
| `membership:<tier>` | `openPeriod` ב `subscribe`, וחידוש ב worker | לא רלוונטי | כלל הדרגה או `listPriceMinor` |
| `storage`, `storage_oversized` | רק ה worker | הפריטים הוותיקים עד `storedItems` | `pricing_rule.parameters` ודמי הקליטה של הפריט |

כל החיובים כאן עוברים `BillingService.charge` בתוך הטרנזקציה של הקורא, חוץ מ `openPeriod` שכותב `charge` ו `ledger_record` בעצמו, והקוד המת `runStorageFees`.

תלויות של האזור החוצה, וכל המודולים שהן מגיעות מהם גלובליים.

| תלות | מי משתמש | למה |
|---|---|---|
| `BILLING_PORT`, מומש ב `pay/billing.service.ts` | `intake`, `batch`, `parcel` | חיובים מסוג `intake`, `parcel_processing`, `parcel_forwarding`, ו `feeActionType` מסוג `intake_lot`. `BillingService` שואל את `MembershipService.consume` לפני כל חיוב. |
| `OutboxService` מ `not` | `custody`, `intake`, `disposal`, `parcel` | אירועי ההודעה, באותה טרנזקציה. |
| `MediaService` מ `med` | `parcel` | חתימת תמונות חבילה. |
| `STORAGE_ADAPTER` מ `@bault/adapters`, דפוס P11 | `vault` | URL חתום לתמונות פריט. |
| `PricingService`, `LedgerService`, `WalletService` | `membership`, ו `adm` בקוד המת | מחיר דרגה, רישום חיוב, חסימת ארנק. |
| טבלאות `mkt`, `shp`, `adm`, `pay` | `inventory`, `break-even`, `vault`, `shelf-yield` | קריאה בלבד, לציר זמן, הכנסה והוצאה. |

שינויים נפוצים ואילו קבצים הם נוגעים.

| שינוי | מה לגעת | מה נשבר אם שוכחים |
|---|---|---|
| מחלקת פריט חדשה | `ITEM_CLASSES` ב `item-classes.ts`, ההעתק ב `apps/web/src/shared/itemClasses.ts`, וכלל תמחור לפי מחלקה אם צריך. | המדיניות מפרסמת מחלקה שהטופס לא מציע. |
| קטגוריית סירוב חדשה | `DISPOSAL_CATEGORIES` ושורה ב `REFUSAL_REASON` ב `intake-policy.ts`. | משפט ברירת מחדל גלוי ללקוח. |
| מצב מחזור חיים חדש | `LifecycleState` ו `TRANSITIONS`, מיגרציה ל enum `item_lifecycle` ב P6, `cst.schema.ts`, `TERMINAL` ו `LIVE` ב `vault.service.ts`, רשימות המצבים ב `break-even.service.ts` וב `shelf-yield.service.ts`, והסינון `lifecycle_state = 'stored'` ב `storage-fee.ts`. | פריטים נעלמים מהכספת או מחויבים בטעות. |
| פעולת משמורת חדשה | מתודה ב `CustodyService` שנועלת עם `lockItem` וכותבת `custody_event` באותו `tx`, וערך ל enum `custody_event_type` אם צריך סוג חדש. | חור בשרשרת המשמורת. |
| תנאי אחסון | `pricing_rule.parameters` של `storage` ו `storage_oversized`, נתון ולא קוד. ברירות המחדל ב `storage-policy.ts` וב `storage-fee.ts` יחד. | הכספת מציגה תנאים שלא מחויבים. |
| דרגה או הכללה | `tiers.ts`, כלל `membership:<key>` עם `parameters.storedItems`, ו `db/seed.ts`. | ה worker לא מכסה את מה שהמסך מבטיח. |
| מצב חבילה חדש | `TRANSITIONS` ב `parcel.service.ts`, מיגרציה ל `parcel_status`, הסינון ב `listQueue`, ו `assertParcelOpenFor` ב `intake.service.ts`. | קליטה מחבילה נחסמת או נפתחת בטעות. |
| נתיב צוות חדש | `@Roles` על המתודה ב `parcel.controller.ts`, `cst.controller.ts`, `disposal.controller.ts`. ב `inv.controller.ts` וב `adm.controller.ts` הוא יורש מהמחלקה. | נתיב פתוח לכל מחובר. |

הבדיקות שמכסות את האזור, דפוס P10.

| בדיקה | מה היא מוכיחה |
|---|---|
| `tests/integration/inv-intake.test.ts` | קליטה לבעלים, דחייה בלי מדף, קליטה מרובה, לוט ופירוקו, תיקון והעברה עם מקור ויעד, וחסימת לקוח. |
| `tests/integration/inv-batch-split.test.ts` | פתיחת אצווה, פיצול, וסירוב לפיצול כפול. |
| `tests3/integration/inv-stow.test.ts` | אין קיבולת, סריאל מדף נמטבע, הצעת המדף הריק ביותר, oversized למדף oversized, וסריקה. |
| `tests3/integration/receiving-bench.test.ts` | העלאת תמונות, קבלה מרובה אטומית עם שם השורה הפגומה, ודף החבילה של האספן. |
| `tests3/integration/inv-intake-policy.test.ts` | המדיניות ציבורית, מפרסמת בדיוק את המחלקות שהקליטה מקבלת, וסיבה לכל קטגוריה. |
| `tests3/integration/vlt-break-even.test.ts` | ערך רק ממקור אמיתי, הוצאה מחיובים בפועל, ורק פריטים על מדף. |
| `tests3/integration/adm-shelf-yield.test.ts` | מנהל בלבד, עמלת שוק נספרת, ייחוס לפי המדף הנוכחי, והחשבון. |
| `tests/integration/adm-pricing-storage.test.ts` | ריצות דמי אחסון לקריאה בלבד ו POST מחזיר 404, ומחלוקת רק על עסקה קיימת. |
| `tests3/integration/sec-authorization.test.ts` | רשימת `ADMIN_ONLY` נבדקת מול לקוח ומול מפעיל. |
| `tests/web/membership-tiers.test.ts` | מחיר כל דרגה מתחת לעלות `fullUseCostMinor` ולא באופן אבסורדי. |

אין כיסוי למרוצים, פירוק לוט כפול, סילוק אחרי קליטה, העברה של פריט שנשלח, מפתחות תמונה זרים, ולשירות המנוי בצד השרת.

### גרעין המשמורת, `cst`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/cst/cst.module.ts` | דפוס P1 עם `@Global` בשורה 12. מייצא `CustodyService`, `InventoryService`, `StowService`, ו `RelocateService` נשאר פנימי. הסרת `@Global` שוברת בזמן אתחול, לא בקומפילציה, את `inv`, `dis`, `mkt`, `shp`, `esc` ו `vlt`. |
| `apps/api/src/modules/cst/relocate.service.ts` | עטיפה דקה, שורות 12 עד 24, שפותחת `custody.run` סביב `relocate` ו `setHold` בשביל `cst.controller.ts`. המקום הנכון להוסיף בדיקת מצב ומדף יעד פעיל, כי זה נוגע רק לנתיב המחסן. |

#### `apps/api/src/modules/cst/lifecycle.ts`
מכונת המצבים של פריט, קובץ טהור. הצרכן הישיר היחיד הוא `CustodyService.changeState`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 21 | `LifecycleState`, עשרה מצבים, `received`, `stored`, `listed`, `on-hold`, `sold`, `shipped`, `donated`, `consigned`, `at_grader`, `discarded`. | חייב להתאים ל enum `item_lifecycle` ב `cst.schema.ts` שורות 22 עד 49. ההתאמה לא נאכפת, `custody.service.ts` עושה cast. ערך שקיים רק במסד יגרום ל `TypeError` ו 500. |
| 23 עד 39 | `TRANSITIONS`, רשימת שכנות מסוג `Record`, ולכן המהדר מחייב שורה לכל מצב. `shipped`, `donated`, `consigned`, `discarded` בלי יציאות. `at_grader` חוזר ל `stored`, או ל `discarded` כשהמדרג מדווח על אובדן. `sold` ממשיך ל `stored` או `shipped`. | `on-hold` לא נכנס לעולם. החזקה היא הדגל `item.hold_flag`, ושלוש הקשתות של `on-hold` הן קוד מת. מכירה בשוק עוברת `listed` ל `stored` עם העברת בעלים, `sold` משמש רק ב `buyout.service.ts`. |
| 41 עד 51 | `assertTransition`. מצב זהה מחזיר בשקט, מעבר לא ברשימה זורק 409 `CONFLICT` עם `from` ו `to`. | ההחזרה השקטה גורמת ל `changeState` לכתוב `state_change` שבו המצב הקודם שווה לחדש. `grading.service.ts` נשען עליה. |

מי מבצע כל מעבר בפועל, לפי כל הקריאות ל `changeState`.

| מעבר | קורא |
|---|---|
| `stored` ל `listed`, ו `listed` ל `stored` | `mkt/listing.service.ts` שורות 38 ו 76, ומכירה ב `mkt/purchase.service.ts` שורה 146 |
| `received` ל `stored` | `mkt/house-store.service.ts` שורה 324 |
| `stored` ל `sold` | `dis/buyout.service.ts` שורה 148 |
| `stored` ל `shipped` | `shp/dispatch.service.ts` שורה 77, `shp/human-fulfilment.service.ts` שורה 457 |
| `stored` ל `donated` או `discarded` | `dis/donation.service.ts` שורה 54, `dis/disposal-services.service.ts` שורות 192 ו 194 |
| `stored` ל `consigned` | `dis/consignment.service.ts` שורה 201 |
| `stored` ל `at_grader` וחזרה | `dis/grading.service.ts` שורות 277 ו 339 |
| כל מעבר, בלי בדיקה | `adm/adm.service.ts` שורות 211 עד 215 |

**שים לב.** זה אינווריאנט של שירות ולא של המסד. `adm.service.ts` מעדכן `lifecycleState` ישירות ועוקף את המכונה. מצב חדש דורש מיגרציה ל enum ועדכון של `storage-fee.ts` ושל כל סינון לפי מצב ב `vlt`, `mkt`, `shp`.

#### `apps/api/src/modules/cst/custody.service.ts`
גרעין הנכונות של המערכת ואתר הממצא E4. כל שינוי של בעלים, מדף או מצב עובר כאן וכותב `custody_event` באותה טרנזקציה. כל מתודה מקבלת `tx` ולא פותחת טרנזקציה, כדי שהקורא יחבר אותה עם חיוב ו outbox ל commit אחד. זה הצד של `CustodyService` בדפוס P3. קוראים מתוך האזור, `intake`, `batch`, `relocate`, ומבחוץ `dis`, `esc`, `mkt`, `shp`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 | `type Tx = Database`. | המהדר לא יתפוס קורא שמעביר `this.db` במקום `tx`. אז הכתיבה יוצאת מטרנזקציית הקורא והנעילה משתחררת מיד. |
| 33 עד 42 | `lockItem`, `SELECT ... FOR UPDATE` על השורה, 404 אם אין. | ב `READ COMMITTED` הטרנזקציה השנייה מחכה וקוראת את מה שהראשונה כתבה. זה מה שהופך את `prevOwnerId`, `prevBinId`, `prevState` באירוע לאמיתיים. |
| 45 עד 74 | `createWithIntake`, הקלט. בעלים, סריאל, ברקוד, מחלקה, מדף, `sourceBatchId`, `sourceParcelId`, `oversized`, `weightGrams`, לוט, `eventType` שהוא `intake` או `batch_split`, ו `lifecycleState` שהוא `stored` או `received`. | `received` משמש רק לקלף שנמכר מחנות Bault, בבעלות מרגע התשלום ועוד לא על מדף. |
| 76 עד 120 | מכניס `item` עם ברירות מחדל, מצב `stored`, `lotSize` 1, `oversized` false, `weightGrams` רק אם חיובי. אחר כך אירוע עם `newOwnerId`, `newBinId`, `newState`, ואם יש מדף שורת `bin_transfer` ראשונה עם `fromBinId` ריק. | `receivedAt` בשורה 95 הוא השעון שממנו ה worker סופר תקופות אחסון. `oversized` מועתק כאן ולא נגזר מחדש לעולם. אין בדיקה שהמדף או הבעלים קיימים או פעילים, ואין מפתח זר. |
| 123 עד 144 | `relocate`. נעילה, `ITEM_ON_HOLD` 409 לפריט מוחזק, עדכון `binId`, אירוע `relocate` ושורת `bin_transfer` עם מקור ויעד. | אין בדיקת מצב, אפשר להעביר פריט `shipped` או `at_grader` למדף. אין בדיקה שהיעד פעיל או שונה מהנוכחי. `reason` קבוע `scan relocate`. בדיקת מצב עתידית חייבת להתיר `received`, כי `house-store.service.ts` מעביר כך פריט שנמכר מהחנות. |
| 147 עד 158 | `transferOwnership`. נעילה, עדכון `ownerId`, אירוע `ownership_transfer`. | **E4, P0.** זה P0 כי מדובר ברכוש של לקוח ובכסף שזז איתו. מקבל רק את הבעלים החדש. לא משווה את `current.ownerId` לבעלים שהקורא ציפה לו, לא בודק מצב ולא `holdFlag`. שמונה קריאות בשבעה קבצים, `donation`, `disposal-services`, `buyout`, `consignment`, `escrow`, `purchase`, ושתיים ב `trade`, וכל אחת בודקת בעלות בעצמה, חלקן לפני הנעילה. כך אפשר להעביר פריט שכבר עבר ידיים. התיקון, פרמטר `expectedOwnerId` ובדיקת בעלים, מצב ו hold תחת הנעילה, ואז אחת עשרה בדיקות מפוזרות הופכות לאחת. |
| 161 עד 173 | `changeState`. נעילה, `assertTransition`, עדכון, אירוע `state_change`. | אין בדיקת `holdFlag`, ו `shp/dispatch.service.ts` לא בודק אותו, כך שהחזקה שהונחה אחרי יצירת משלוח לא עוצרת שליחה. יציאה מהמחסן לא מאפסת `binId`, ושום קוד לא מאפס אותו. |
| 186 עד 207 | `setHold`. מחזיר `false` בלי כתיבה אם הדגל כבר בערך המבוקש. אחרת עדכון, אירוע `hold_placed` או `hold_released`, ובהנחה בלבד אירוע `hold_placed` ב outbox. | זו האידמפוטנטיות של נתיבי ההחזקה. לא עובר דרך `assertTransition` כי המצב לא משתנה. |
| 210 עד 212 | `run`, `this.db.transaction(work)` למי שאין לו טרנזקציה משלו. Drizzle עושה `COMMIT` כשה Promise מצליח ו `ROLLBACK` כשהוא נדחה. | `IntakeService` ו `RelocateService` נשענים עליו, ולכן כל קריאה אליו היא commit נפרד. |

מה כל קורא של `transferOwnership` בודק בעצמו, וזו המפה של E4.

| קורא | מה נבדק ומתי | הפער |
|---|---|---|
| `dis/donation.service.ts` שורה 53 | בעלים, `holdFlag` ומצב `stored` נבדקים ב `request`, לפני אסימון האישור. | `confirm` מעביר בלי בדיקה חוזרת. אם הפריט עבר ידיים בין שני השלבים, הבעלים הקודם תורם את הקלף של הבעלים החדש, ו `changeState` ל `donated` עובר כי המצב `stored`. |
| `dis/disposal-services.service.ts` שורה 191 | אותו מבנה ב `requestCull` ו `confirmCull`. | אותו פער. |
| `dis/buyout.service.ts` שורה 147 | בודק שהמבקש הוא בעל הבקשה, לא שהוא עדיין הבעלים. | |
| `dis/consignment.service.ts` שורה 200 | בעלים מתוך `requesterId` של הבקשה. | |
| `esc/escrow.service.ts` שורה 612 | אין בדיקת בעלים או `holdFlag` סביב הקריאה. | הנאמנות יכולה להעביר פריט מוחזק או שכבר עבר ידיים. |
| `mkt/purchase.service.ts` שורה 145 | `FOR UPDATE` על המודעה ועל הפריט ובדיקת `holdFlag`. | לא בודק שבעל הפריט הוא המוכר במודעה, ראו עריכת מנהל. |
| `mkt/trade.service.ts` שורות 109 ו 112 | נעילה על ההצעה. | |

קורא חדש צריך לנעול, לבדוק בעלים צפוי, מצב ו `holdFlag` תחת הנעילה, ואז לקרוא לגרעין עם אותו `tx`. עד שהבדיקה תעבור לגרעין עצמו, זו אחריות של כל קורא.

הצורה המוצעת לתיקון E4, כך שהבדיקה יושבת תחת הנעילה בגרעין.

```ts
async transferOwnership(tx: Tx, itemId: string, newOwnerId: string, actorId: string, reason: string,
  expect: { ownerId: string; states?: LifecycleState[]; allowHold?: boolean }) {
  const current = await this.lockItem(tx, itemId);
  if (current.ownerId !== expect.ownerId) throw AppError.conflict(ErrorCode.CONFLICT, 'Item changed hands');
  if (!expect.allowHold && current.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);
  // ...existing update + custody_event
}
```

**שים לב.** ההגנה החזקה יושבת במסד. `custody_event`, `bin_transfer`, `parcel_event`, `arrival_disposal` הם append only בטריגר ובביטול הרשאות ב `apps/api/src/db/sql/0001_append_only.sql` שורות 42 עד 51, ו `item` מוגן ממחיקה בטריגר `trg_no_delete_item`. ההערה בשורות 17 עד 18 שאף קוד אחר לא מעדכן את העמודות שגויה, `adm.service.ts` עושה זאת ולא כותב `bin_transfer`. הוספת בדיקת `holdFlag` ל `changeState` או `transferOwnership` משנה כל קורא, בדקו במיוחד את `grading.service.ts` ואת עריכת המנהל.

#### `apps/api/src/modules/cst/stow.service.ts`
קליטה מכוונת, איזה מדף לבחור, ותרגום של פלט סורק לשורת מדף או פריט. קורא בלבד, `bin`, `item`, `facility`. משמש את הקליטה, האצוות, `inventory.service.ts` ו `cst.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 31 | `StowTarget` וביטוי `UUID`. | השוואה של מחרוזת שאינה UUID לעמודת `uuid` זורקת, ולכן ההשוואה על המזהה מושמטת כשאין התאמה לתבנית. |
| 67 עד 86 | `resolveBin`. `OR` של `upper(barcode)`, `upper(serial)`, ו UUID אם בצורה הזו, `limit(1)`, 400 אם אין. | הקלט עובר כפרמטר, אין הזרקת SQL. אין אינדקס על `upper`, סריקה מלאה, זניח כי יש מעט מדפים. |
| 95 עד 111 | `resolveItem`, אותו דבר לפריט. | סריקה מלאה של `item`. השוואה בלי רישיות על שתי עמודות עם `limit(1)` בלי `ORDER BY`, מול אינדקסים ייחודיים רגישים לרישיות ונפרדים. סריאל או ברקוד שמפעיל הכתיב בקליטה יכולים להתנגש, ואז העברת מדף מזיזה פריט שרירותי. |
| 122 עד 146 | `listWithCounts`. ספירת פריטים לכל `binId`, `leftJoin` למדפים ומתקנים. | בלי סינון מצב. מאחר ש `binId` לא מתאפס, פריטים שנשלחו או נתרמו ולוטים שפורקו נספרים, ומדפים ותיקים נראים מלאים. |
| 157 עד 193 | `listStowable` מסנן בזיכרון לפי פעיל, oversized מדויק ומתקן, וממיין לפי ספירה ואז ברקוד. `suggest` לוקח את הראשון או 400 שמבחין בין חוסר oversized לרגיל. | אין קיבולת, רק פיזור לפי ספירה, מנומק במיגרציה `0018_stow_wherever_it_fits.sql`. לכן מרוץ בין שני מפעילים על אותו מדף אינו בעיה. |
| 196 עד 206 | `facilityIdByCode`, קוד בלי רישיות, `null` לריק, 400 אם לא נמצא. | `ParcelService.facilityByCode` משווה עם רישיות, אותו קוד יכול לעבוד במסך אחד ולהיכשל באחר. |

**שים לב.** סינון מצב בספירה ישנה את המדף המוצע ואת `inv-stow.test.ts`. אינדקס ייחודי על `upper(barcode)` ב `item` דורש מיגרציה ובדיקה שאין כבר התנגשויות. הסרת ההשוואה על `serialNumber` ב `resolveItem` תשבור מפעילים שמקלידים סריאל בעין.

### קליטה, `inv`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/inv/inv.module.ts` | דפוס P1, שורות 21 עד 32. שלושה controllers ושישה שירותים, בלי `exports`. לכן `dis.module.ts` רושם עותק משלו של `IntakeService`, שני מופעים בתהליך. נשען על כך ש `CstModule`, `PayModule`, `NotModule`, `MedModule` גלובליים. |
| `apps/api/src/modules/inv/labels.ts` | מייצר מחרוזות ברקוד. `makeItemSerial` בשורות 12 עד 17 הוא `SN-` עם זמן בבסיס 36 ומספר אקראי, רק 8999 ערכים במילישנייה ובלי ניסיון חוזר על התנגשות. `makeLotSerial` עם `LOT-`. `makeBinSerial` בשורות 49 עד 51 הוא `BIN-` ושמונה תווים אקראיים. הברקוד תמיד שווה לסריאל, ו `stow.service.ts` מחפש בשתי העמודות. |

#### `apps/api/src/modules/inv/item-classes.ts`
אוצר המילים הסגור. אילו סוגי פריטים מתקבלים, וקטגוריות הסירוב ותוצאות הסילוק. קובץ טהור שמיובא מ `inv`, `adm`, `mkt/house-store.service.ts`, `shp/parcel-profile.service.ts` ו `shp/boxes.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 65 | `ItemClass`, `key`, `label`, `oversized`, `lotEligible`, `lotMinSize`, `typicalWeightGrams`. | `key` נכתב ל `item.type_class` וכללי תמחור לפי מחלקה מפנים אליו. שינוי `key` קיים שובר פריטים, כללים וה SPA. |
| 76 | `LOT_MIN_SIZE` שווה 6. | פחות מזה של קלפים נקלט כפריטים בודדים, כל אחד עם חיוב קליטה. |
| 86 עד 109 | `ITEM_CLASSES`, שתים עשרה מחלקות, `trading_card`, `graded_slab`, `oversized_card`, `sealed_pack`, `sealed_box`, `sealed_case`, `collection_box`, `comic_raw`, `comic_graded`, `memorabilia`, `small_collectible`, `other`. שלוש oversized שאינן lot eligible, ורק `trading_card` ו `graded_slab` עם `lotMinSize`. מפה `BY_KEY` ושני accessors. | הקוראים בודקים `isKnownItemClass` ואז `itemClass(...)!`. שינוי `oversized` לא משפיע על פריטים קיימים. |
| 117 עד 140 | `qualifiesAsLot`, ו `itemWeightGrams`. משקל שנשקל גובר, אחרת משקל טיפוסי או 400 גרם, כפול גודל לוט. | משמש הצעות מחיר של מוביל ב `parcel-profile.service.ts`. |
| 158 עד 203 | `DISPOSAL_CATEGORIES`, תשע, שמונה אסורות, `gps_tracker`, `lithium_battery`, `liquid_or_glass`, `flammable`, `medical`, `cosmetics`, `adult_material`, `other_prohibited`, ו `no_value` שהוא שיקול דעת. `DISPOSAL_OUTCOMES` הוא tuple עם `as const`, ו `isKnownDisposalOutcome` הוא type guard. | |

**שים לב.** ה SPA מחזיק העתק לפי ערך ב `apps/web/src/shared/itemClasses.ts`. מחלקה חדשה בלי עדכון שם תפורסם במדיניות אבל לא תופיע בטופס הקליטה.

#### `apps/api/src/modules/inv/intake-policy.ts`
מדיניות הקליטה הציבורית, נגזרת מ `item-classes.ts` כך שהדף והוולידטור קוראים את אותו מערך. הצרכן היחיד הוא `not/content.controller.ts` בנתיב הציבורי `/content/intake-policy`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 34 עד 64 | הטיפוסים `AcceptedClassPolicy`, `RefusedCategoryPolicy`, `IntakePolicy`. | שינוי הצורה שובר את דף המדיניות ב `apps/web`. |
| 75 עד 90 | `REFUSAL_REASON`, משפט לאספן לכל קטגוריה. | קטגוריה בלי משפט מקבלת `No published reason for this category yet.` |
| 96 עד 138 | `RULES`, שבעה כללים בפרוזה, `closed-list`, `trackers`, `refusal-record`, `unattributable`, `condition`, `lots`, `oversized`. כל אחד נשען על קוד, `isKnownItemClass`, `DisposalService.record`, המצב `unclaimed` ב `receiveIn`, ההערות החובה ב `open`, ו `oversized` שמועתק ב `createWithIntake`. `lots` משתמש ב `LOT_MIN_SIZE` בתוך template. | כל כלל מתאר התנהגות בקוד, אבל שום בדיקה לא תתפוס פרוזה שהתיישנה. `trackers` מתאר מדיניות שהקוד לא אוכף. |
| 147 עד 169 | `intakePolicy` ממפה הכול לאובייקט אחד בכל בקשה, בלי cache. | |

**שים לב.** `tests3/integration/inv-intake-policy.test.ts` בודק שהמחלקות שמתפרסמות הן בדיוק המחלקות שהקליטה מקבלת, ושלכל קטגוריה יש סיבה. לפני הוספת קטגוריה בלי משפט בדקו אם הבדיקה מקבלת את משפט ברירת המחדל.

#### `apps/api/src/modules/inv/facility.service.ts`
מתקנים הם הכתובות שבהן Bault מקבלת דואר. הצרכן היחיד הוא `parcel.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 19 עד 36 | `InboundAddress`, מזהה, קוד, שם ותפקיד המתקן, `careOf`, שורות הכתובת, עיר, אזור, מיקוד, מדינה, טלפון, `salesTaxBps` ו `forwardingDays`. | `salesTaxBps` מידע מנחה בלבד. |
| 42 עד 50 | `listActive`, מתקנים פעילים לפי `role` ואז `code`. | מיון enum ב Postgres לפי סדר ההצהרה, ולכן `primary` ראשון. שינוי סדר ה enum ישנה את סדר הכתובות. |
| 52 עד 62 | `byCode`, `byId`. | לא בשימוש. |
| 64 עד 87 | `isPlaceholder`, מזהה כתובות seed עם `placeholder` או `SET REAL ADDRESS`. | ההערה בשורות 64 עד 71 שייכת ל `inboundAddressesFor`. |
| 89 עד 116 | `inboundAddressesFor`. שם המשתמש נקרא מהחשבון לפי מזהה הסשן, בייצור מסוננות כתובות placeholder, ונבנית שורת `Bault C/O <username>`. | זו כל הדרך שבה חבילה מוצאת חשבון. שינוי התבנית שובר תוויות שכבר הודפסו אצל מוכרים. `loadEnv()` נקרא בכל בקשה. |

**שים לב.** `careOf` נגזר ולא נשמר, ושם המשתמש מוגן בטריגר `user_account_username_immutable`, ולכן הכתובת יציבה. מתקן שלא הוגדר מוסתר בייצור במקום לזרוק, כדי שלא יחסום את כולם.

#### `apps/api/src/modules/inv/parcel.service.ts`
הדלפק. כל מה שקורה לקופסה מההודעה שהיא בדרך ועד שנסגרה. שני עקרונות. חבילה בלי בעלים מזוהה היא מצב, `unclaimed`, לא שגיאה. כסף זז רק ב `process`, פעם אחת, ובמקרה משני ב `forward`. מתודות המחסן הן דפוס P3 בלי `CustodyService`, הנעילה היא `FOR UPDATE` על `parcel`, והחיוב דרך `BILLING_PORT`. כותב `parcel`, `parcel_event` שהוא append only, `parcel_photo` ו `outbox`, ובעקיפין `charge` ו `ledger_record`. קורא `user_account`, `facility` ו `item`. `MediaService` מוזרק לחתימת תמונות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 58 | `ParcelStatus`, `TRANSITIONS` ו `assertTransition`. שישה מצבים, `expected`, `received`, `unclaimed`, `opened`, `processed`, `disposed`. | בניגוד ל `lifecycle.ts`, מעבר לאותו מצב זורק 409. הדיאגרמה בהערה בשורות 32 עד 37 שגויה, המקור הוא האובייקט בשורות 42 עד 49. `received` ל `unclaimed` מוצהר ואין קוד שמבצע אותו. |
| 60 עד 90 | `RegisterParcelInput`, `ReceiveParcelInput`, `OpenParcelInput`. | `addressedTo` הוא הטקסט הגולמי מהתווית. |
| 124 עד 147 | `writeEvent`, שורת `parcel_event` עם שדות אופציונליים כ `null`. | `eventType` טקסט חופשי, הרשימה המותרת קיימת רק בהערה ב `parcel.schema.ts`. |
| 149 עד 160 | `load` בלי נעילה, ו `facilityByCode` עם 400 על קוד לא מוכר או לא פעיל. | השוואת קוד רגישה לרישיות. |
| 174 עד 182 | `register`, צד האספן. מתקן פעיל לפי קוד, ושם המשתמש נקרא מהחשבון לפי מזהה הסשן. | |
| 184 עד 206 | בדיקת כפילות של מספר מעקב בין חבילות במצבים `expected`, `received`, `opened`. | גלובלית ולא לפי משתמש, ומחזירה 409 עם קוד החבילה של משתמש אחר. כל מי שיודע מספר מעקב, למשל המוכר, יכול לרשום אותו ראשון ולחסום את הקונה. ההשוואה מדויקת, רגישה לרישיות ולרווחים. |
| 208 עד 235 | טרנזקציה, `parcel` במצב `expected` עם קוד `PKG-`, `ownerId` של המשתמש ו `addressedTo` כשם המשתמש, ואירוע `registered` בלי `actorId`. | הבדיקה מחוץ לטרנזקציה ובלי אינדקס ייחודי, לחיצה כפולה יוצרת שתי הרשמות. `expectedAt` לא חוקי הופך ל `Invalid Date` ו 500. |
| 238 עד 262 | `listMine`, החבילות של המשתמש עם שם מתקן. | בלי `notes` ומזהי עובדים. |
| 265 עד 286 | `detailFor`, חבילה, אירועים ופריטים שנוצרו ממנה. לקוח שאינו הבעלים מקבל 404. | זה ה guard נגד IDOR, והוא עובד. אבל ללקוח עצמו חוזרת השורה המלאה, כולל `notes` פנימיות, `receivedBy`, `openedBy`, ואירועים עם `actorId`. |
| 294 עד 315 | `cancelRegistration`. `FOR UPDATE`, בעלים ומצב `expected` בלבד, מעבר ל `disposed` עם `registration_cancelled`. | אין outbox, המשתמש עשה זאת בעצמו. |
| 334 עד 336 | `receive` עוטף את `receiveIn` בטרנזקציה. | |
| 347 עד 370 | `receiveIn`, לב הדלפק, רץ בטרנזקציה של הקורא. מתקן לפי קוד, שם מנורמל מהתווית ובעלים לפיו או `null` בלי שגיאה. חיפוש הרשמה `expected` לפי מספר מעקב בלבד. | החיפוש בלי נעילה ובלי סינון מתקן או בעלים, ועם כמה הרשמות `limit(1)` בוחר שרירותית. |
| 372 עד 409 | אימוץ הרשמה. המצב הבא `received` אם יש בעלים מהתווית או מההרשמה, אחרת `unclaimed`. עדכון ההרשמה למצב, מתקן, זמן ומפעיל, ובעלים `ownerId ?? existing.ownerId`. תמונות `arrival` והודעת `parcel_received`. | מספר מעקב הוא אסימון בעלות. תווית של ב מעבירה בשקט את ההרשמה של א, כולל `declaredContents`, בלי אירוע. תווית ריקה או שגויה מוסרת את החבילה למי שרשם ראשון את המספר. `addressedTo` מקבל כאן את השם המנורמל. הערך המוחזר הוא השורה הישנה עם כמה שדות, ו `ownerId` בו עשוי להיות הישן. |
| 411 עד 445 | חבילה חדשה. קוד `PKG-`, `ownerId` אולי `null`, הטקסט הגולמי מהתווית, אירוע `received` שב `unclaimed` שומר את התווית שלא זוהתה, תמונות והודעה. | `notifyOwner` מדלג כשאין בעלים. הבלוק `{ ... }` בשורות 375 עד 444 הוא שארית refactor. |
| 460 עד 476 | `receiveMany`, טרנזקציה אחת לערימה של עד 50, שגיאה נעטפת עם המיקום וגורמת ל rollback של הכול. | זה הנתיב האטומי הנכון, הדפוס שחסר ב `IntakeService`. |
| 485 עד 507 | `attachPhotos` מכניס `parcel_photo` לכל מפתח. `photos` חותם את כולם דרך `media.signAll`. | המפתח מחרוזת חופשית מה DTO. ההערה שהמפתחות עברו ב `MediaService` שגויה, ומפעיל יכול לשייך כל אובייקט בדלי שיוחתם ללקוח. |
| 516 עד 551 | `forward`, הבדיקות. `FOR UPDATE`, מצב `received` או `unclaimed`, `forwardedAt` ריק, מתקן נוכחי `forwarding` עם יעד מוגדר, ואז חיוב `parcel_forwarding` רק אם יש בעלים. | השדה `itemId` בחיוב הוא בפועל `reference_id` של החבילה. חבילה שהועברה כ `unclaimed` ונתבעה אחר כך לא תחויב לעולם, בכוונה לפי ההערה. |
| 552 עד 580 | עדכון `facilityId` ושדות ההעברה בלבד, אירוע `forwarded` עם מצב זהה בשני הצדדים, והודעת `parcel_forwarded` רק אם יש בעלים. | אינו מעבר מצב, ולכן לא עובר ב `assertTransition`. |
| 589 עד 639 | `open`. הערות חובה לפני הטרנזקציה, `FOR UPDATE`, מעבר ל `opened`, 409 אם אין בעלים, ולכן חבילה `unclaimed` חייבת `claim` קודם. שומר `condition` שהוא `sound`, `packaging_damaged` או `contents_damaged`, תמונות `condition`, ובנזק `parcel_damaged` ל outbox. | הערות המפעיל יוצאות במייל כפי שהן, התבנית ב worker חייבת escaping. |
| 658 עד 678 | `process`, החלק הבודק. `FOR UPDATE`, מעבר ל `processed` שמותר רק מ `opened`, בעלים חובה, ספירת פריטים לפי `sourceParcelId`, ו 409 אם אין פריטים ואין `emptyReason`. | זו בדיקת ההתאמה בין קופסה לתוכן. `IntakeService.assertParcelOpenFor` קורא בלי נעילה, ולכן פריט שנקלט ברגע הסגירה נרשם לחבילה סגורה ו `itemCount` נמוך מהאמת. |
| 681 עד 716 | חיוב `parcel_processing`, מצב `processed` עם `processedAt` ו `charges` כ JSON, אירוע `processed` והודעה עם מספר הפריטים. | חיוב כפול נמנע כי ל `processed` אין יציאות ובזכות הנעילה. `charges.forwarding` נגזר מ `forwardedAt` גם כשההעברה לא חויבה. |
| 723 עד 766 | `claim`. `FOR UPDATE`, `unclaimed` בלבד, בעלים לפי שם מנורמל, הודעה לבעלים החדש. | מחליף את `addressedTo`, כך שהטקסט המקורי נשמר רק באירוע `received`. אין בדיקה שהחשבון פעיל. |
| 769 עד 798 | `dispose`. סיבה חובה, `FOR UPDATE`, מעבר ל `disposed` מכל מצב פתוח, אירוע והודעה. | חבילה `opened` שכבר נקלטו ממנה פריטים מסולקת בלי בדיקה. עמלת העיבוד לא נגבית, והפריטים נשארים עם `sourceParcelId` של חבילה מסולקת. לא כותב `arrival_disposal`. |
| 812 עד 845 | `listQueue`, תור המחסן. תת שאילתה סופרת פריטים לפי `sourceParcelId`, `leftJoin` לבעלים, מתקן ותת השאילתה, ארבעת המצבים הפתוחים, `receivedAt` עולה עם `nulls last` ואז יצירה יורדת. | אין עימוד. ה `sql` עם `${parcel.receivedAt}` מכניס מזהה עמודה ולא ערך, אין סיכון הזרקה. |
| 855 עד 881 | `workflow`, ספירה לפי מצב וגיל הוותיקה בשעות. | פתוח לכל משתמש מחובר, בכוונה. |
| 884 עד 903 | `listRetentionDue`, חבילות `unclaimed` מעבר לחלון שמירה. | לא נקרא מאף route או job, אין בפועל מדיניות שמירה. |
| 907 עד 924 | `notifyOwner`, outbox עם `aggregateType: 'parcel'`, או כלום בלי בעלים. | |

**שים לב.** אינדקס ייחודי חלקי על `tracking_number` במצב `expected` דורש מיגרציה, וייחסם אם יש היום כפילויות. שינוי צורת `detailFor` ישבור את דף החבילה ב `apps/web` ואת `receiving-bench.test.ts`. `IntakeService.assertParcelOpenFor` תלוי במצב `opened` ובעמודות `ownerId` ו `facilityId`, ושינוי שלהם כאן שובר את הקליטה.

#### `apps/api/src/modules/inv/parcel.controller.ts`
דפוס P2 שחושף את `ParcelService` ואת `FacilityService`. `@Controller()` בלי קידומת ו `@Roles` לכל מתודה, כי חצי מהנתיבים של האספן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 90 | DTOs. `RegisterParcelDto` עם ספק, מספר מעקב, תכולה ו `expectedAt`, `ReceiveParcelDto` עם `addressedTo` עד 64 תווים ו `MAX_PHOTOS` 6, `ReceiveManyDto` עד 50 עם `ValidateNested` ו `@Type`, `OpenParcelDto` עם `IsIn` על שלושה מצבים והערות עד 1000, `ProcessParcelDto` עם `emptyReason` אופציונלי, `ClaimParcelDto`, `DisposeParcelDto`. | `expectedAt` רק `IsString`. מפתחות תמונה בלי אורך ובלי תבנית. בלי `@Type` הבדיקה המקוננת לא רצה. |
| 112 עד 130 | `GET` ו `POST /me/parcels`, `POST /me/parcels/:id/cancel`, `GET /me/inbound-addresses`. כל משתמש מחובר, `user.id` מהסשן. | |
| 137 עד 151 | `GET /parcels/:id` עם דגל צוות לפי תפקיד, ו `GET /parcels/workflow/status` לכל מחובר. | בעלות נבדקת בשירות. |
| 155 עד 178 | `GET /parcels`, `POST /parcels/receive`, `POST /parcels/receive/batch`, צוות. | סדר ההצהרה חשוב לנתיבי `POST` בני שלושה מקטעים. |
| 187 עד 192 | `GET /parcels/:id/photos`, בלי `@Roles`. קורא ל `detailFor` רק להרשאה ואז ל `photos`. | שלוש שאילתות מיותרות. `@Roles` כאן ישבור את דף החבילה של האספן. |
| 194 עד 226 | `forward`, `open`, `process`, `claim`, `dispose`, צוות. | אין הגבלה למתקן של המפעיל. |

**שים לב.** נתיב מחסן חדש כאן בלי `@Roles` נפתח בשקט לכל משתמש מחובר.

#### `apps/api/src/modules/inv/intake.service.ts`
כאן קלף הופך לרשומה. נולד `item` עם בעלים, מדף, סריאל, ברקוד, חיוב קליטה, תמונות והודעה לאספן. השירות מתזמר ולא כותב בעצמו בעלות, מדף או מצב. הוא מבקש מ `CustodyService.createWithIntake` ומוסיף באותה טרנזקציה חיוב דרך `BillingPort`, שורות `item_image` ואירוע `item_received`. זה דפוס P3 עם הבדל מהותי, הטרנזקציה היא לכל פריט ולא לכל בקשה. הקוראים הם `inv.controller.ts` ו `dis/lot-split.service.ts`, שקורא ל `breakLot` אחרי שבקשת שירות אושרה. כותב `item`, `custody_event`, `bin_transfer`, `item_image`, `outbox`, ובעקיפין `charge`, `ledger_record` ומכסת המנוי. קורא `user_account`, `parcel` ו `bin`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 85 | `IntakeItemInput`, החוזה הפנימי. `ownerUsername` או `ownerIntakeId` ישן של תוויות `OW-`, `binId` שמקבל גם ברקוד, `autoStow`, `quantity` לעותקים זהים, `isLot` ו `lotSize` לרשומה אחת שמייצגת רבים, `parcelId`, `photoKeys`. | `weightGrams` נשאר `null` אם לא נשקל, משקל מנוחש גרוע ממשקל חסר. |
| 95 עד 103 | הבנאי. `db` ו `billing` לפי token, `custody`, `stow`, `outbox` לפי מחלקה. | עובד רק כי `CstModule` ו `NotModule` גלובליים. |
| 117 עד 141 | `resolveOwner`. שם משתמש מנורמל, אחרת `intakeId` אחרי `trim`, אחרת 400. 404 אם לא נמצא. | לא בודק `user_account.status`. אפשר לקלוט, לחייב ולהודיע לחשבון `suspended` או `closed`, למרות שההערה בשורות 272 עד 275 טוענת אחרת. |
| 160 עד 181 | `resolveStowBin`, מדף שנסרק או נקרא בשמו מנצח. `stow.resolveBin` מתרגם ברקוד, סריאל או UUID. מדף לא פעיל נדחה, ובקליטה מחבילה שאילתה נוספת על `bin.facilityId` דוחה מדף במבנה אחר. | התנאי `row?.facilityId &&` מעביר בשקט מדף ישן בלי מתקן. אין בדיקה שסוג המדף מתאים ל oversized, בכוונה לפי ההערה בשורות 153 עד 158. |
| 183 עד 192 | בלי מדף ועם `autoStow`, `stow.suggest` עם oversized ומתקן החבילה. בלי שניהם 400. | `suggest` כבר מסנן לא פעילים ומתאים סוג. |
| 202 עד 221 | `assertParcelOpenFor`. החבילה קיימת, שייכת לאותו בעלים ובמצב `opened`. מחזיר את השורה בשביל `facilityId`. | זו ההגנה מפני שיוך פריט לחבילה של לקוח אחר. היא קוראת בלי נעילה, ולכן מתחרה ב `ParcelService.process`. |
| 223 עד 252 | שתי הערות JSDoc צמודות. | הראשונה שייכת ל `intakeItem` ונדחקה מעל `intakeUnits`. |
| 253 עד 299 | `intakeUnits`, עד 50 יחידות שונות מאותה קופסה. בדיקה מקדימה של כל יחידה עם `assertReceivable` והודעה עם מספר היחידה, ואז `intakeItem` לכל יחידה. | כל יחידה וכל עותק הם טרנזקציה נפרדת. ההבטחה של הכל או כלום לא מתקיימת לטעויות מדף. |
| 309 עד 319 | `assertReceivable`, אותן בדיקות כמו תחילת `intakeItem` בלי כתיבה. | חסרה קריאה ל `resolveStowBin`. ברקוד מדף שגוי ביחידה החמישית מתגלה אחרי שארבע נכתבו וחויבו, וניסיון חוזר קולט אותן שוב. |
| 321 עד 343 | `intakeItem`, ההכנה. מחלקה מוכרת או 400, בעלים, חבילה פתוחה של אותו בעלים, מדף אחד לכל הקריאה עם דגל oversized ומתקן החבילה, ונרמול `quantity` ל 1 עד 100 ו `lotSize` לפחות 1. | 100 עותקים הולכים לאותו מדף גם ב `autoStow`. |
| 345 עד 386 | כלל הלוט ולולאה. לוט למחלקה שאינה `lotEligible` נדחה ב 400, ולוט מתחת לסף מומר ל `lotSize` פריטים בודדים. `effective` מחליף `binId` במזהה שנפתר, ואז `createOne` בלולאה. | `quantity` שנשלח עם לוט קטן מתעלם. `quantity: 1` מפורש מבטל את הסריאל המוכתב. הערך המוחזר הוא פריט או מערך, וכל צרכן צריך לטפל בשתי הצורות. כישלון בעותק השביעי משאיר שישה פריטים מחויבים. |
| 388 עד 397 | בחירת סריאל וברקוד ב `createOne`. מוכתב רק כש `quantity` הוא `undefined`, אחרת `makeItemSerial` או `makeLotSerial`. | אין ולידציה על תוכן, אורך או קידומת. סריאל קיים נתקע באינדקס ייחודי עם `23505`, והמסנן הגלובלי לא ממפה אותו, ולכן 500 גנרי. תווי בקרה ייכנסו לברקוד מודפס. |
| 399 עד 429 | `custody.run`, `createWithIntake`, ואז `billing.charge` מסוג `intake` עם `itemClass`. ללוט `feeActionType: 'intake_lot'` שנופל חזרה ל `intake`. | כאן נצרכת גם מכסת המנוי, דרך `BillingService`. |
| 441 עד 458 | שורת `item_image` לכל מפתח עם `version` רץ, ואירוע `item_received` ב outbox. | אין בדיקה שהמפתח הועלה למטרת קליטה. מפעיל יכול לשייך כל אובייקט בדלי, למשל מסמך של לקוח אחר, ו `vault.service.ts` יחתום עליו URL לבעל הפריט. |
| 464 עד 478 | `listOpenLots`, כל הלוטים שלא פורקו. | בלי סינון מצב או בעלים ובלי עימוד, גם לוט שנשלח מופיע. |
| 485 עד 531 | `breakLot`. קורא את הלוט בלי נעילה, דורש לוט שלא פורק ויש לו מדף, ויוצר `lotSize` ילדים, כל ילד בטרנזקציה משלו עם `createWithIntake` וחיוב `intake`. בסוף מסמן `lotBroken` מחוץ לכל טרנזקציה. | שתי קריאות מקבילות עוברות שתיהן את הבדיקה ויוצרות פעמיים N ילדים וחיובים. לא בודק מצב או `holdFlag`, בדיקות שקיימות רק ב `LotSplitService`. הלוט נשאר `stored`, ו `storage-fee.ts` לא מסנן `lot_broken`, ולכן הוא מחויב באחסון לצד ילדיו. אין outbox ואין אירוע משמורת על הלוט. |

**שים לב.** `BatchService.split` מראה איך לכתוב את זה בטרנזקציה אחת, `createWithIntake` ו `billing.charge` כבר מקבלים `tx`. מעבר לטרנזקציה אחת דורש ש `createOne` יקבל `tx` מבחוץ, ושינוי צורת הערך של `intakeItem` ישבור את קונסולת המחסן ואת `tests/integration/inv-intake.test.ts` ו `tests3/integration/receiving-bench.test.ts`.

#### `apps/api/src/modules/inv/batch.service.ts`
נתיב קליטה ותיק מחבילות. מפעיל פותח `batch` לבעלים ואחר כך מפצל אותה לפריטים. דפוס P3 נקי, טרנזקציה אחת עם `FOR UPDATE` על האצווה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 15 עד 21 | `SplitItemInput`, מחלקה, תיאור, דרגה, מדף אופציונלי. | אין `parcelId`, תמונות, משקל או סריאל מוכתב. |
| 46 עד 69 | `open`. זיהוי בעלים לפי שם או `intakeId` ושורת `batch` במצב `open`. | שכפול של `IntakeService.resolveOwner`. לא נרשם מי פתח או באיזה מתקן, ואין בדיקת סטטוס חשבון. |
| 97 עד 114 | הכנה לפני הטרנזקציה. מחלקה מוכרת ומדף לכל רשומה, `resolveBin` או `suggest` עם oversized בלבד, ודחיית מדף לא פעיל. | לאצווה אין מתקן, ולכן `suggest` בוחר מדף בכל מבנה. מדף בשם לא נבדק מול מתקן או סוג. ההכנה רצה גם לאצווה שכבר פוצלה. |
| 116 עד 151 | הטרנזקציה. `FOR UPDATE` על `batch`, דחייה אם `split`, ולכל רשומה סריאל, `createWithIntake` עם `eventType: 'batch_split'` ו `sourceBatchId`, וחיוב `intake`. בסוף מצב `split`. | הנעילה היא מה שמונע פיצול כפול וחיוב כפול. המצב `closed` מהסכמה לא נכתב ולא נבדק. אין outbox, האספן לא מקבל `item_received`. |

**שים לב.** המדף נפתר לפני הטרנזקציה כדי לא להחזיק את האצווה נעולה בזמן ספירת הפריטים. הוספת `item_received` לפיצול דורשת לוודא שתבנית ה worker יודעת פריט בלי חבילה. מתקן לאצווה דורש מיגרציה ל `batch` ושינוי `OpenBatchDto`.

#### `apps/api/src/modules/inv/correction.service.ts`
מפעיל מתקן שדות תיאוריים ורושם כל שינוי ב `item_change_history`. דפוס P3 בלי `CustodyService`, כי זה לא אירוע משמורת.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 | `CORRECTABLE`, רשימה לבנה של `description`, `conditionGrade`, `typeClass`. | זה כל מה שמונע ממפתח דינמי לכתוב `ownerId` או `lifecycleState`. הוספת `binId` תעקוף את `relocate` ותשבור את שרשרת המשמורת. הוספת `oversized` תשנה חיוב אחסון רטרואקטיבית. |
| 21 עד 57 | `correct`. טרנזקציה, `FOR UPDATE` על הפריט, ולכל תיקון שדה מותר או 400, מחלקה מוכרת, `UPDATE` ושורת היסטוריה עם הערך הישן. | הערך הישן נלקח פעם אחת לפני הלולאה, אותו שדה פעמיים ירשום היסטוריה שגויה. `as Record<string, unknown>` מבטל בדיקת טיפוסים. אין בדיקת מצב, ותיקון מחלקה לא משנה `item.oversized`. |

#### `apps/api/src/modules/inv/disposal.service.ts`
רושם דבר שהגיע ולא הפך לפריט, סוללה, מכשיר מעקב, או משהו שלא שווה טיפול. טבלה append only משלה, `arrival_disposal`. דפוס P3 עם outbox ובלי משמורת וחיוב.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 23 | `RecordDisposalInput`, חמישה שדות חובה. | אין קישור לחבילה, רק לבעלים. |
| 56 עד 69 | `record`, ולידציה. שם משתמש מנורמל, קטגוריה ותוצאה מהרשימות הסגורות, תיאור והערות לא ריקים אחרי `trim`. | מחרוזת של רווח עוברת את `MinLength(1)` ב DTO ונעצרת כאן. |
| 71 עד 76 | בעלים לפי שם משתמש בלבד, 404 אם אין. | אין fallback ל `intakeId`, בניגוד לקליטה. |
| 78 עד 110 | טרנזקציה, שורה עם קוד `DSL-` ושמונה תווים, ואירוע `arrival_not_accepted` עם הקוד, הקטגוריה, התוצאה והתיאור. | רשומה והודעה יחד, סילוק לעולם לא שקט. התנגשות קוד תחזור כ 500, תאורטית. |
| 113 עד 127 | `listMine`, הסילוקים של משתמש, מהחדש לישן. | ההערות של המפעיל נחשפות לאספן כפי שהן. |
| 130 עד 145 | `listAll` לצוות עם שם משתמש ב `leftJoin`. | אין עימוד. |

**שים לב.** `ParcelService.dispose` הוא מנגנון נפרד שלא כותב כאן. הוספת `parcel_id` דורשת מיגרציה, ו backfill ייחסם בטריגר `bault_reject_mutation`.

#### `apps/api/src/modules/inv/disposal.controller.ts`
דפוס P2 עם `@Controller()` בלי קידומת ו `@Roles` לכל מתודה, כדי שאספן יקרא את שלו ושטופס הקליטה יקבל את אוצר המילים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 16 | `RecordDisposalDto`, תיאור עד 200 תווים והערות עד 1000. | אין אורך על `ownerUsername`, `category`, `outcome`, השירות דוחה כל ערך שאינו ברשימה. |
| 39 עד 46 | `GET /intake/vocabulary`, המחלקות, הקטגוריות והתוצאות מ `item-classes.ts`. | פתוח לכל מחובר. שינוי הנתיב שובר את טופס הקליטה ב `apps/web`. |
| 48 עד 58 | `POST` ו `GET /intake/disposals`, צוות, `actorId` מהסשן. | |
| 61 עד 64 | `GET /me/disposals`, מסונן לפי `user.id`. | אין פרמטר מזהה ולכן אין IDOR. |

**שים לב.** העברת `@Roles` לרמת המחלקה תנעל את האספן ואת טופס הקליטה בחוץ.

#### `apps/api/src/modules/inv/inv.controller.ts`
דפוס P2 תחת `/intake`, עם `@Roles('warehouse_operator', 'admin')` ברמת המחלקה בשורה 111, כך שנתיב חדש לא נפתח בטעות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 29 עד 67 | `IntakeItemDto`. `weightGrams` 1 עד 100000, `quantity` 1 עד 100, `lotSize` 1 עד 1000, עד שש תמונות. | `serialNumber`, `barcode`, `description`, `conditionGrade`, `binId`, `parcelId` הם `IsString` בלי אורך ותבנית. `MaxLength` לא ישבור דבר, הסריאלים של המערכת קצרים מ 20. |
| 77 עד 84 | `IntakeUnitsDto`, מערך לא ריק של עד 50. | |
| 86 עד 107 | `CorrectDto`, `OpenBatchDto`, `SplitDto`. | אין `ArrayMaxSize` ל `patches` ול `items`. פיצול של אלפים מריץ `suggest` שסופר את כל `item` לכל רשומה. |
| 120 עד 135 | `POST /intake/items` אל `intakeItem`, `POST /intake/items/batch` אל `intakeUnits`. | |
| 137 עד 151 | `GET /intake/lots`, `POST /intake/items/:itemId/break-lot`, `PATCH /intake/items/:itemId`. | `break-lot` קורא ישירות ל `breakLot` בלי בקשת שירות ובלי בדיקת מצב. |
| 153 עד 161 | `POST /intake/batches` ו `POST /intake/batches/:batchId/split`. | `actorId` תמיד מהסשן. |

**שים לב.** מפעיל ניגש ממילא לכל המחסן, ולכן IDOR על `itemId` כאן אינו רלוונטי. העברת `break-lot` לדרישת בקשת שירות תשבור את `tests/integration/inv-intake.test.ts`.

### כלי הצוות של `cst`

#### `apps/api/src/modules/cst/inventory.service.ts`
קריאות לצוות על המלאי, היסטוריה של פריט, דוח לפי חתך ו PDF שלו, ציר זמן מאוחד, ניהול מדפים ו `reconcile`. הצרכנים הם `cst.controller.ts`, ו `vault.service.ts` שמשתמש בציר הזמן. כותב רק `bin`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 30 | `Cut` עם ארבעה חתכים, `CUT_LABEL`, ו `TimelineEvent`, צורה אחידה לכל אירוע. | |
| 46 עד 52 | `history`, אירועי המשמורת של פריט מהחדש לישן. | מזהה שאינו UUID נותן `22P02` שהמסנן הגלובלי ממיר ל 400. |
| 55 עד 71 | `report`, בוחר עמודה לפי החתך, `GROUP BY` ו `count(*)`. | בלי סינון מצב, נספר כל פריט שנקלט אי פעם. בחתך מדף פריטים שנשלחו נספרים על המדף שממנו יצאו. בפועל היסטוריה מצטברת ולא מלאי. |
| 73 עד 98 | `labelRows`. בחתך מדף `serial (zone)`, בחתך בעלים מייל. | בחתך בעלים נטענת כל טבלת המשתמשים בכל בקשה, וכל מפעיל מחסן רואה את מיילי כל הלקוחות. החלפה בשם משתמש לא תשבור צרכן. |
| 101 עד 110 | `reportPdf`, בונה מסמך ומעביר ל `renderReportPdf`. | הכותרת מכילה `—` ותת הכותרת `·`, ושניהם יוצאים `?`. כל PDF נפתח ב `Bault ? Inventory Report`. |
| 117 עד 148 | `itemTimeline`, מקורות פנימיים. `contains` בונה `@>` על jsonb, ואז `custody_event`, `item_change_history`, `bin_transfer` לפי `itemId`, כל אחד ממופה ל `TimelineEvent`. | `JSON.stringify([itemId])` עובר כפרמטר, אין הזרקה. |
| 149 עד 196 | מקורות חיצוניים. `transaction` ו `shipment` לפי `itemIds @>`, הצעות על כל ה listings של הפריט, ומחלוקות על העסקאות שנמצאו. מיון יורד לפי מחרוזת ISO. | הציר לא מסונן לפי תקופת בעלות. בעלים קודם שקורא דרך הכספת רואה הצעות, מחירים, משלוחים ומחלוקות של הבעלים הבא. סינון ידרוש להעביר חלון בעלות מ `vault.service.ts`, כי הצוות צריך לראות הכול. |
| 214 עד 238 | `createBin`. אזור חובה, מתקן נפתר, סריאל נמטבע ולא נלקח מהקלט, הכנסה אחת. | נבדק ב `tests3/integration/inv-stow.test.ts`. אין ניסיון חוזר על התנגשות, הסיכוי זניח. |
| 247 עד 274 | `resolveFacilityForBin`. מזהה מפורש, קוד בלי רישיות, או המתקן הראשי הראשון. | מזהה או קוד מפורש יכולים להצביע על מתקן `forwarding` או לא פעיל, רק ברירת המחדל נמנעת מזה. |
| 284 עד 292 | `setBinActive`, עדכון לפי `bin.id` בלבד. | סריאל או ברקוד מחזירים 400, בניגוד לשאר נתיבי המדף ולהערה ב `all-exceptions.filter.ts`. |
| 295 עד 302 | `listBins` מעביר ל `StowService.listWithCounts`. `reconcile` מחזיר `count(*)` וחותמת זמן. | `reconcile` הוא stub עם שם מבטיח, אין שום התאמה. |

**שים לב.** סינון מצב ב `report` ישנה מספרים שמנהלים רגילים לראות ואת ה PDF. קורא `mkt`, `shp` ו `adm` לציר הזמן, ולכן שינוי סכמה שם עלול לשבור את הציר כאן.

#### `apps/api/src/modules/cst/report-pdf.ts`
כותב PDF ידנית בלי ספרייה, Helvetica מובנה, טבלה של שתי עמודות ועימוד. הצרכן היחיד הוא `InventoryService.reportPdf`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 20 | טיפוסי שורה ומסמך, כותרת, תת כותרת, שתי עמודות, שורות וסכום. | |
| 22 עד 28 | `escapeText`. מוסיף `\` לפני `\`, `(`, `)`, ואז מחליף כל תו שאינו ASCII מודפס ב `?`. | זו פונקציית האבטחה. הסדר חשוב, ה escape קודם. בלי ההחלפה שורה חדשה בערך של משתמש, למשל אזור מדף, תאפשר הזרקת אופרטורים או `endstream`. המחיר, אין עברית ואין Unicode. |
| 30 עד 34 | עמוד Letter 612 על 792, שוליים 54, שורה 16, `ROWS_PER_PAGE` יוצא 38. | |
| 36 עד 70 | `buildPageContent`, זרם התוכן של עמוד. `BT ... Tj ET` לטקסט, `m`, `l`, `S` לקווים, כותרת בעמוד הראשון, סכום בעמוד האחרון, מספר עמוד. | אין גלישת שורות, תווית ארוכה חורגת מהעמודה. העמוד הראשון מקבל אותו מספר שורות כמו האחרים למרות הכותרת, והשורה האחרונה בו יורדת קרוב לשוליים. |
| 72 עד 120 | `renderReportPdf`. מחלק לעמודים, אובייקט 1 קטלוג, 2 עץ עמודים, 3 ו 4 גופנים, ומ 5 זוגות של תוכן ועמוד. `/Length` ב `latin1`, טבלת `xref` של רשומות בנות 20 בתים, `trailer`, ו `Buffer`. | שינוי מספר האובייקטים הקבועים מחייב לעדכן את ההפניות `2 0 R`, `3 0 R`, `4 0 R`. |

**שים לב.** עברית או לוגו דורשים גופן מוטמע וקידוד `Identity-H`, בפועל ספרייה. אין ב `apps/api/package.json` ספריית PDF.

#### `apps/api/src/modules/cst/cst.controller.ts`
דפוס P2 לצוות תחת `/custody`. העברה, החזקה, היסטוריה, ציר זמן, דוח, PDF, מדפים וקליטה מכוונת. `@Roles('warehouse_operator', 'admin')` לכל מתודה ולא ברמת המחלקה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 41 | `RelocateDto` עם `binId` שמקבל ברקוד, `CreateBinDto` בלי ברקוד, `BinActiveDto`, ורשימת `CUTS`. | |
| 62 עד 73 | `POST /custody/items/:itemId/relocate`. `resolveItem` על הפרמטר, `resolveBin` על הגוף, ואז `RelocateService.relocate`. | אין בדיקה שמדף היעד פעיל, במתקן הנכון או מהסוג הנכון. מדף מושבת נחסם בקליטה אבל לא בהעברה. |
| 83 עד 95 | `POST` ו `DELETE /custody/items/:itemId/hold`, מחזירים אם משהו השתנה. | מקבלים רק UUID, בלי `resolveItem`, וסריקת ברקוד מחזירה 400. |
| 99 עד 116 | `history`, `timeline`, ו `POST /custody/reconcile`. | מזהה פנימי בלבד. ללקוח יש נתיב משלו בכספת. |
| 119 עד 142 | `GET /custody/report` ו `report.pdf`. החתך נבדק מול `CUTS` לפני השירות. ב PDF `@Header` ו `@Res({ passthrough: true })`, `Content-Length` ידני ו `res.end(pdf)`. | שני הנתיבים חושפים מיילים של לקוחות בחתך בעלים. |
| 145 עד 168 | `POST /custody/bins` אל `createBin`, ו `GET /custody/bins` אל `listWithCounts`. | הסריאל נמטבע בשרת, ה DTO לא מקבל ברקוד. |
| 170 עד 189 | `GET bins/suggest` ו `GET bins/stowable`, `facilityCode` ו `oversized` מה query. הקוד עובר `facilityIdByCode`, ו `oversized` מומר ב `=== 'true'`. | `GET bins/:binId` שיתווסף לפניהם יבלע אותם. |
| 192 עד 196 | `PATCH bins/:binId` אל `setBinActive`, השבתה ולא מחיקה. | UUID בלבד, ברקוד מחזיר 400. |

**שים לב.** כל מתודה מסומנת בנפרד. מתודה חדשה בלי `@Roles` תהיה פתוחה לכל משתמש מחובר. העברה לרמת המחלקה לא תשבור דבר.

### כספת, `vlt`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/vlt/vlt.module.ts` | דפוס P1. מחבר `VltController` ל `VaultService` ו `BreakEvenService`, בלי exports. נשען על `CstModule`, `AdaptersModule` ו `DbModule` גלובליים. |

#### `apps/api/src/modules/vlt/storage-policy.ts`
מדיניות דמי האחסון כפי שהלקוח רואה אותה. תקופה כלולה ממועד הקבלה, ואחריה חיוב לכל תקופה שהוא אחוז מדמי הקליטה של הפריט. הקובץ לא מחייב. ה worker מחייב ב SQL ב `apps/worker/src/jobs/storage-fee.ts` ולא מייבא את הקובץ, ולכן הלוגיקה משוכפלת. הצרכן היחיד הוא `vault.service.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 32 | הערת פתיחה, המודל הישן של חיוב יומי הוחלף בתקופה כלולה ואחוז מדמי הקליטה. | |
| 34 עד 41 | `StorageParameters`, `freeDays`, `periodDays`, `percentOfIntakeBps` שבו 10000 הוא מאה אחוז. | |
| 43 עד 53 | `STANDARD_STORAGE`, 180 ימים ואחריהם עשרה אחוזים כל 90 יום. `OVERSIZED_STORAGE`, 90 ימים ואחריהם מאה אחוז כל 90 יום, עונשי בכוונה. | שינוי כאן בלי שינוי זהה ב `storage-fee.ts` שורות 94 עד 108 יציג תנאים שלא מחויבים. |
| 55 עד 75 | `storageParameters`, קורא את `pricing_rule.parameters` ונופל לברירת מחדל על ערך לא סופי או שלילי. `periodDays` לפחות 1. | אין תקרה על `percentOfIntakeBps`, מיליון יתקבל. אותו כלל ב worker, כך שערך פגום מתורגם זהה בשני הצדדים. |
| 77 עד 83 | `DAY_MS` ו `freeUntil`, הוספת ימים במילישניות ב UTC. | ה worker מחשב ב Postgres לפי אזור הזמן של הסשן. אין `TimeZone` או `PGTZ` בפרויקט, ברירת המחדל UTC, וזו הנחה סמויה. |
| 85 עד 99 | `nextChargeAt`, סוף התקופה הכלולה ועוד `periodsBilled` תקופות. | נספר מהחיובים שה worker כתב ולא מהשעון, כך שסבב שהוחמץ מוצג כחיוב הבא. |
| 101 עד 105 | `periodChargeMinor`, אפס לדמי קליטה לא חיוביים, אחרת `Math.round(intake * bps / 10000)`. | ה worker מחייב `GREATEST(1, ...)`, לפחות סנט. פריט עם דמי קליטה זעירים או אפס מוצג כאפס ומחויב סנט לכל תקופה. |

#### `apps/api/src/modules/vlt/break-even.service.ts`
מחשב לכל פריט על מדף כמה כבר שולם, כמה יעלה אחסון בשנה, ואות ערך, כדי לומר ללקוח מתי הפריט עולה יותר ממה שהוא שווה. הערך בא רק ממכירות אמיתיות באותה מחלקה או ממחיר הבקשה של הבעלים. הצרכן הוא `GET /vault/break-even`, והבדיקות ב `tests3/integration/vlt-break-even.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 43 עד 72 | `ValueBasis`, `sold_comparable`, `own_asking_price`, `unknown`, ו `BreakEvenRow` עם הוצאה כוללת, הוצאת אחסון, תחזית לשנה, ערך, מספר השוואות, `pastBreakEven`, `monthsToBreakEven`. | |
| 89 עד 117 | `soldMedianByClass`. עסקאות `sale` עם מחיר, join ל `item` דרך `itemIds @> to_jsonb(item.id::text)`, קיבוץ לפי `typeClass` וחציון, ממוצע מעוגל של שני האמצעיים ברשימה זוגית. חציון ולא ממוצע כדי שמכירה חריגה אחת לא תזיז את האות. | כל היסטוריית המכירות נטענת לזיכרון בכל בקשה, בלי חלון זמן. עסקה מרובת פריטים תיזקף במלואה לכל פריט. |
| 126 עד 136 | `forOwner`, פריטי המשתמש במצבים `stored`, `listed`, `on-hold`. | `received` לא נכלל. הוספתו תכניס פריטים שעוד לא על מדף. |
| 141 עד 157 | כל החיובים שה `reference_id` שלהם אחד הפריטים, וצבירה לכל פריט של סכום כולל, סכום אחסון ומספר תקופות. | אין סינון לפי `charge.user_id`. קלף שנקנה מאחר נושא את הוצאות הבעלים הקודם, והקונה רואה כמה שילם המוכר ומקבל דגל איזון על כסף שלא הוציא. |
| 159 עד 166 | מחירי בקשה של מודעות פעילות, וחציונים מ `soldMedianByClass`. | ארבע שאילתות לבקשה ולא N. |
| 168 עד 183 | חישוב לכל פריט, הקצב. `monthsHeld` בחודשים של 30 יום מאז `receivedAt`, לפחות 1, קצב חודשי כסך האחסון חלקי `monthsHeld`, ותחזית לשנה פי 12. | הקצב כולל את 180 הימים הכלולים ולכן מדולל. פריט אחרי 270 יום עם תקופה אחת של 50 סנט מקבל תחזית של כ 67 סנט בשנה במקום כ 200. פריט בתקופה הכלולה מקבל אפס. התיקון, קצב מ `periodChargeMinor` ו `periodDays` של הכלל. |
| 185 עד 225 | אות הערך, חציון של מכירות באותה מחלקה ואחריו מחיר הבקשה. `pastBreakEven` כשההוצאה הכוללת, כולל דמי קליטה, לפחות הערך. `monthsToBreakEven` הוא `null` בלי ערך או קצב, אפס אם כבר עבר, ואחרת עיגול למעלה של ההפרש חלקי הקצב. | בגלל הקצב המדולל מספר החודשים מוערך ביתר, והלקוח עלול להחליט לא למכור. |
| 235 עד 253 | `summaryFor`, סכומים, כמה עברו את האיזון וכמה הוצא עליהם, ומיון. | ה comparator לא סימטרי כששני הערכים `null`, הסדר בין פריטים בלי ערך לא מוגדר. אין בדיקת מטבע. |

**שים לב.** תיקון הקצב או הוספת סינון `charge.user_id` ישנו את `projectedYearMinor`, `totalSpentMinor` ו `monthsToBreakEven`, ויחייבו לעדכן את קבוצת הבדיקות `the arithmetic holds together`. החציון כדאי להעביר ל SQL עם `percentile_cont` או חלון זמן כשהשוק יגדל.

#### `apps/api/src/modules/vlt/vault.service.ts`
שירות הקריאה של הכספת. עונה על חמש שאלות, מה יש לי, מה מוקפא, מה עזב אותי, מה ההיסטוריה של פריט, וכמה עלה ויעלה האחסון. לא כותב לשום טבלה. כל ההרשאה מבוססת על `item.owner_id` של המשתמש מהסשן או על יומן `custody_event`, ולכן כאן נקבע מה לקוח רואה על קלף שעבר ידיים. הלקוחות הם `VaultPage.tsx` ו `useVaultItems.ts` ב `apps/web`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 31 | `VaultScope`, `active`, `hold`, `history`. | |
| 33 עד 55 | `toIso`. מחליף את הרווח הראשון ב `T` ומשלים היסט לצורה `+HH:MM`, או `null`. | מתקן חותמות זמן שחוזרות מ `node-postgres` כמחרוזת בפורמט של Postgres. Node 22 מפרסר אותן בכל זאת, המטרה העיקרית היא ISO תקני לדפדפן. |
| 57 עד 74 | `VaultFilter`, `TERMINAL` שהוא `shipped`, `donated`, `consigned`, `sold`, ו `LIVE` שהוא `received`, `stored`, `listed`. | `at_grader` ו `discarded` לא ברשימות. פריט של הלקוח אצל מדרג או שנזרק לא מופיע ב `active` ולא ב `history`, הוא נעלם מהכספת. |
| 83 עד 89 | הבנאי, Drizzle, `STORAGE_ADAPTER` לחתימת URL, ו `InventoryService`. | |
| 91 עד 101 | `timeline`. `hasHeld` או 404, ואז `InventoryService.itemTimeline`. | 404 ולא 403, לא חושף קיום. הציר המלא חוזר גם לבעלים לשעבר. |
| 103 עד 129 | `hasHeld`. בעלות נוכחית, או אירוע משמורת כלשהו שבו המשתמש בעלים קודם או חדש. | כל סוג אירוע מספיק, גם העברה של מנהל דרך `AdmService.updateItem` נותנת לבעלים הקודם גישת קריאה קבועה. |
| 131 עד 145 | `listOwned`, תנאים. ברירת מחדל `active`, ו `history` עובר ל `listHistory`. תמיד `owner_id` שווה למשתמש. `hold` הוא `holdFlag` או מצב `on-hold`, אחרת מצב ב `LIVE` ו `holdFlag` שקר. סינון מחלקה, דרגה וחיפוש. | `` ?? sql`true` `` קיים רק כי `or` של Drizzle עשוי להחזיר `undefined`. אין IDOR, הכול מהסשן. |
| 149 עד 176 | שליפת שדות הכרטיס עם `leftJoin` ל `bin` לברקוד ואזור, מיון לפי `created_at` יורד, ו `limit` שהוא `filter.limit ?? 50` וחסום ב 200. | הבקר לא מעביר `limit` ואין עימוד. לקוח עם 300 פריטים רואה את 50 החדשים, ו `useVaultItems.ts` משתמש באותה קריאה לרשימות הבחירה של משלוח, שירותים ומודעות. `bin_id` שאינו UUID, למשל אחרי עריכת מנהל, מפיל את כל הכספת ב 400. |
| 178 עד 196 | `searchClause`, `ILIKE` על תיאור, מחלקה, סריאל, ברקוד, דרגה ומצב. | פרמטר, בלי הזרקה. `%` ו `_` מהמשתמש לא מוברחים. |
| 198 עד 239 | `listHistory`, תת השאילתה `departure`. לכל פריט `max(occurred_at)` מאירועי `ownership_transfer`, `state_change`, `dispatch` שבהם המשתמש בעלים קודם, או בעלים חדש עם מצב ב `TERMINAL`. | ההערה בשורות 199 עד 217 מתארת שתי אוכלוסיות, שלי שעזב את המחסן, ושהיה שלי. |
| 241 עד 274 | תנאי על הפריט, בבעלותו ובמצב סופי או בבעלות אחר, `innerJoin` לתת השאילתה, ושדות זהות בלבד בלי בעלים נוכחי ומדף. `stillOwned` מחושב ב SQL. | `limit` ברירת מחדל 50, כמו `listOwned`. |
| 276 עד 295 | מיפוי כל שורה, `toIso` ל `departedAt`, איפוס שדות המדף, ו `departureReason` לפי בקשה. | N ועוד 1, עד 200 שאילתות במקביל דרך `Promise.all` שמתחרות על ה pool. |
| 297 עד 319 | `departureReason`, האירוע האחרון שמתאים, `reason` ואז `newState` ואז `eventType`. | בלי סינון סוג אירוע, הסיבה יכולה לבוא מאירוע אחר מזה שקבע את `departedAt`. |
| 321 עד 332 | `counts`, מריץ את שלוש הרשימות עם `limit` 200 וסופר אורך. | התג יכול להראות 180 כשהמסך מציג 50, ומעל 200 הוא שגוי. `count(*)` היה נכון וזול. |
| 345 עד 356 | `storageFor`, הפריט בבעלות נוכחית או 404. | |
| 358 עד 375 | כלל `storage` או `storage_oversized` בתוקף, החדש ביותר, ופרמטרים דרך `storageParameters`. | בלי כלל `storage_oversized` נופל ל `OVERSIZED_STORAGE`, 90 יום ומאה אחוז, בעוד ה worker נופל לכלל הרגיל. |
| 378 עד 397 | ספירה וסכום של חיובי אחסון לפי `reference_id`, וחיוב הקליטה האחרון או `rule.value`. | ספירת תקופות לפי פריט תואמת ל worker, אבל `totalChargedMinor` כולל חיובים של בעלים קודמים. `??` לא נופל על חיוב קליטה של אפס, כמו `COALESCE` ב worker. |
| 399 עד 418 | התשובה, תקופה כלולה, `freeUntil`, `nextChargeAt` רק ב `stored`, וסכום לתקופה. | לא יודע על כיסוי המנוי, ולכן מנוי רואה חיוב ותאריך שלא יתממשו. |
| 420 עד 434 | `itemCard`, כל עמודות הפריט בבעלות נוכחית, ו URL חתום לכל תמונה דרך `storage.getSignedUrl`, קריאה אחת לכל תמונה במקביל. | המפתחות מגיעים מ `item_image`, וכל מפתח שמפעיל שייך בקליטה ייחתם כאן לבעלים. |
| 436 עד 440 | כל אירועי המשמורת של הפריט עם `select()` מלא. | חוזרים `prev_owner_id`, `new_owner_id` ו `actor_id`, מזהי בעלים קודמים ועובדים. projection מצומצם ידרוש לבדוק מה `VaultPage.tsx` קורא. |
| 442 עד 472 | בקשות שירות פתוחות של המשתמש על הפריט, במצבים `requested` ו `in_progress`. | נשלחות עם הכרטיס כדי שהכפתורים לא יוצגו לרגע במצב שגוי, אחרי באג של הזמנה כפולה. |

**שים לב.** כל שינוי בשאילתת הכלל או בנוסחאות כאן צריך שינוי זהה ב worker, אחרת הלקוח רואה תאריך או סכום שלא יתממשו. עימוד ל `listOwned` דורש שינוי ב `vlt.controller.ts`, `VaultPage.tsx` ו `useVaultItems.ts`.

#### `apps/api/src/modules/vlt/vlt.controller.ts`
דפוס P2 דק תחת `/vault`, כולו GET ובלי `@Roles`. כל מחובר, כולל צוות, רואה רק את הכספת שלו, כי כל שאילתה מסוננת לפי `user.id`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 8 עד 12 | `SCOPES` ו `toScope`, ערך לא מוכר הופך ל `active`. | בכוונה, סימנייה ישנה עדיין עובדת. |
| 31 עד 34 | `GET /vault/break-even` אל `summaryFor`. | |
| 42 עד 51 | `GET /vault/items`, קורא `q`, `scope`, `filter[type]`, `filter[condition]` מה query. | אין DTO ולכן אין ולידציה. מערך ב `q` יגיע ל `ilike` ויסתיים בשגיאת Postgres. אין `limit`, ופרמטר כזה בעתיד חייב תקרה. |
| 54 עד 57 | `GET /vault/counts`. | |
| 59 עד 80 | `items/:itemId`, `items/:itemId/storage`, `items/:itemId/timeline`. | אין `ParseUUIDPipe`. מזהה לא חוקי נותן `22P02` שהמסנן הגלובלי ממפה ל 400, בכוונה כי נתיבים אחרים מקבלים ברקוד. |

**שים לב.** `@Roles('user')` כאן יחסום צוות מהכספת האישית שלהם.

### מנוי, `mem`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/mem/mem.module.ts` | דפוס P1 עם `@Global` בשורה 14, מייצא `MembershipService` כי `BillingService` שואל אותו לפני כל חיוב. יש תלות מעגלית לוגית עם `pay`, שעובדת רק כי שני המודולים גלובליים. import מפורש של `PayModule` יחייב `forwardRef`. |

#### `apps/api/src/modules/mem/tiers.ts`
קטלוג הדרגות כנתונים טהורים ופרדיקטים. מה כל דרגה כוללת, כמה פעמים במחזור, ומה לא מכוסה באף דרגה. המחיר עצמו בא מכלל תמחור. שלושה כללים בהערה בשורות 1 עד 33, לכל הכללה יש תקרה, אין תעריף חריגה, והכללות לא מתגלגלות. צרכנים, `membership.service.ts`, `mem.controller.ts`, `pay/billing.service.ts`, `shp/shipment.service.ts`, `db/seed.ts`, והבדיקה `tests/web/membership-tiers.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 35 עד 36 | `UNLIMITED` שווה מינוס אחד, כי `Infinity` לא שורד JSON. | כל צרכן חייב לבדוק אותו, כמו `shipment.service.ts`. |
| 38 עד 56 | `ALLOWANCE_ALIASES` ו `allowanceFor`. היום רק `intake_lot` נספר כ `intake`. | אין נפילה כללית לפעולת האב, אחרת הכללת `service` הייתה משלמת על בדיקות. `BillingService.charge` קורא לה. |
| 58 עד 61 | `TierKey` ו `TIER_KEYS`, `folio`, `registry`, `trust`, מהזולה ליקרה. | הסדר הוא מסלול השדרוג, ו `tierRank` נשען עליו. שינוי הסדר משנה מה נחשב הורדה ב `subscribe`. |
| 63 עד 109 | `MembershipTier`. `feeActionType` בצורת `membership:<key>`, `listPriceMinor` כגיבוי, `perCycle` לפי `feeActionType ?? actionType`, `storedItems`, ביטוח, אשראי משלוח, `commissionWaivedOnMinor`, `escrowValueCapMinor`, `perks` לתצוגה. | המפתח של `perCycle` מאפשר לכסות `service_fee:deslab` בלי לכסות כל `service`. |
| 111 עד 201 | `MEMBERSHIP_TIERS`. `folio` 39 דולר עם 4 קליטות ו 60 פריטי אחסון. `registry` 199 דולר עם 10 קליטות, 200 פריטים וויתור עמלה על 1000 דולר. `trust` 699 דולר עם 25 קליטות, עיבוד, העברה ופירוק בלי תקרה, 750 פריטים ועסקת נאמנות אחת עד 5000 דולר. `registry` מוסיף 5 עיבודים, 2 העברות, בדיקות מצב וסקירות וידאו ו 3 משלוחים מבוטחים. `trust` מוסיף 8 שירותים, מכשירי מעקב, דמי נאמנות ומשיכה ו 6 משלוחים מבוטחים. | `storedItems` חי בשני מקומות. המסך מציג את הערך מכאן, וה worker קורא `pricing_rule.parameters ->> 'storedItems'`. כלל שנערך בלי השדה מכסה אפס פריטים בזמן שהמסך מבטיח 60. ה perk `oversized_storage` לא נקרא בשום קוד, וה worker מכסה גם פריטים חריגים של `folio`. |
| 203 עד 216 | `BY_KEY`, `membershipTier`, `isTierKey` כ type guard, `tierRank` שמחזיר מינוס אחד לדרגה לא מוכרת. | |
| 218 עד 233 | `UNCOVERED`, מה שאף דרגה לא מכסה, מוחזר בקטלוג לתרגום בממשק. | |
| 235 עד 254 | `remaining` ו `covers`. אפס לפעולה לא מכוסה וגם להכללה שנגמרה, בכוונה. | הסרת פעולה מ `perCycle` מחזירה אותה לחיוב מלא מיד, גם באמצע מחזור ששולם. |
| 256 עד 284 | `fullUseCostMinor`, העלות המרבית של דרגה ל Bault במחזור, כולל אחסון של 17 סנט לפריט לחודש וביטוח. | לא נקרא מקוד ייצור, רק מהבדיקה. לא סופר את `escrowValueCapMinor`. |

**שים לב.** `membership.tier` הוא `text`, ולכן דרגה חדשה לא דורשת מיגרציה, אבל דורשת כלל `membership:<key>` ושורת seed. ה SPA ב `apps/web/src/shared/membership.ts` מחזיק רק צורות, לא עותק של הנתונים.

#### `apps/api/src/modules/mem/membership.service.ts`
לב המנוי. מוכר דרגה, משדרג, מוריד ומבטל, מחזיר ללקוח מה נשאר במחזור, ובעיקר עונה לשאר המערכת אם פעולה כלולה ומנצל את ההכללה בתוך הטרנזקציה של הקורא. `BillingService` שואל את `consume` לפני כל חיוב קבוע, וארבעה חיובים שלא עוברים בו שואלים את `waive`. יש שורת `membership` אחת למשתמש ושורת `membership_period` לכל מחזור, עם מוני צריכה כ jsonb ב `consumed`. כותב `membership`, `membership_period`, `charge` ו `ledger_record`. צרכנים מבחוץ, `pay/billing.service.ts`, `pay/wallet-request.service.ts`, `esc/escrow.service.ts`, `shp/human-fulfilment.service.ts`, `shp/shipment.service.ts`, `mkt/purchase.service.ts`. החידוש עצמו רץ ב worker, `apps/worker/src/jobs/membership-renewal.ts`, כל שעה בדקה 40. אין בדיקות אינטגרציה בצד השרת לשירות הזה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 26 | `CYCLE_DAYS` 30 ו `CYCLE_MS`. | ה worker משתמש ב `interval '30 days'` לפי אזור הזמן של הסשן. שינוי כאן בלי שם יוצר מחזורים באורכים שונים. |
| 28 עד 66 | `ShippingCover`, `AppliedShippingCover`, `Entitlement` שהוא התשובה של `consume`. | |
| 88 עד 94 | הבנאי, DB, `PricingService`, `LedgerService`, `WalletService`. | |
| 100 עד 126 | `catalogue`, הדרגות עם מחיר חי, `UNCOVERED`, אורך מחזור ו `USD`. `feeFor` מנסה `pricing.tryPrice` ונופל ל `listPriceMinor` עם `fallback: 'catalogue'`. | כשאין כלל, ה API מוכר במחיר קטלוג בעוד ה worker מסרב לחדש ומשאיר את המנוי פג. |
| 132 עד 145 | `current`, שורת המנוי או `null` אם `ended`, ושורת התקופה שה `period_start` שלה שווה בדיוק ל `current_period_start`. | ההתאמה מדויקת במילישניות. כתיבה של `currentPeriodStart` מ `now()` של המסד תשבור את `current` ואת `consume`. ה worker נאלץ ל `date_trunc('milliseconds', now())`. |
| 154 עד 199 | `allowances`, `null` בלי מנוי. לכל פעולה ב `perCycle` מותר, נוצל ונשאר, ובנוסף `storedItems`, משלוחים מבוטחים ותקרתם, אשראי משלוח שנשאר, ועמלה שוותרה. `currentFeeMinor` הוא מה שחויב במחזור הזה, לתצוגת זיכוי שדרוג מראש. | הנשאר אפס כשהמחזור לא חי. `storedItems` מהקוד ולא מהכלל שה worker קורא. |
| 201 עד 205 | `isCycleLive`, סטטוס שאינו `ended` והשעה בין תחילת המחזור לסופו. | אותו תנאי בדיוק ב `storage-fee.ts`. |
| 228 עד 243 | פתיחת `subscribe`, דפוס P3. דרגה מוכרת, טרנזקציה, `wallet.assertNotBlocked`, `FOR UPDATE` על שורת המנוי. `live` היא שורה שאינה `ended`. | `assertNotBlocked` חוסם רק יתרה שכבר שלילית. משתמש עם אפס קונה `trust` ומקבל את ההכללות מיד. למשתמש חדש אין שורה לנעול, והאילוץ `membership_user_unique` מכשיל את הבקשה המקבילה. |
| 245 עד 295 | אותה דרגה, ביטול ביטול או הורדה מתוזמנת בחיוב אפס, אחרת 409. דרגה נמוכה יותר נשמרת ב `scheduledTier` בלי שינוי דרגה. | מנוי שפג וה worker עוד לא עבר עליו נחשב חי ולא יכול לשלם מחדש על אותה דרגה. ה 409 על אותה דרגה הוא ההגנה מלחיצה כפולה. |
| 297 עד 336 | מחיר חדש, זיכוי יחסי לפי הזמן שנשאר מ `feeMinor` של התקופה הנוכחית, בעיגול למטה, וחיוב נטו עם snapshot של מחיר, זיכוי ודרגה קודמת. | הזיכוי לא מתחשב בהכללות שנוצלו, והתקופה החדשה נפתחת עם `consumed` ריק. ניצול `folio` ושדרוג מיד מחזיר כמעט את כל הסכום ונותן מכסה חדשה. |
| 338 עד 377 | עדכון או הכנסה של שורת המנוי עם מחזור חדש מ `now`, ו `openPeriod`. | `startedAt` לא מתעדכן כשמנוי שהסתיים חוזר. |
| 386 עד 435 | `openPeriod`. `membership_period` עם `consumed` ריק, ואם הסכום חיובי `charge` במצב `settled` דרך `wallet` ו `ledger.record` מסוג `service_charge`. | תקופה וחיוב באותה טרנזקציה. `membership_period_unique` מכשיל שני שדרוגים באותה מילישנייה. |
| 447 עד 458 | `cancel`. 404 בלי מנוי, מחזיר אם כבר מבטל, אחרת `cancelling` וניקוי הורדה מתוזמנת. | בלי טרנזקציה ונעילה. ההערה מבטיחה שאחסון יחזור לתנאים רגילים מסוף המחזור, אבל ה worker סופר תקופות מאז `received_at` ומפחית רק מה שחויב, ולכן אחרי סיום הכיסוי כל התקופות שהצטברו מחויבות בבת אחת. |
| 476 עד 526 | `consume`. לא מכוסה בלי מנוי או מחזור חי. בדיקה מקדימה לפי מה שנקרא, ואז `UPDATE` עם `jsonb_set` ותנאי `WHERE` שבודק שוב שהמונה מתחת לתקרה. אפס שורות מחזיר לא מכוסה. | התנאי ב `WHERE` הוא מה שמונע ששתי פעולות מקבילות יקחו את ההכללה האחרונה. העברה לבדיקה ב JavaScript בלבד תחזיר את ה race. נכשל לכיוון הבטוח, לא מכוסה. |
| 555 עד 569 | `waive`, הכניסה. ארבעה חיובים שלא עוברים דרך `BillingService`, ו `null` כשאין מה לוותר. | הכלל, ויתור רק מוריד סכום שכבר הוצג ללקוח. |
| 570 עד 596 | `marketplace_fee`. כמה מערך המכירה עוד מותר לוותר, עדכון מותנה של `commission_waived_on` שלא יעבור את התקרה, וויתור יחסי `round(fee * waivedOn / value)` עד גובה העמלה. | הקורא הוא `mkt/purchase.service.ts`, והמנוי הוא של המוכר. |
| 598 עד 604 | שאר הפעולות דרך `consume`. בנאמנות מעל `escrowValueCapMinor` הוויתור הוא העמלה על ערך התקרה. | כל ויתור חסום ב `feeMinor`. |
| 616 עד 636 | `shippingCover`, קריאה בלבד של ביטוח, אשראי ותוספות שנשארו, ו rush לפי `perks`. | `null` בלי מחזור חי. |
| 649 עד 685 | `spendShippingCover`, נקרא בתוך טרנזקציית התשלום ב `shp/shipment.service.ts`. 409 אם הדרגה השתנתה או המחזור לא חי, אחרת `UPDATE` מותנה של מוני ביטוח ומשלוח ו `consume` לכל תוספת. | מסרב ולא מחייב את ההפרש. |
| 698 עד 735 | `renewDue`, גרסת API לחידוש. | לא נקרא מאף מקום. בלי נעילה, `ended` נכתב מחוץ לטרנזקציה, ומחיר חסר נופל לקטלוג. קוד מת שמתנהג אחרת מה worker. |

**שים לב.** החידוש מתחיל מ `now` ולא מסוף המחזור. בין סוף מחזור לריצת ה worker יש עד שעה שבה `consume` עונה לא מכוסה, ומחזור שנגמר בין `01:40` ל `02:00` נראה פג בסבב האחסון של `02:00`.

#### `apps/api/src/modules/mem/mem.controller.ts`
דפוס P2 תחת `/membership`, ארבעה נתיבים, הלקוח הוא `apps/web/src/shared/membership.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 14 | `SubscribeDto`, רק `tier` מתוך `TIER_KEYS`. | דרגה חדשה ב `tiers.ts` מתעדכנת כאן אוטומטית. |
| 30 עד 34 | `GET /membership/tiers` אל `catalogue`, מסומן `@Public`. | אורח קורא תנאים לפני שיש לו חשבון. הסרת `@Public` שוברת את עמוד הדרגות לאורחים. |
| 37 עד 50 | `GET me` אל `allowances`, `POST subscribe`, `POST cancel`. | בלי `@Roles`, גם צוות יכול להירשם. אין מפתח idempotency, ההגנה מלחיצה כפולה היא הנעילה וה 409 ב `subscribe`. ה `AuditInterceptor` רושם נתיב בלי גוף. |

### קונסולת המנהל, `adm`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/adm/adm.module.ts` | דפוס P1. `AdmController`, `AdmService`, `ShelfYieldService`, בלי exports, ולכן `runStorageFees` לא נגיש לאף קוד. |

#### `apps/api/src/modules/adm/adm.service.ts`
שירות קונסולת המנהל. מציג את כל המשתמשים, הפריטים, העסקאות, המחלוקות, ריצות דמי האחסון ויומן הכניסות, ומאפשר לערוך משתמשים, פריטים ומחלוקות. כל עריכת פריט משנה את הקלט שעליו נשענים הכספת, החיוב והדוחות, ולכן זה קובץ הסיכון של האזור. הצרכן היחיד הוא `adm.controller.ts`. כותב `user_account`, `item`, `custody_event`, `item_change_history`, `dispute`, ובקוד המת גם `charge` ו `storage_fee_run`. קורא גם `transaction`, `login_attempt`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 42 | `UserPatch`, `ItemPatch`, `DisputeStatus`. | ממשקים בלבד, הוולידציה ב DTO של הבקר. |
| 52 עד 85 | `listUsers`, עמודות מפורשות בלי `password_hash`, מסנן מיילים של `FIXTURE_EMAIL_DOMAIN` עם `NOT ILIKE`. | אין `limit` ואין עימוד, כל הטבלה בכל טעינה. |
| 87 עד 116 | `updateUser`, הגנה עצמית. מנהל שעורך את עצמו לא יכול לשנות סטטוס מ `active` או תפקיד מ `admin`. | כל מנהל יכול להוריד או להשעות כל מנהל אחר, ושני מנהלים שמורידים זה את זה בו זמנית משאירים אפס מנהלים. מנהל יכול להפוך חשבון בשליטתו למנהל ולעקוף את ההגנה ב `wallet-request.service.ts` שמונעת אישור משיכה של עצמו. |
| 118 עד 147 | בניית `set` שדה אחרי שדה, רק `role`, `status`, `firstName`, `lastName`, `nameReviewRequired`, עדכון ושליפה, 404 אם אין. | זו ההגנה מפני mass assignment. שם שמנהל כתב מנקה את `nameReviewRequired`. השינוי חל בבקשה הבאה, כי `SessionService.resolve` קורא תפקיד וסטטוס מהמסד בכל בקשה. יומן הביקורת רושם נתיב בלי ערך ישן וחדש. |
| 149 עד 167 | `listItems`, כל הפריטים עם מייל הבעלים. | `leftJoin` של `uuid` מול `text` נשען על cast מרומז מ `0001_append_only.sql`. `owner_id` אחד שאינו UUID מפיל את כל המסך ב 400. |
| 169 עד 197 | `updateItem`, טרנזקציה עם `FOR UPDATE`. מחלקה מוכרת, ולכל שדה תיאורי ששונה שורת `item_change_history`. | דפוס P3 בלי `CustodyService`. |
| 199 עד 203 | שינוי בעלים ואירוע `ownership_transfer` עם `admin edit`. | עוקף את `CustodyService`. `ownerId` לא נבדק כ UUID או כמשתמש קיים, מחרוזת שגויה מפילה אחר כך את `listItems` ו `byCustomer`, ו UUID של משתמש שלא קיים יוצר פריט יתום שממשיך להיות מחויב. מודעה פעילה לא מתבטלת, ו `purchase.service.ts` לא בודק שהמוכר הוא הבעלים, כך שהזיכוי ילך לבעלים הקודם. |
| 205 עד 209 | שינוי מדף, מחרוזת ריקה הופכת ל `null`, אירוע `relocate`. | לא כותב `bin_transfer`, ו `ShelfYieldService` ממשיך לחשב לפי המדף הקודם. אין בדיקת קיום. ברקוד במקום UUID מפיל את כל הכספת של הבעלים ב 400. |
| 211 עד 215 | שינוי מצב ואירוע `state_change`, בלי `assertTransition`, בכוונה. | החזרת `shipped` ל `stored` גורמת ל worker לחייב את כל התקופות מאז `received_at` המקורי. |
| 217 עד 221 | החזקה ואירוע `hold_placed` או `hold_released`. | לא שולח `hold_placed` ל outbox, הבעלים לא מקבל הודעה, בניגוד ל `CustodyService.setHold`. |
| 223 עד 230 | `updatedAt` רק אם משהו השתנה, והחזרת הפריט המלא. | |
| 236 עד 253 | `listDisputes` ו `listTransactions`. | בלי `limit`. העסקאות ממוינות לפי `executed_at` אבל מחזירות `created_at`. |
| 255 עד 276 | `openDispute`, מוודא שהעסקה קיימת ומכניס מחלוקת עם קוד `DSP`, `openedBy` ו `assignedAdminId`. | שתי קריאות בלי טרנזקציה, בטוח כי עסקאות לא נמחקות. בלי תקרת אורך להערה. |
| 278 עד 289 | `updateDispute`, סטטוס ופסיקה. | אין מכונת מצבים, `closed` יכול לחזור ל `open`. לא נרשם מי שינה. לפסיקה אין שום השפעה כספית. |
| 295 עד 374 | `runStorageFees`, המודל הישן, חיוב שטוח לכל פריט `stored` מעבר ל `thresholdDays` ושורת `storage_fee_run`. | קוד מת מסוכן. ההערה טוענת שה worker קורא לו, אבל אין קורא, וה worker מריץ SQL משלו. בלי idempotency ובלי כיסוי מנוי, הרצה כפולה מחייבת פעמיים. זו הסיבה היחידה להזרקת `PricingService` ו `LedgerService`. |
| 376 עד 378 | `listStorageFeeRuns`. | בלי `limit`, וכל שורה נושאת מערך jsonb של כל מה שחויב. |
| 392 עד 411 | `recentLogins`, הניסיונות האחרונים עם פרטי המשתמש, `limit` בין 1 ל 500 וברירת מחדל 200. | ה join עם cast מפורש ל text, מזהה שגוי לא מפיל אבל לא משתמש באינדקס. חושף כתובות IP ו user agent. |
| 413 עד 442 | ספירות של 24 שעות עם `FILTER`, הצלחות, כישלונות וכתובות IP שונות, ומזהים עם חמישה כישלונות או יותר ב `HAVING`. | הרשימה האחרונה בלי `limit`, אבל חסומה במספר המזהים שנוסו. |

**שים לב.** אין הפרדה בין סוגי מנהלים ואין אישור של אדם שני. מנהל יכול להעביר כל פריט לעצמו, והעקבה היחידה היא `custody_event` עם `actor_id`. מחיקת `runStorageFees` מאפשרת להסיר את ההזרקות של `PricingService` ו `LedgerService`. `limit` לרשימות דורש שינוי בממשק המנהל שמניח שהכול מגיע. כתיבת `bin_transfer` בשינוי מדף תתקן את `shelf-yield`, בדקו את `adm-shelf-yield.test.ts`.

#### `apps/api/src/modules/adm/shelf-yield.service.ts`
דוח למנהל שמחשב הכנסה לכל חודש מדף, לפי מדף, אזור ולקוח. הצד השני של `Break-Even Watch`, אותם חיובים מקובצים לפי מדף. זו הכנסה ולא רווח, עלויות אינן במסד. החישוב בזיכרון, והבדיקות ב `tests3/integration/adm-shelf-yield.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 32 עד 64 | `ShelfYieldRow` עם מדף, אזור, קוד מתקן, oversized, פעיל, מספר פריטים, ימי מדף, הכנסה, הכנסה לחודש מדף, `deadItemCount` של פריטים שלא הרוויחו, ו `oldestItemDays`. `CustomerYieldRow` באותם מונחים ללקוח. חודש של 30 יום. | `revenuePerSlotMonthMinor` הוא `null` כשאין ימים. |
| 85 עד 97 | `revenueByItem`, סכום חיובים במצב `settled` לפי `reference_id`, קליטה, אחסון, שירותים ומשלוח. | `inArray` על כל המזהים, פרמטר לכל אחד, נשבר מעל 65535 פריטים. ההכנסה לכל חיי הפריט, מכל בעלים ומדף. |
| 99 עד 115 | עמלת השוק, `ledger_record` מסוג `fee` עם `reference_type` של `listing`, ו join ל `listing.item_id`. | בלי זה כל קלף שנמכר נראה מת. דמי מנוי לא נזקפים לפריט, ולכן פריטים מכוסים נראים מתים והמנוי נראה מסובסד. |
| 129 עד 157 | `slotDaysByItem`, ההגעה האחרונה מ `bin_transfer` לכל פריט, וימים שלמים מאז. | נכון רק אם כל הזזה נרשמת ב `bin_transfer`, ועריכת מנהל לא רושמת. |
| 159 עד 162 | `perSlotMonth`, `null` כשאין ימים, אחרת הכנסה כפול 30 חלקי ימים. | מונע חלוקה באפס. |
| 168 עד 194 | `byShelf`, איסוף. פריטים עם מדף במצבים `stored`, `listed`, `on-hold`, ובמקביל הכנסה, ימי מדף וכל המדפים עם קוד המתקן. | שלוש שאילתות מלאות בכל בקשה, בלי מטמון. |
| 196 עד 253 | צבירה לכל מדף עם נפילה לימים מאז `received_at` כשאין `bin_transfer`, שורה לכל מדף כולל ריקים ולא פעילים, מיון תפוסים מהגרוע לטוב, וסכומים על התפוסים בלבד. | הכנסה לכל החיים מול ימים על המדף הנוכחי, ולכן פריט ותיק שהועבר אתמול הופך מדף לרווחי מאוד. חלון זמן להכנסה ישנה את `deadItemCount` ואת הבדיקות. |
| 256 עד 279 | `byZone`, מקבץ את `byShelf` לפי מתקן ואזור. | |
| 292 עד 340 | `byCustomer`, פריטים על מדפים עם שם ומייל בעלים, צבירה לפי בעלים ומיון מהגרוע לטוב. | מסנן fixture עם המחרוזת `@fixture.bault.test` שכתובה ידנית ולא עם `FIXTURE_EMAIL_DOMAIN`. `innerJoin` עם cast מרומז, `owner_id` לא חוקי מפיל את הדוח ופריט של משתמש שלא קיים נעלם. |

**שים לב.** העברת הצבירה ל SQL עם `GROUP BY bin_id` ו join ל `charge` תפתור את מגבלת הפרמטרים ואת הזיכרון. החלפת המחרוזת הידנית בקבוע `FIXTURE_EMAIL_DOMAIN` היא שינוי בטוח.

#### `apps/api/src/modules/adm/adm.controller.ts`
דפוס P2 תחת `/admin` עם `@Roles('admin')` ברמת המחלקה בשורה 44, כך שכל נתיב חדש מוגן כברירת מחדל. `RolesGuard` קורא עם `getAllAndOverride`, ולכן `@Roles` על מתודה ידרוס את המחלקה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 18 | `UpdateUserDto`, `role` מתוך שלושה, `status` מתוך ארבעה, שמות עם `NAME_PART_MAX`. | `username` חסר בכוונה. עם `forbidNonWhitelisted`, שליחת `username` או `passwordHash` מחזירה 400. |
| 20 עד 29 | `UpdateItemDto`, `typeClass`, `description`, `conditionGrade`, `ownerId`, `binId` כמחרוזות, `lifecycleState` מתוך שמונה, `holdFlag`. | אין `IsUUID` על `ownerId` ו `binId`, וזה שורש בעיות `updateItem`. ברקוד מדף שהוקלד כאן שובר את הכספת של הבעלים. בדקו את מסך הפריטים ב `apps/web` לפני שמוסיפים `IsUUID`. |
| 31 עד 40 | `OpenDisputeDto`, `UpdateDisputeDto`. | בלי תקרות אורך. |
| 62 עד 83 | `GET shelf-yield`, `shelf-yield/zones`, `shelf-yield/customers`, `logins`. | `logins` לא ברשימת `ADMIN_ONLY` של `sec-authorization.test.ts`, אבל מוגן במחלקה. |
| 85 עד 107 | `GET users`, `PATCH users/:id` עם מזהה המנהל להגנה העצמית, `GET items`, `PATCH items/:id` עם המנהל ל `actor_id`. | |
| 111 עד 130 | `GET` ו `POST disputes`, `PATCH disputes/:id`, `GET transactions`. | `PATCH disputes/:id` לא מעביר את המנהל לשירות. |
| 134 עד 137 | `GET storage-fee-runs`, קריאה בלבד. | `tests/integration/adm-pricing-storage.test.ts` מוודא ש POST מחזיר 404. |

**שים לב.** פיצול `@Roles('admin')` למתודות בודדות יפתח כל נתיב חדש שישכח את הדקורטור לכל משתמש מחובר. אין `@Public` באף נתיב, ו `SessionAuthGuard` דורש סשן לפני ההרשאה.

## פרק 6. השוק, התראות, שירותים על פריט מאוחסן ומשלוחים

### סקירה

ארבעה מודולים שלוקחים פריט שכבר בכספת ומשנים בו משהו, בעלים, מצב או מקום.

- `mkt` הוא השוק. רשימות, רכישה ישירה, הצעות מחיר, החלפות ומתנות, וחנות הבית של Bault. כאן כסף ובעלות זזים באותה טרנזקציה.
- `not` הוא ההתראות. כל שירות כותב שורת `outbox_message` באותו `tx` של השינוי, וה worker ב `apps/worker/src/jobs/outbox-dispatch.ts` הופך אותה להתראה ולאימייל.
- `dis` הוא כל שירות שאפשר לבקש על פריט מאוחסן. כולם עטיפות סביב `service_request` ו `ServiceRequestService`.
- `shp` הוא משלוח החוצה. קבצי נתונים טהורים בתחתית, `ParcelProfileService` ו `ShipmentService` באמצע, `DispatchService` שקונה תווית למעלה.

סדר קריאה. `purchase.service.ts` ו `outbox.service.ts` קודם, הם הדוגמה הנקייה של P3. אחר כך שאר `mkt`, אחר כך `service.service.ts` ואז שאר `dis`, ובסוף `shp` מהקטלוגים אל `shipment.service.ts`. כל הבקרים כאן מאמתים גוף עם DTO של class-validator דרך ה `ValidationPipe` הגלובלי, לא zod. החולשה המשותפת היא `CustodyService.transferOwnership`, שלא בודק מי הבעלים הנוכחי, E4. החולשה השנייה היא בדיקת יתרה או סטטוס מחוץ לטרנזקציה ו UPDATE בלי תנאי, E1 ו E18. מלכודת שלישית יושבת ב `cst/lifecycle.ts` שורה 42. `assertTransition` מחזיר בשקט כשהמצב הנוכחי שווה לחדש, ולכן `changeState` של `sold` ל `sold`, `consigned` ל `consigned` או `donated` ל `donated` לא זורק. לחיצה כפולה שעוברת בדיקה לא נעולה לא נעצרת שם, וזו הסיבה לרוב הזיכויים הכפולים בפרק.

### השוק, `mkt`

שלושה מסלולי כסף בשוק, וכל אחד רושם אחרת. רכישה ישירה ב `purchase.service.ts` כותבת שלוש שורות ledger עם `referenceType: 'listing'`, ועמלה שאף חשבון לא מקבל. חנות הבית ב `house-store.service.ts` כותבת `transaction` קודם ושתי שורות עם `referenceType: 'transaction'`, וזיכוי לחשבון הפלטפורמה. החלפה ב `trade.service.ts` לא מזיזה כסף בין הצדדים, רק חיוב שירות דרך `BillingPort` שמייצר `charge`. דוח שמצליב ledger עם `transaction` צריך לדעת את שלוש המוסכמות. הצעות לא מקפיאות כסף, ורק קבלה שעוברת דרך `PurchaseService` מזיזה אותו. כל שינוי בעלות עובר דרך `CustodyService` וכותב `custody_event`, שמוגן ב trigger append only.

#### `apps/api/src/modules/mkt/purchase.service.ts`
רכישה ישירה של רשימה. היחיד שמזיז כסף ובעלות יחד. נקרא מ `mkt.controller.ts` ומ `OfferService.accept`. דפוס P3 במלואו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 31 | `PurchaseResult`, ארבעה שדות ו `replayed` אופציונלי | `OfferService.accept` ו `MarketplacePage.tsx` מפרקים את הצורה |
| 65 עד 85 | חתימה ואידמפוטנטיות. endpoint הוא `purchase:${listingId}`, `lookup` מחזיר תשובה שמורה עם `replayed: true` | `lookup` לא כולל משתמש. עם המפתח `offer-${offerId}` שהמוכר מכיר, המוכר מקבל replay של עסקת הקונה, דליפת `transactionId` ומחיר |
| 87 עד 99 | `db.transaction`, נעילת `listing` `FOR UPDATE` בשורה 88, בדיקת `active` עם 409, איסור self dealing עם 403, נעילת `item` בשורה 97, דחיית hold | זה מה שמונע כפל מכירה. סדר הנעילה רשימה ואז פריט זהה ל `ListingService.confirmRemove`, הפיכתו תיצור deadlock. חסרות בדיקות `it.ownerId === l.sellerId` ו `lifecycleState === 'listed'`, פריט שעבר בהחלפה יימכר מהבעלים החדש, E4 |
| 101 עד 118 | מחיר מ `priceOverride` או `askingPrice`, אף פעם לא מהלקוח. עמלה מ `pricing.price('marketplace_fee')`, ויתור דרך `memberships.waive` באותו `tx` | בלי חוק מחיר הרכישה נכשלת ב 400, E6. הוויתור אוכף תקרה ב SQL |
| 120 עד 141 | `balanceOf` על `ledger_record`, ואז שלוש שורות ledger, חיוב קונה, זיכוי מוכר, חיוב עמלה מהמוכר | היתרה לא נעולה, E1. `referenceType` הוא `listing` ולא `transaction`. העמלה לא מזוכה לאף חשבון פלטפורמה, בניגוד לחנות הבית |
| 143 עד 148 | `transferOwnership` לקונה, `changeState` מ `listed` ל `stored`, רשימה ל `sold` | `actorId` באירוע המשמורת הוא הקונה גם כשהמוכר לחץ על קבלת הצעה |
| 150 עד 177 | שורת `transaction` עם קוד `TXN-` ו `frozenPricing`, ואז `outbox.emit` של `item_sold` | ה worker בוחר `sellerId` כנמען, הקונה לא מקבל התראה. אין אינדקס ייחודי על `transaction.code` והטבלה לא מוגנת ב trigger append only |
| 180 עד 182 | שמירת תשובת האידמפוטנטיות מחוץ לטרנזקציה | קריסה בין COMMIT לשמירה גורמת לניסיון חוזר לקבל 409 על רכישה שהצליחה |

**שים לב.** אף הצעה פתוחה על הרשימה לא נסגרת במכירה. היא נשארת `pending` לנצח ו `accept` שלה ייכשל ב 409.

**למה הנעילה עובדת.** ב READ COMMITTED טרנזקציה שמחכה על `FOR UPDATE` מקבלת אחרי השחרור את הגרסה החדשה של השורה. הקונה השני רואה `sold` וזורק 409 בשורה 90. בלי `FOR UPDATE` שתי הטרנזקציות היו קוראות `active`. `tests/concurrency/no-double-sale.test.ts` מוכיח את זה. אין test לשתי רכישות מקבילות של אותו קונה.

**כיוון תיקון.** ל E1, `pg_advisory_xact_lock` על hash של `buyerId` או `SELECT ... FOR UPDATE` על שורת `user_account` של הקונה לפני `balanceOf`. לבעלות, אחרי נעילת הפריט לדרוש `ownerId === sellerId` ו `lifecycleState === 'listed'`, אחרת 409 וסימון הרשימה `removed`. להצעות יתומות, `UPDATE offer SET status = 'rejected' WHERE listing_id = ? AND status = 'pending'` באותו `tx`, וכך גם ב `confirmRemove`. ל replay זר, להוסיף `userId` לתנאי של `IdempotencyService.lookup`. את חלון הפיצול בין COMMIT לשמירת המפתח אפשר לסגור בשמירת המפתח בתחילת הטרנזקציה עם `INSERT ... ON CONFLICT DO NOTHING RETURNING`, וקריאת השורה הקיימת אם לא חזרה שורה.

#### `apps/api/src/modules/mkt/listing.service.ts`
מחזור החיים של רשימה, יצירה, שינוי מחיר והסרה דו שלבית. נקרא רק מ `mkt.controller.ts`. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 27 | ייבוא, `CustodyService`, `ConfirmationService`, הטבלאות | |
| 28 עד 45 | `create` בתוך `custody.run`. נועל פריט, בודק קיום, בעלות, hold ומצב `stored`, `changeState` ל `listed`, מכניס `listing` פעיל | בדיקת `stored` בשורה 34 היא ההגנה היחידה מפני שתי רשימות פעילות על פריט, אין אינדקס ייחודי חלקי. `listing.item_id` הוא text ו `item.id` הוא uuid, ולכן כל join כותב `item.id::text` |
| 47 עד 54 | `reprice` קורא בלי נעילה ומעדכן מחיר | ה UPDATE בלי תנאי `status`, ושינוי מחיר שחיכה לנעילת רכישה נכתב על רשימה `sold` |
| 56 עד 64 | `requestRemove` בודק בעלות ו `active`, מנפיק אתגר `listing_removal` | ה token חי 300 שניות |
| 66 עד 79 | `confirmRemove` צורך את ה token, ואז טרנזקציה, נעילת רשימה, `removed`, החזרת הפריט ל `stored` | `consume` שורף את ה token לפני הטרנזקציה. שם הפעולה חייב להיות זהה ב 62 וב 69. הצעות פתוחות לא נדחות |

**שים לב.** הסרה דו שלבית ורכישה בלי אישור נראות הפוכות לסיכון, כי הסרה הפיכה ורכישה לא. כך כתובות הדרישות. שינוי המצב שהפריט חוזר אליו בהסרה ייכשל ב `assertTransition`, כי `listed` מותר רק ל `stored`, `sold` ו `on-hold`. עמודה חדשה ב `listing` דורשת מיגרציה, `mkt.schema.ts` רק מצהיר.

#### `apps/api/src/modules/mkt/browse.service.ts`
גלישה ציבורית ודף פרטים. שני המסלולים פתוחים לאורח. נקרא מ `mkt.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 46 | ייבוא, `BrowseSort`, `BrowseFilters`, הזרקת `STORAGE_ADAPTER` | אין ולידציה כאן, סומך על הבקר |
| 47 עד 90 | `list`. תנאי `status = 'active'`, `ILIKE` על תיאור ומחלקה, סינון מחלקה, מצב ומחיר, מיון, join ל `item`, `limit` עד 200, ואז תמונה חתומה לכל שורה | אין pagination, מה שמעבר ל 200 לא נגיש. N ועוד 1 שאילתות תמונה במסלול ציבורי. מיון מחיר בלי tie break. `%` ו `_` ב `q` לא מוסטים |
| 92 עד 111 | `detail`. `select()` מלא של `listing` ו `item`, וכל התמונות חתומות | חושף לאורח `ownerId`, `binId`, `holdFlag`, `sellerId` ומקורות קליטה. אין בדיקת `active`, רשימה שנמכרה עדיין נגישה |
| 113 עד 122 | `newestImageUrl`, תמונה אחת לפי `version desc` וחתימה | URL חתום תקף 300 שניות |

**שים לב.** התיקון ל `detail` הוא הקרנה מפורשת כמו ב `list`. מעבר ל keyset pagination על `published_at` ו `id` משנה את צורת התשובה ממערך לאובייקט ושובר את `MarketplacePage.tsx`. שאילתת תמונות אחת עם `DISTINCT ON (item_id)` מבטלת את ה N ועוד 1. סינון חדש דורש שינוי גם בפרסור ב `mkt.controller.ts`.

#### `apps/api/src/modules/mkt/market-read.service.ts`
צד הקריאה של משתמש מחובר. פתרון שם משתמש, פריט לפי מספר סידורי, הרשימות, ההצעות וההחלפות שלי, וחנות ציבורית. קריאה בלבד. נקרא מ `mkt.controller.ts` ו `trade.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 39 | ייבוא, `normalizeUsername`, הערה על ההיסטוריה | |
| 40 עד 60 | `counterparty`. מנרמל שם, מחזיר id ושם מלא. 404 לא נמצא, 400 לעצמך, 400 לחשבון לא `active` | ה oracle היחיד לקיום שם משתמש. מאחורי session ו throttler |
| 77 עד 112 | `tradableItem`. `counterparty` ואז פריט לפי בעלים ומספר סידורי מדויק. דוחה פריט לא `stored` או עם hold | אותה תשובה לפריט שלא קיים ולפריט של אחר. הבדיקה בזמן חיפוש בלבד, `TradeService.approve` לא חוזר עליה |
| 120 עד 158 | `myListings`. כל הרשימות של המוכר כולל `sold`, ואז ספירת `pending` לכל רשימה ב `GROUP BY` אחד | `count(*)::int` כי bigint חוזר כמחרוזת. הספירה כוללת הצעות יתומות על רשימות שנמכרו |
| 174 עד 217 | `myOffers`. join של `offer`, `listing`, `item` ו left join לקונה. גוזר `side` ו `yourTurn = proposedBy !== side` | `yourTurn` משכפל את `OfferService.assertNotProposer`. שינוי באחד בלי השני שובר את ה UI. `buyerUsername` נחוץ ל `SellerPanels.tsx` |
| 226 עד 290 | `mySwaps`. שלוש שאילתות, הצעות, משתמשים, פריטים. מתנה היא `requested` ריק, `awaitingMe` רק למשיב שלא אישר | מזהים ב jsonb נקראים עם cast בלי ולידציה |
| 300 עד 328 | `storefront` ציבורי, רשימות פעילות של מוכר | בוחר `status` של המוכר ולא משתמש בו. חנות של חשבון מושעה נשארת פתוחה |

**שים לב.** זה המקום שבו ההקרנה מוקפדת, ובו uuid של משתמש לא נחשף לצד השני. הסרת `buyerUsername` שוברת את `SellerPanels.tsx`. הפיכת `storefront` לפרטי שוברת את `StorefrontPanel.tsx` שקורא בלי session. מזהי פריטים ב `swap_proposal` הם jsonb בלי FK, ולכן אין join, ושלוש שאילתות עם `inArray` הן הפתרון.

#### `apps/api/src/modules/mkt/offer.service.ts`
משא ומתן על מחיר. הצעה, קבלה, דחייה והצעה נגדית משני הצדדים. הכלל המרכזי, מי שנקב במחיר לא יכול לקבל אותו, נשען על העמודה `proposed_by` ממיגרציה 0020. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 42 | ייבוא, הערת הכלל, הזרקת `PurchaseService` | |
| 43 עד 95 | `submit`. רשימה `active` בלי נעילה, לא שלך, לא מעל המחיר המבוקש, `assertCanCover`, `assertNoOpenOffer`, ואז טרנזקציה עם insert של `proposedBy: 'buyer'` ו outbox `offer_received` | התנגשות על האינדקס `offer_one_open_per_buyer` בהצעות מקבילות יוצאת 500 ולא 409. חלון בין בדיקת `active` ל insert משאיר הצעה יתומה |
| 105 עד 114 | `loadParticipating`. הצעה ואז רשימה, 403 למי שאינו צד, 409 להצעה שאינה `pending`, מחזיר את הצד | זו בדיקת ההרשאה היחידה, הבקר לא בודק |
| 123 עד 128 | `notPending`, הודעה לפי סטטוס | |
| 138 עד 145 | `assertNotProposer`, 403 כש `side === proposedBy` | חייב להישאר זהה ל `yourTurn` ב `market-read.service.ts` |
| 147 עד 182 | `assertNoOpenOffer` ו `assertCanCover` | היתרה נבדקת ולא מוקפאת. אפשר להציע את אותו כסף על עשר רשימות |
| 184 עד 212 | `accept`. טוען, אוכף את הכלל, בודק יתרה, קורא `purchase.purchase` עם `o.buyerId` ו `o.amount`, ורק אחרי הצלחה מסמן `accepted` מחוץ לטרנזקציה | הסדר רכישה ואז סימון מכוון. היפוכו מחזיר באג ישן. ההצעה מתבצעת בסכום שלה גם אם המוכר הוריד מחיר |
| 223 עד 227 | `reject`, כל צד, מסמן `rejected` | אין outbox, הצד השני לא שומע |
| 237 עד 278 | `counter`. קונה מוגבל למחיר המבוקש ונבדקת לו יתרה. טרנזקציה מסמנת `countered` ומכניסה ילד עם `parentOfferId` ו `proposedBy: side`, ו outbox `offer_countered` | ה worker לא קורא `counteredBy` ובוחר `sellerId` ראשון. הצעה נגדית של המוכר נשלחת למוכר עצמו והקונה לא שומע |

**שים לב.** הוספת סטטוס ל `offer_status` דורשת מיגרציה של enum ולא רק שינוי ב `mkt.schema.ts`. תיקון הנמען של `offer_countered` הוא להעביר `recipientIds` עם הצד השני במפורש, כי ה worker לא מכיר `counteredBy`. המחיר נבדק מול יתרה בשלושה מקומות, הצעה, הצעה נגדית של קונה וקבלה, ובכל אחד בלי נעילה. רק הנעילה ב `PurchaseService` מבטיחה שהרשימה לא תימכר פעמיים.

#### `apps/api/src/modules/mkt/offer.controller.ts`
דפוס P2. שני מסלולים, ההרשאה על ההצעה עצמה נבדקת בשירות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 15 | `SubmitOfferDto` עם `amount` שלם וחיובי. `RespondDto` עם `action` מתוך `accept`, `reject`, `counter`, ו `amount` אופציונלי | `forbidNonWhitelisted` דוחה כל שדה נוסף ב 400 |
| 23 עד 26 | `POST marketplace/listings/:id/offers` אל `submit` עם `user.id` כקונה | אין `@Roles`, גם אדמין ומפעיל יכולים להציע |
| 28 עד 39 | `POST marketplace/offers/:offerId/respond`. `accept` עם הכותרת `idempotency-key` או `offer-${offerId}`, `reject`, ו `counter` שדורש `amount` | המפתח `offer-${offerId}` ידוע למוכר, וזה מה שמאפשר replay זר ב `PurchaseService`. שינוי ברירת המחדל משנה את התנהגות ה replay בקבלה |

#### `apps/api/src/modules/mkt/trade.service.ts`
החלפות ומתנות על טבלת `swap_proposal` אחת. מתנה היא החלפה עם `requestedItemIds` ריק. דפוס P3, אבל הוולידציה רצה רק בהצעה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 34 | ייבוא, הזרקת `BILLING_PORT` ו `ConfirmationService` | |
| 35 עד 61 | `proposeSwap`. דוחה החלפה עם עצמך, `assertOwnedStoredUnheld` לשני הצדדים מחוץ לטרנזקציה, insert עם `proposerApproved: true`, outbox `swap_proposed` ל `responderId` | אין dedupe ואין תקרת אורך. `[a, a]` יכתוב שני אירועי משמורת |
| 63 עד 85 | `initiateTransfer` מנפיק token עם פריט ונמען. `confirmTransfer` צורך אותו ומכניס הצעה עם `requested` ריק | בלי טרנזקציה ובלי outbox. המקבל לא יודע שמחכה לו מתנה |
| 87 עד 101 | `approve`, חלק ראשון. נעילת ההצעה `FOR UPDATE`, `pending`, סימון אישור המשיב, 403 לזר, `DUAL_CONSENT_REQUIRED` כשחסר אישור | ה UPDATE לפני ה throw מתגלגל אחורה, קוד מת |
| 103 עד 113 | ביצוע. `transferOwnership` לכל פריט מוצע אל המשיב ולכל מבוקש אל המציע | אין בדיקה חוזרת של בעלות, `stored` או hold. פריט שנמכר או הוקפא בינתיים עובר למשיב, E4. `changeState` לא נקרא, ופריט `listed` נשאר עם רשימה פעילה של הבעלים הקודם |
| 115 עד 117 | `billing.charge` עם `actionType: 'service'` למציע, ולמשיב רק בהחלפה | יתרה שלילית מותרת שם. בלי חוק מחיר ההחלפה נכשלת |
| 119 עד 142 | `transaction` מסוג `swap` או `transfer` בלי מחיר, סימון `executed`, outbox `swap_completed` או `transfer_completed` עם `recipientIds` לשני הצדדים | |
| 144 עד 150 | `reject`. בודק השתתפות ומסמן `rejected` | אין בדיקת סטטוס. החלפה `executed` הופכת ל `rejected` וההיסטוריה סותרת את `custody_event` |
| 152 עד 161 | `assertOwnedStoredUnheld`, שאילתה לכל פריט בלי נעילה | |

**כיוון תיקון.** בתוך הטרנזקציה של `approve`, לנעול כל פריט ולדרוש `ownerId` של הצד הנכון, `stored` ובלי hold. כי throw מגלגל אחורה, סימון ההצעה `rejected` אחרי כישלון חייב לרוץ בטרנזקציה נפרדת. ב `reject` להוסיף `FOR UPDATE` ובדיקת `pending`. את `confirmTransfer` לעטוף בטרנזקציה ולשגר `swap_proposed`. להוסיף `ArrayMaxSize`, `IsUUID({ each: true })` ו `new Set` לפני השימוש. `tests/integration/mkt-swap-transfer.test.ts` מכסה רק את המסלול הראשי.

**למה מתנה היא החלפה.** חוסך טבלה ובקר, ומסביר למה המקבל מאשר דרך `swaps/:id/approve`. המחיר הוא שכל שאילתה גוזרת את הסוג מאורך `requestedItemIds`. אישור דו שלבי יש רק למתנה, כי היא חד צדדית.

#### `apps/api/src/modules/mkt/trade.controller.ts`
דפוס P2. שישה מסלולים תחת `marketplace`. הלקוח שולח שמות משתמש ומספרים סידוריים, לא uuid של משתמש.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 28 | `ProposeSwapDto` עם `responderUsername` ושני מערכים לא ריקים, `InitiateTransferDto` עם `itemId` ו `toUsername`, `ConfirmTokenDto` | אין `ArrayMaxSize` ואין `IsUUID`. מזהה שאינו uuid מגיע ל Postgres |
| 40 עד 49 | `GET swaps` אל `mySwaps`. `POST swaps` פותר את המשיב דרך `counterparty`, שדוחה את עצמך וחשבון לא פעיל, ואז `proposeSwap` | |
| 51 עד 59 | `POST swaps/:id/approve` ו `reject` עם `user.id` | אישור מתנה בצד המקבל עובר גם הוא כאן |
| 61 עד 70 | `POST transfers` פותר נמען ומנפיק token. `POST transfers/confirm` צורך אותו | |

#### `apps/api/src/modules/mkt/house-store.service.ts`
החנות של Bault. רשימה מתארת מוצר ומלאי, ורכישה מטביעה פריט חדש. החצי הפיזי הוא תור `house_order` שמפעיל סוגר. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 81 | ייבוא, `PLATFORM_EMAIL` בשורה 22, טיפוסי קלט ותוצאה, הערת עיצוב | |
| 82 עד 106 | `listForSale` ציבורי, `active` עם מלאי חיובי בהקרנה מפורשת. `listAll` לאדמין עם `select()` מלא | |
| 109 עד 147 | `create` בודק מחלקת פריט ותיאור ומכניס עם קוד `HSE-`. `update` הוא patch של מחיר, מלאי וסטטוס | המלאי נכתב כערך מוחלט. עדכון שחיכה לנעילת רכישה דורס את ההפחתה שלה |
| 153 עד 175 | `purchase`, אידמפוטנטיות ו `randomUUID()` כשאין כותרת, endpoint `house-purchase:${listingId}`, נעילת המוצר ובדיקת `active` ו `stock > 0` | בלי כותרת מהלקוח אין אידמפוטנטיות בכלל |
| 176 עד 205 | חשבון פלטפורמה, איסור קנייה מעצמה, יתרה, `createWithIntake` של פריט במצב `received` בלי bin, הקונה כבעלים | היתרה לא נעולה, E1 |
| 207 עד 242 | `transaction` מסוג `sale` עם `sellerId` של הפלטפורמה, חיוב קונה וזיכוי פלטפורמה עם `referenceType: 'transaction'`, `stock - 1` תחת הנעילה | כאן הפלטפורמה מזוכה, ב `purchase.service.ts` לא. שתי מוסכמות `referenceType` לאותו סוג רשומה |
| 244 עד 267 | `house_order` עם קוד `ORD-`, החזרת סדרתי וברקוד, שמירת אידמפוטנטיות | אין outbox לרכישה |
| 274 עד 297 | `queue`, הזמנות `awaiting_stow` מהישנה עם פריט, מוצר וקונה | |
| 307 עד 357 | `stowOrder`. נעילת הזמנה, `resolveShelf`, `relocate`, `changeState` ל `stored`, תמונות ל `item_image`, סימון `stowed`, outbox `item_received` | `objectKey` של התמונות לא נבדק מול האחסון. `relocate` דוחה hold |
| 359 עד 370 | `resolveShelf`, bin לפי id או ברקוד, או `stow.suggest` | רץ על `this.db` ולא על `tx`. `relocate` לא בודק קיבולת |
| 372 עד 380 | `platformAccountId` לפי אימייל קבוע | בלי seed או אחרי שינוי האימייל החנות נופלת ב 400, E6 |

**שים לב.** הפריט נוצר `received` ולא `stored` בכוונה. שינוי ל `stored` יאפשר למכור פריט שעוד לא על מדף.

**כיוון תיקון.** למלאי, `stock = stock + delta` במקום ערך מוחלט, או נעילה וקריאה לפני כתיבה, ה `CHECK (stock >= 0)` ממיגרציה 0026 כבר שומר מפני מינוס. לחשבון הפלטפורמה, משתנה סביבה או דגל `is_platform`. `tests/integration/mkt-house-store.test.ts` מוכיח שהפריט נוצר ברגע התשלום ושהניהול סגור לאדמין והשימה לצוות.

**שים לב.** האינדקס `house_order_status_idx` ממיגרציה 0026 מכסה בדיוק את שאילתת `queue`. תמונות שהמפעיל מצרף בשימה נשמרות כגרסאות ב `item_image` עם `type: 'intake'`, ו `mkt/browse.service.ts` יחתום עליהן כמו על תמונת קליטה רגילה.

#### `apps/api/src/modules/mkt/house-store.controller.ts`
דפוס P2 תחת `marketplace/house`, עם שלוש רמות הרשאה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 42 | `CreateHouseListingDto` עם תיאור עד 300, מצב עד 40, `photoRef` בתבנית תווים בטוחים, מחיר חיובי ומלאי לפחות 1. `UpdateHouseListingDto` עם מלאי לפחות 0 וסטטוס. `StowHouseOrderDto` עם `binId`, `autoStow` ועד שישה מפתחות תמונה | `binId` ומפתחות התמונה בלי תקרת אורך |
| 51 עד 64 | `GET listings` ציבורי. `POST listings/:id/purchase` לכל מחובר עם כותרת אידמפוטנטיות אופציונלית | `HouseStorePanel.tsx` שולח מפתח, בלעדיו אין הגנה מלחיצה כפולה |
| 66 עד 82 | `GET manage`, `POST listings`, `PATCH listings/:id`, כולם `@Roles('admin')` | הסרת `@Roles` מ `PATCH` תפתח מחיר ומלאי לכל משתמש. `HouseStoreSection.tsx` קורא ל `manage` |
| 84 עד 94 | `GET orders/queue` ו `POST orders/:id/stow` למפעיל או אדמין | `HouseOrdersPanel.tsx` הוא הצרכן |

#### `apps/api/src/modules/mkt/mkt.controller.ts`
הבקר הראשי של השוק. דפוס P2, עם ניתוח query ידני.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 41 | `BROWSE_SORTS`, שלושה DTO, הזרקת ארבעה שירותים | |
| 42 עד 65 | `GET listings` ציבורי. מפרסר מחירים, `sort` עם fallback ל `newest` | `limit` הוא `Number(limit)` בלי בדיקה. `abc` או `-1` מגיעים ל SQL ומחזירים 500 |
| 70 עד 83 | `GET listings/mine` ו `GET offers/mine` | חייבים להיות מוגדרים לפני `listings/:id`, אחרת `:id` תופס את `mine` |
| 84 עד 109 | `GET collectors/:username` ו `GET collectors/:username/items/:serial` אל `MarketReadService` | ההערות בשורות 94 עד 101 התערבבו, הקוד נכון |
| 111 עד 141 | `GET sellers/:username` ציבורי, `POST listings`, `GET listings/:id` ציבורי, `PATCH listings/:id`, `POST listings/:id/remove`, `POST listings/remove/confirm` | |
| 143 עד 150 | `POST listings/:id/purchase` עם כותרת או `purchase-${user.id}-${id}` | ברירת מחדל עם מזהה המשתמש היא מה שמונע replay זר כאן. אל תקצר אותה |

**שים לב.** אין DTO ל query ואין `ParseIntPipe`. חצי מהפרמטרים מוגנים, `sort` עם fallback ומחירים עם בדיקת אי שליליות, והחצי השני לא. הוספת סינון דורשת שינוי כאן וב `BrowseService.list` יחד. העברת `detail` מעל `mine` תחזיר 404 על `GET listings/mine`.

#### `apps/api/src/modules/mkt/mkt.module.ts`
דפוס P1. ארבעה בקרים ושבעה שירותים, בלי `imports` ובלי `exports`. כל התלויות, `CustodyService`, `PricingService`, `LedgerService`, `OutboxService`, `IdempotencyService`, `ConfirmationService`, `MembershipService`, `BILLING_PORT`, מגיעות ממודולים גלובליים. `StowService` מ `cst` עובד רק כי `CstModule` מייצא אותו.

**תלויות `mkt`.** קורא החוצה ל `cst/custody.service.ts`, `cst/stow.service.ts`, `prc/pricing.service.ts`, `pay/ledger.service.ts`, `BILLING_PORT`, `mem/membership.service.ts`, `shared/idempotency`, `shared/confirmation`, `shared/adapters` ל URL חתום, `inv/item-classes.ts` ו `inv/labels.ts` להטבעת פריט, ו `not/outbox`. כותב `listing`, `offer`, `swap_proposal`, `transaction`, `house_listing`, `house_order`, `item`, `custody_event`, `bin_transfer`, `item_image`, `ledger_record`, `charge`, `membership_period`, `idempotency_key`, `confirmation_token`, `outbox_message`. הצרכנים ב SPA הם `apps/web/src/areas/customer/marketplace/*.tsx`, `apps/web/src/areas/admin/HouseStoreSection.tsx` ו `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx`.

### התראות ותוכן, `not`

#### `apps/api/src/modules/not/outbox/outbox.service.ts`
הכותב של ה outbox הטרנזקציוני. כל שירות משנה מצב במערכת קורא לו, בפרק הזה `purchase`, `offer`, `trade`, `house-store`, וכל שירותי `dis` ו `shp`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 6 עד 11 | `DomainEvent`, סוג ומזהה אגרגט, `eventType` ומטען | `eventType` הוא כל מחרוזת. שגיאת כתיב לא נתפסת, וה worker ירנדר משפט גנרי |
| 25 עד 32 | `emit` מכניס שורה ל `outbox_message` דרך ה `tx` שהקורא מעביר. `dispatchedAt` נשאר null | הפרמטר מטיפוס `Database`, כמו `this.db`. `emit(this.db, ...)` עובר קומפילציה ונכתב ב autocommit, ואז התראה נשלחת גם כשהשינוי מתגלגל אחורה |

**שים לב.** אין `attempts` ואין `last_error`. ה worker מסמן `dispatched_at` רק אחרי כל הנמענים, בלי `SKIP LOCKED` ובלי טרנזקציה לשורה, כך שקריסה באמצע משגרת שוב. הנמען נבחר לפי `recipientIds`, ואם אין, לפי המפתח הראשון שקיים מתוך `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`. סדר המפתחות במטען לא משנה, סדר הרשימה ב worker כן.

**מה ה worker עושה עם השורה.** פעם בדקה הוא קורא שורות עם `dispatched_at IS NULL` לפי `created_at`, דרך האינדקס החלקי `outbox_undispatched_idx` ממיגרציה 0024. לכל שורה הוא מרנדר משפט ב `notification-message.ts`, מוצא נמענים, כותב `notification` מסוג `in_app` אם ההעדפה דלוקה, שולח אימייל דרך `EmailAdapter` אם ההעדפה דלוקה והחשבון `active`, ורושם כישלון אימייל כ `notification` עם `status = 'failed'` בלי לזרוק. אין retry לאימייל. כל שגיאה אחרת מפילה את הריצה והשורה תישלח שוב בדקה הבאה. התיקון הוא טרנזקציה לכל שורה עם `FOR UPDATE SKIP LOCKED`, וכתיבת ההתראות ו `dispatched_at` יחד. הוספת `attempts` דורשת מיגרציה ושינוי ב SQL הגולמי של ה worker.

**אירועים שהמודולים כאן משגרים.** הנמען נקבע ב worker, `recipientIds` אם קיים, אחרת המפתח הראשון שקיים במטען לפי הסדר `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`.

| אירוע | נכתב ב | נמען בפועל |
|---|---|---|
| `item_sold` | `purchase.service.ts` שורה 170 | המוכר, הקונה לא מקבל |
| `offer_received` | `offer.service.ts` שורה 80 | המוכר |
| `offer_countered` | `offer.service.ts` שורה 263 | תמיד המוכר, גם כשהמוכר הציע, באג |
| `swap_proposed` | `trade.service.ts` שורה 53 | המשיב. `confirmTransfer` לא משגר |
| `swap_completed`, `transfer_completed` | `trade.service.ts` שורה 132 | שני הצדדים דרך `recipientIds` |
| `item_received` | `house-store.service.ts` שורה 340 | הקונה, כבעלים |
| `buyout_quoted`, `custom_request_raised`, `custom_request_quoted`, `custom_request_declined`, `grading_shipped`, `commons_removed` | שירותי `dis` | המבקש דרך `userId` |
| `item_donated` | `donation.service.ts` שורה 75 | התורם דרך `donorId` |
| `shipment_out`, `shipment_cancelled`, `shipment_expired`, `direct_ship_booked`, `white_glove_requested`, `white_glove_quoted`, `show_pickup_booked`, `handed_over`, `group_shipment_locked` | שירותי `shp` | בעל המשלוח דרך `userId` |

שם אירוע שלא רשום ב `event-types.ts` עדיין יגיע באפליקציה עם משפט גנרי, ולא יגיע באימייל.

#### `apps/api/src/modules/not/event-types.ts`
קטלוג סוגי האירועים שמשתמש יכול לקבל עליהם התראה. מסך ההעדפות נבנה ממנו, וה worker מחזיק עותק לפי ערך ב `apps/worker/src/notification-events.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 31 | `NOTIFICATION_CHANNELS` עם `in_app` ו `email`, `isKnownChannel`, חמש קטגוריות | ערוץ שלישי דורש גם שינוי ב `channelEnabled` ובשליחה של ה worker |
| 33 עד 56 | `NotificationEventType`, מפתח, קטגוריה, תווית, `emailByDefault`, `mandatoryInApp` | |
| 58 עד 132 | הקטלוג, 42 רשומות בשבע קבוצות. `parcel_damaged` ו `arrival_not_accepted` הם `mandatoryInApp` | הוספת אירוע נוגעת בארבעה מקומות, כאן, `EMAIL_BY_DEFAULT` ו `SUBJECTS` ב worker, `case` ב `notification-message.ts`, ותווית ב SPA. אף אחד לא נכשל בקומפילציה אם שכחת |
| 134 עד 161 | `BY_KEY`, `notificationEventType`, `isKnownEventType`, `defaultEnabled`, `isMandatory` | אירוע לא מוכר מגיע תמיד באפליקציה ולעולם לא באימייל |

**שים לב.** שינוי `emailByDefault` כאן בלי ה worker יגרום למסך להציג ברירת מחדל אחת ולשליחה לפעול לפי אחרת.

**שים לב.** `custom_request_*` מסווגים `custody` אף שהם בקבוצת השוק בקובץ, ו `escrow_*` מסווגים `marketplace`. מסך ההעדפות מקבץ לפי הקטגוריה ולא לפי המיקום בקובץ.

#### `apps/api/src/modules/not/notification.service.ts`
צד הקריאה של ההתראות והעדפות המשתמש. ה API לא כותב התראות, רק ה worker. העדפה היא opt out, אין שורה עד שמשתמש נוגע.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 35 | ייבוא, הערה על המעבר למטריצה מלאה ממיגרציה 0015 | |
| 36 עד 42 | `listMine`, כל ההתראות מהחדשה לישנה | בלי `limit` ובלי סימון כנקרא. שתי שורות לכל אירוע עם אימייל |
| 53 עד 79 | `getPreferences` בונה מטריצה של כל אירוע בקטלוג כפול ערוץ, עם `enabled`, `isDefault`, `mandatory`, ומחזיר גם את השורות הגולמיות | `isDefault` אומר שאין שורה, לא שהערך שווה לברירת המחדל. `NotificationsPage.tsx` ושני tests תלויים בצורה |
| 82 עד 121 | `setPreference`. ערוץ מוכר, אירוע מוכר, איסור כיבוי של חובה, ואז select ואחריו update או insert בטרנזקציה | upsert ידני. שתי קריאות מקבילות מתנגשות באינדקס הייחודי ואחת מקבלת 500. `ON CONFLICT DO UPDATE` היה סוגר |
| 131 עד 140 | `setChannel`, לולאה על כל הקטלוג עם `setPreference`, מדלג על חובה בכיבוי | 42 טרנזקציות נפרדות, לא אטומי |
| 143 עד 156 | `isEnabled`, שאילתה עם fallback לקטלוג | לא נקרא מה worker, לו יש עותק משלו |

**שים לב.** הוספת `limit` ל `listMine` בטוחה כל עוד ה SPA לא סופר שורות. cursor על `created_at` ו `id` הוא הצורה הנכונה.

הבדיקה שהאירוע מוכר ב `setPreference` היא מה שמונע מלקוח למלא את `notification_preference` במפתחות שרירותיים. אל תסירו אותה כדי לתמוך באירוע חדש, הוסיפו אותו לקטלוג.

#### `apps/api/src/modules/not/notification.controller.ts`
דפוס P2, ארבעה מסלולים תחת `notifications`. כולם פועלים רק על `user.id` מה session, ולכן אין IDOR.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 25 | `SetPreferenceDto` עם `eventType`, `channel` שברירת המחדל שלו `in_app`, ו `enabled`. `SetChannelDto` עם ערוץ חובה | ברירת המחדל נכנסת לתוקף בזכות `transform: true`. `IsBoolean` דוחה את המחרוזת `true` |
| 33 עד 42 | `GET` אל `listMine` ו `GET preferences` אל `getPreferences` | |
| 44 עד 53 | `PUT preferences` ו `PUT preferences/channel` | שניהם `PUT` עם גוף, וה tests קוראים להם כך |

#### `apps/api/src/modules/not/content.service.ts`
תוכן מפורסם שהוא נתונים ולא טקסט. לוח תערוכות, פרטי קשר מהסביבה, ומתקנים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 39 | ייבוא, הערה למה זה ב API ולא ב SPA | |
| 40 עד 63 | `shows`, כל `consignment_event` פעיל לפי `startsAt`, עם `open` לפי דדליין ו `past` | מפרסם `notes` לציבור. אם אדמין כותב שם הערה פנימית היא דולפת |
| 74 עד 99 | `contact`, `loadEnv()` בכל קריאה, `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS`, ו `SUPPORT_TEAM` שמפורסר מ `Name\|Role;Name\|Role`. `helpdesk` תמיד true | ערך ריק הופך null, לא placeholder |
| 109 עד 127 | `locations`, מתקנים פעילים עם קוד, עיר, אזור, מס וימי העברה | בלי כתובת רחוב |

#### `apps/api/src/modules/not/content.controller.ts`
דפוס P2, ארבעה מסלולים ציבוריים תחת `content`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 25 | ייבוא ו `buildIntakePolicy` מ `inv/intake-policy.ts` | |
| 27 עד 37 | `GET shows` ו `GET contact` אל `ContentService` | `@Public()` על כל מסלול בנפרד ולא על המחלקה, כך שמסלול חדש פרטי כברירת מחדל |
| 38 עד 57 | `GET intake-policy`, נגזר בזמן הבקשה מהכללים שהקליטה אוכפת | יושב כאן ולא תחת `/intake` כי בקר הקליטה סגור למחסן. העברה לשם תסתיר אותו מלקוחות |
| 59 עד 63 | `GET locations` | |

#### `apps/api/src/modules/not/not.module.ts`
דפוס P1, מסומן `@Global()`, מייצא את `OutboxService`, `NotificationService` ו `ContentService`. ה `@Global()` הוא מה שמאפשר לכל מודול להזריק `OutboxService` בלי import. הסרתו מפילה את העלייה, ראשון `CustodyService`.

**תלויות `not`.** `content.service.ts` קורא את `dis/consignment-event.schema.ts` ו `inv/facility.schema.ts`. כותב רק `notification_preference` ו `outbox_message`. `notification` נכתב רק מה worker. משתני סביבה ישירים הם `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS`, `SUPPORT_TEAM`. הצרכנים ב SPA הם `NotificationsPage.tsx`, `HelpPanels.tsx` ו `IntakePolicyPanel.tsx`.

### שירותים על פריט מאוחסן, `dis`

כל בקשה היא שורה ב `service_request` עם enum של ארבעה מצבים, `requested`, `in_progress`, `completed`, `cancelled`. כל שלב פנימי, `stage` של הצעה, `approvalState` של דירוג, `submissionId`, חי ב `type_fields` מסוג jsonb בלי אכיפה במסד. ברוב השירותים הכסף זז ביצירה, באותו `tx`, דרך `BillingPort`, ואין שום נתיב החזר. `buyout` ו `custom` מזיזים את הסכום העיקרי רק בקבלת הצעה. `donation` ו `remove_commons` לא עוברים בתור, הם נוצרים ונסגרים באותה טרנזקציה אחרי אישור דו שלבי. הבעיה החוזרת היא קריאה של הבקשה דרך `requests.get` על `this.db` בלי נעילה, ואז `setStatus` שלא בודק מצב קודם. בשירותים שמעבירים בעלות זה מתחבר ל E4.

```mermaid
stateDiagram-v2
    [*] --> requested : request, charge in same tx
    requested --> in_progress : operator accept
    requested --> completed : donation, remove_commons, warehouse_transfer
    requested --> cancelled : operator deny, no refund
    in_progress --> in_progress : quote, approve, add to submission
    in_progress --> cancelled : decline or refuse, no refund
    in_progress --> completed : fulfillment form
```

**איפה הכסף זז ב `dis`.**

| שירות | מתי וכמה | החזר |
|---|---|---|
| צילום, וידאו, בדיקת מצב, פיצול לוט, תרומה | ביצירה, `service` או `service_fee:<key>` דרך `BillingPort` | אין |
| דירוג | ביצירה, `grading_fee:<tier>` | אין, גם בסירוב אדמין |
| שבירת slab | באישור השני, `service_fee:deslab` | אין |
| קונסיגנציה | `service` ביצירה, ובהשלמה `sale_credit` ברוטו וחיוב `fee` לפי `consignment_fee:<channel>` ישירות ב ledger | אין |
| buyout | `service` ביצירה, ובקבלה `sale_credit` בגובה ההצעה עם `referenceType: 'service_request'` | אין על ה `service` |
| custom | השאלה חינם, בקבלת הצעה חיוב `fee` ישירות ב ledger אחרי בדיקת יתרה | אין, גם בדחייה של מחסנאי אחרי תשלום |
| הסרת commons | חינם בתוך 30 יום | לא רלוונטי |
| העברת מחסן | `service` על המחסנאי, באג | אין |

#### `apps/api/src/modules/dis/service.service.ts`
המסגרת. יוצרת ומחייבת בקשה, מונעת כפילות פתוחה, מנהלת את תור המחסנאי, וסוגרת עם טופס. כל שירות אחר בתיקייה קורא לה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 14 עד 48 | `ServiceType`, שנים עשר סוגים, ו `SERVICE_LABEL` לשם קריא | לא מחובר ל enum ב `dis.schema.ts`. ערך חדש שם בלי ערך כאן לא יתריע |
| 66 עד 122 | `create(tx, input)`. `wallet.assertNotBlocked`, `assertNotAlreadyOpen` אלא אם `allowDuplicate`, `billing.charge` עם `actionType: 'service'` ו `feeActionType` אלא אם `free`, ואז insert עם קוד `SR-` ומצב `requested` | המימוש של `BILLING_PORT` הוא `BillingService` מ `pay`. כיסוי מנוי קודם, אחר כך `feeActionType`, נופל ל `service`. `charge` לא מחזיר מזהה, ולכן `service_request.charge_id` לא נכתב לעולם ו `charge.reference_id` הוא מזהה הפריט. אין דרך מדויקת לבנות החזר. `assertNotBlocked` רץ בלי `tx` |
| 124 עד 169 | `assertNotAlreadyOpen`, בקשה פתוחה מאותו סוג, מבקש ופריט | בדיקה באפליקציה בלבד, בלי אינדקס ייחודי חלקי. אמינה רק כשהקורא נעל את הפריט קודם. צילום, וידאו, בדיקה, תרומה ושירותי השמדה לא נועלים. בקשה בלי פריט מדלגת |
| 171 עד 205 | `get` לפי מזהה על `this.db`. `listMine` לפי משתמש. `listQueue` בקשות פתוחות עם אימייל ותיאור | `get` נקרא מתוך טרנזקציות בכל התיקייה ולא נועל ולא רואה כתיבות של ה `tx`. אין עימוד |
| 208 עד 225 | `accept`, `deny`, ו `transition` עם טרנזקציה, `for('update')` ובדיקת מצב מקור | המקום היחיד שעושה את זה נכון. `deny` לא מחזיר כסף |
| 228 עד 232 | `assertAccepted`, דורש `in_progress` | בודק עותק שנקרא בלי נעילה |
| 234 עד 248 | `setStatus` נועל, ממזג רדוד ל `type_fields`, ומעדכן מצב | לא בודק מצב נוכחי. מתיר גם `completed` חזרה ל `in_progress` |
| 256 עד 291 | `completeWithFulfillment`. שדה חסר הוא null, מחרוזת ריקה, מספר לא חיובי או `false`. זורק עם רשימת החסרים, ואז נועל וכותב `completed`, `fulfillment`, `fulfilled_by`, `fulfilled_at` | מערך ריק נחשב מלא. אין בדיקת מצב קודם, ולכן `warehouseTransfer` סוגר בקשה ב `requested`. הוספת בדיקה תשבור אותו |
| 294 עד 303 | `platformAccountId` לפי `platform@bault.dev` | בלי seed תרומה, קונסיגנציה ו buyout נכשלים. משתמש שנרשם עם האימייל לפני ה seed יקבל כל פריט שנתרם |

**איך מוסיפים סוג שירות.** ערך חדש ל enum ב `dis.schema.ts` דרך מיגרציה, ערך ב `ServiceType` וב `SERVICE_LABEL`. שירות שנועל את הפריט עם `for('update')` בתוך `custody.run` ואז קורא `create` עם `feeActionType` משלו. כלל תמחור `service_fee:<key>` ב seed, אחרת הוא נגבה ב `service`. רשימת שדות חובה ונתיב השלמה עם `@Roles('warehouse_operator', 'admin')` ובדיקת `req.type`. מיפוי בטופס של `ServiceQueue.tsx`.

**כיוון תיקון.** פונקציה `getForUpdate(tx, id)` שנועלת ובודקת מצב תסגור את רוב המרוצים בתיקייה במקום אחד. אינדקס ייחודי חלקי על `item_id`, `requester_id`, `type` למצבים פתוחים, בלי `custom`, יהפוך את `assertNotAlreadyOpen` לאמין, ויחייב לתרגם הפרת ייחודיות ל 409. החזר דורש קודם ש `BillingPort.charge` יחזיר מזהה, וזה נוגע גם ב `inv/batch.service.ts`, `inv/intake.service.ts`, `inv/parcel.service.ts` ו `mkt/trade.service.ts`.

**בדיקות.** `tests/integration/dis-services.test.ts` ו `dis-item-services.test.ts` מכסים את המסגרת ואת רוב השירותים. אין בדיקות ל `buyout`, `custom` ו `consignment`, שהם השירותים שמזיזים הכי הרבה כסף.

#### `apps/api/src/modules/dis/dis.controller.ts`
הבקר היחיד של המודול, תחת `/services`. דפוס P2. מכיל 24 DTO של class-validator ואפס לוגיקה. בדיקות הבעלות כולן בשירותים, ולכן כדי לדעת אם נתיב מוגן צריך לקרוא את ה `@Roles` כאן וגם את השירות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 187 | ה DTO. `@IsBoolean() @Equals(true)` על כל `itemVerified`. `InspectionFulfillmentDto` עם `@ValidateNested` ו `@Type` | `ItemDto`, `AddToSubmissionDto`, `ConfirmDto` בלי `@IsUUID`. `CullRequestDto` בלי `@ArrayMaxSize`. רק ה DTO של custom מגדירים `@MaxLength`. `ConsignmentFulfillmentDto.channel` לא נבדק מול הקטלוג |
| 191 עד 233 | המחלקה, `GET mine`, `GET queue` לצוות, `GET requests/:id`, `POST requests/:id/accept` ו `deny` לצוות | `GET requests/:id` בלי `@Roles` ובלי בדיקת מבקש. כל משתמש מחובר עם מזהה קורא הצעות, ממצאים והערות. ה SPA לא משתמש בנתיב |
| 236 עד 244 | `POST photography` ו `photography/:requestId/complete` לצוות | ההשלמה לא בודקת סוג בקשה |
| 255 עד 332 | `GET grading/tiers`, `POST grading`, `grading/:requestId/approval` לאדמין, `grading/:requestId/complete`, וחמשת נתיבי `grading/submissions` לצוות | `approval` לא נקרא מה SPA, בקשת walkthrough נתקעת. `readyFor` מקבל `gradingBody` שאינו חובה |
| 336 עד 369 | `GET inspection/areas`, `POST video`, `POST inspection`, והשלמות שלהם לצוות | בהשלמות כאן יש בדיקת סוג |
| 372 עד 407 | `deslab`, `deslab/confirm`, `deslab/:requestId/complete`, `remove-commons/window`, `remove-commons`, `remove-commons/confirm` | הבעלות נבדקת רק בשלב הראשון |
| 410 עד 433 | `lot-split` והשלמה, `donation` ו `donation/confirm` | |
| 435 עד 535 | `GET consignment/channels` עם האירועים, `POST buyout`, `POST custom`, ציטוט ודחייה של custom לצוות, `accept-quote` ו `decline-quote` ללקוח, השלמת custom, ציטוט buyout לצוות, `accept` ו `decline` של buyout ללקוח | `custom/:id/decline` לא נקרא מה SPA |
| 537 עד 557 | `POST consignment`, `consignment/:requestId/complete` לצוות, `POST warehouse-transfer` לצוות | `warehouse-transfer` לא נקרא מה SPA |

**שים לב.** בחירת נתיב ההשלמה לפי סוג נעשית ב `ServiceQueue.tsx` בשורות 303 עד 415. הנתיב הלא נכון של צילום או דירוג יסגור בקשה מסוג אחר.

**שים לב.** הוספת `@IsUUID()` לכל מזהה כאן בטוחה, כי כל המפתחות הם uuid. היום מזהה שאינו uuid נכשל במסד עם `22P02`, ו `shared/errors/all-exceptions.filter.ts` כבר ממיר אותו ל 400. הוספת `@Roles('warehouse_operator', 'admin')` ל `requests/:id` לא תשבור את ה SPA.

#### `apps/api/src/modules/dis/consignment-channels.ts`
קטלוג בקוד של שלושה ערוצי קונסיגנציה וכללי הזכאות. מחירים לא כאן, רק שם הפעולה ב `pricing_rule`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 36 | הערה היסטורית ו `ConsignmentChannel`, `gradedOnly`, `minAskingMinor`, `requiresEvent`, טווח ימי תשלום, `partnerFeeNote` | ימי התשלום הם ציפייה ולא נאכפים |
| 38 עד 69 | `CONSIGNMENT_CHANNELS`, `card_show` דורש תערוכה, `auction_house` דורש דירוג ומינימום 5000, `ebay_partner` פתוח | |
| 71 עד 84 | `BY_KEY`, `consignmentChannel`, `isKnownChannel`, `channelFeeAction` שבונה `consignment_fee:<key>` | ערוץ חדש בלי כלל תמחור בשם הזה נופל ל `marketplace_fee`. שינוי `key` שובר בקשות פתוחות ששמרו אותו |
| 87 עד 132 | `checkEligibility` מחזיר מערך בעיות. מדורג הוא כל `conditionGrade` שאינו ריק ואינו `Raw` | הגדרה חלשה. `Near Mint` נחשב מדורג. קיום התערוכה נבדק בשירות |

**מתכון.** ערוץ חדש הוא אובייקט ב `CONSIGNMENT_CHANNELS` ועוד כלל `consignment_fee:<key>` ב `db/seed.ts` ובאדמין. `ConsignmentForm.tsx` מציג את הקטלוג כפי שהוא מגיע מ `GET /services/consignment/channels`, בלי שינוי בצד הלקוח.

#### `apps/api/src/modules/dis/consignment.service.ts`
שני דברים בקובץ אחד. קונסיגנציה, שבה המחסנאי סוגר עם סכום מכירה והבעלים מזוכה, והעברה בין מחסנים של מחסנאי. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 78 | טפסי סגירה `ConsignmentFulfillment` ו `TransferFulfillment` עם רשימות חובה, הזרקה | הרשימות מוודאות שכל שם הוא שדה, לא שכל שדה ברשימה |
| 79 עד 105 | `request`. ערוץ ידוע ומחיר חיובי, `custody.run`, נעילת פריט `for('update')`, בעלות, `stored`, בלי hold, `checkEligibility` | 403 גם לפריט שלא קיים |
| 107 עד 135 | תערוכה כשהערוץ דורש. אירוע פעיל, דדליין עתידי, ספירת בקשות תפוסות לפי `type_fields ->> 'eventId'` | הספירה לא נעולה, שתי בקשות על המקום האחרון עוברות |
| 137 עד 153 | `requests.create` עם חיוב `service` שטוח וצילום הערוץ, המחיר, מזהה ושם האירוע וטווח ימי התשלום ב `typeFields` | העמלה האמיתית תנוכה רק בהשלמה, לפי הכלל שבתוקף אז. המוכר לא יודע אותה כשהוא מבקש. שינוי מבנה `type_fields` שובר את `ServiceQueue.tsx` |
| 156 עד 162 | `listEvents`, תערוכות פעילות עם דדליין עתידי | `now()` של המסד כאן מול `Date.now()` של השרת ב `request` |
| 164 עד 185 | `complete`. `requests.get` בלי נעילה, `in_progress`, סוג ופריט. המזוכה הוא `req.requesterId`. עמלה מ `tryPrice(channelFeeAction)` עם נפילה ל `marketplace_fee` | הערוץ נלקח מ `type_fields`, לא מהטופס. שתי השלמות מקבילות מזכות פעמיים |
| 187 עד 201 | `sale_credit` ברוטו וחיוב `fee` כשתי שורות כדי שהדף יראה את שתיהן, `transferOwnership` לפלטפורמה, `changeState` ל `consigned` שמותר רק מ `stored` | לא בודק שהמבקש עדיין הבעלים. קלף שנמכר בשוק בזמן הקונסיגנציה נלקח מהקונה והמוכר מקבל פעמיים, E4. העמלה לא מזוכה לאף חשבון |
| 206 עד 229 | `transaction` מסוג `consignment` עם צילום תמחור, `completeWithFulfillment`, החזרת נטו | |
| 236 עד 254 | `warehouseTransfer`. בקשה עם `requesterId` של המחסנאי, `custody.relocate` ל `EXT:<warehouse>/<bin>`, סגירה מיידית | המחסנאי מחויב ב `service` ולא הבעלים. אין בדיקת קיום פריט לפני החיוב. `bin_id` טקסט חופשי ודוחות מדף יאבדו את הפריט |

**כיוון תיקון.** ב `complete`, לנעול את שורת הבקשה ולבדוק `in_progress` תחת הנעילה, לנעול את הפריט ולדרוש בעלות של המבקש, `stored` ובלי hold לפני הזיכוי. עדיף גם לחסום ב `ListingService.create` רישום של פריט עם קונסיגנציה או buyout פתוחים, כי היום הוא לא בודק בקשות שירות. שינוי `changeState` מ `consigned` ל `sold` מותר ב `lifecycle.ts` אבל ישנה את הספירה ב `vlt/vault.service.ts` וב `adm/shelf-yield.service.ts`.

#### `apps/api/src/modules/dis/buyout.service.ts`
Bault קונה את הקלף. בקשה, הצעה של מחסנאי, תשובת הלקוח. רק קבלה מזיזה כסף ובעלות. `stage` ב `type_fields` הוא מכונת המצבים הפנימית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 52 | `BuyoutQuoteForm` עם סכום, נימוק ו `itemVerified`, הערה שהבדיקה עצמה מחויבת | |
| 53 עד 66 | `request` כמו בקונסיגנציה, נעילה ושלוש בדיקות, חיוב `service`, `stage: 'awaiting_quote'` | |
| 76 עד 104 | `quote`. אימות טופס, `requests.get` בלי נעילה, `in_progress` וסוג, `setStatus` עם ההצעה, outbox `buyout_quoted` | אין בדיקת `stage`. ציטוט חוזר דורס, והלקוח עלול לקבל מספר שלא ראה, כי `accept` קורא את ההצעה מחדש ולא משווה לשום דבר שהלקוח שלח. ה DTO בבקר אוכף את אותם תנאי טופס, הגנה כפולה |
| 115 עד 129 | `accept`, בדיקות. מבקש עם 404, סוג, פריט, `stage === 'quoted'`, סכום תקין | אין בדיקת `status` ואין נעילה. שתי קבלות מקבילות עוברות שתיהן |
| 131 עד 148 | `sale_credit` ללקוח, `transferOwnership` לפלטפורמה, `changeState` ל `sold` | P0. הפריט לא נקרא בכלל. אם נמכר בשוק בינתיים, המוכר מקבל פעמיים והקלף נלקח מהקונה, E4. `sold` ל `sold` מותר ולכן לחיצה כפולה מזכה פעמיים |
| 150 עד 173 | `transaction` מסוג `sale`, הפלטפורמה כקונה, ו `setStatus` ל `completed` עם `stage: 'accepted'` | עוקף את `completeWithFulfillment`, `fulfilled_by` ריק. `vlt/break-even.service.ts` סופר את זה כמכירת שוק ומוריד את החציון |
| 176 עד 191 | `decline`, אותן בדיקות ואז `cancelled` עם `stage: 'declined'` | חיוב ה `service` נשאר |

**כיוון תיקון.** ב `accept`, לקרוא את הבקשה עם `for('update')` על `tx` ולבדוק `status === 'in_progress'` ו `stage === 'quoted'` תחת הנעילה, ואז לנעול את הפריט ולדרוש `ownerId === req.requesterId`, `stored` ובלי hold. שמות ה `stage` נקראים ב `ShippingServicesPage.tsx` כדי להציג כפתורי קבלה ודחייה, ושינוי שלהם שובר את המסך.

#### `apps/api/src/modules/dis/grading-tiers.ts`
קטלוג רמות הדירוג, ובמקרה גם רשימת אזורי בדיקת המצב.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 41 | `GradingTier` עם תקרת ערך מוצהר, טווח ימים ו `requiresApproval`. `WALKTHROUGH_THRESHOLD_MINOR` הוא 499,900 | |
| 43 עד 90 | `GRADING_TIERS`, ארבע רמות PSA ואחת BGS. רק `psa_walkthrough` דורשת אישור | אין BGS מעל 1,499 דולר |
| 92 עד 105 | `BY_KEY`, `gradingTier`, `isKnownTier`, `tierFeeAction` שבונה `grading_fee:<key>` | רמה בלי כלל תמחור נגבית ב `service`, לא בחינם |
| 107 עד 140 | `checkTier`. ערך לא חיובי, מעל התקרה, או walkthrough מתחת לסף | אין בדיקה הפוכה לשאר הרמות |
| 149 עד 154 | `INSPECTION_AREAS`, חמישה אזורים, ו `isKnownArea` | שינוי הרשימה שובר בקשות בדיקה פתוחות |

**מתכון.** רמה חדשה היא אובייקט ב `GRADING_TIERS` ועוד כלל `grading_fee:<key>`. שינוי `gradingBody` של רמה קיימת משנה לאיזה משלוח בקשות חדשות יכולות להצטרף, כי `addToSubmission` משווה את הגוף בבקשה לגוף המשלוח במדויק. שינוי `key` שובר בקשות פתוחות ששמרו אותו ב `type_fields.tier`.

#### `apps/api/src/modules/dis/grading.service.ts`
דירוג כצינור. בקשה, accept, אישור אדמין אם נדרש, הצטרפות למשלוח `grading_submission`, יציאה שמעבירה את הפריט ל `at_grader`, וחזרה עם ציון. דפוס P3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 73 | `GradingFulfillment` וחמישה שדות חובה, הזרקה | אין בדיקה שהציון או מספר התעודה בפורמט של הגוף |
| 74 עד 82 | `tiers`, הקטלוג עם `tryPrice` לכל רמה | רמה בלי כלל מוצגת `null` ונגבית ב `service` |
| 91 עד 131 | `request`. `checkTier`, נעילת פריט ושלוש בדיקות, `create` עם `feeActionType: grading_fee:<tier>`, `approvalState` של `pending` או `not_required` | הבקשה מחויבת גם כשממתינה לאישור |
| 134 עד 153 | `approve` לאדמין. נימוק, קריאה בלי נעילה, `pending`. אישור משאיר את המצב, סירוב מבטל | אין החזר על עמלת הרמה, שיכולה להיות היקרה בקטלוג. באישור, `req.status as 'in_progress'` משקר לקומפיילר, ובקשה ב `requested` נשארת `requested`. שני אדמינים במקביל, האחרון קובע |
| 160 עד 173 | `openSubmission` עם קוד `GSB-` ו `listSubmissions` | הגוף טקסט חופשי. `psa` באותיות קטנות לא יתאים לאף בקשה |
| 176 עד 201 | `readyFor`, בקשות `in_progress` של אותו גוף, בלי משלוח, עם אישור `not_required` או `approved` | `coalesce` לבקשות ישנות |
| 204 עד 235 | `addToSubmission`. נועל משלוח `open`, בודק בקשה, גוף, אישור, ושאין לה משלוח, כותב `submissionId` ל jsonb | חברות רק ב jsonb, בלי FK. אין נתיב להוציא בקשה ממשלוח |
| 243 עד 306 | `shipSubmission`. מעקב והערות, נעילת משלוח, שליפת כל החברים, `changeState` ל `at_grader` לכל פריט, outbox `grading_shipped`, משלוח ל `shipped` | אין סינון לפי `status`. בקשה שנסגרה לפני היציאה שולחת פריט ל `at_grader` לתמיד. פריט אחד שאינו `stored` מפיל את כל המשלוח ב 409 |
| 315 עד 348 | `complete`. `in_progress`, נעילת פריט, ציון ל `condition_grade`, שורה ב `item_change_history`, `at_grader` חזרה ל `stored`, סגירה | אין בדיקת `req.type`. הנתיב סוגר גם בקשת קונסיגנציה בלי לזכות. אין בדיקת אישור או משלוח |
| 351 עד 385 | `closeSubmission`. נעילה, `shipped`, ספירת בקשות פתוחות, `returned` | לא סופר בקשות שנסגרו, הפריט שלהן נשאר `at_grader` |

**שים לב.** `at_grader` הוא מצב מחזור חיים, ולכן `assertTransition` חוסם מכירה ומשלוח של קלף אצל המדרג בלי לגעת בשירותים האלה. זה עובד רק אם הכניסה והיציאה סימטריות, ו `complete` הוא היציאה היחידה. התיקון הוא `eq(serviceRequest.status, 'in_progress')` בשאילתת החברים ב `shipSubmission`, בדיקת `req.type` ב `complete`, ונתיב הסרה ממשלוח. שינוי ערכי `approvalState` שובר את השאילתה ב `readyFor` ואת התווית `grade.needsApproval` ב `apps/web/src/shared/i18n.tsx`.

#### `apps/api/src/modules/dis/photography.service.ts`
צילום מקצועי. המחסנאי מצרף מפתח אובייקט כגרסה חדשה ב `item_image` מסוג `professional`. השירות הוותיק ביותר וחסר הגנות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 40 | `PhotographyFulfillment` וחמישה שדות | `objectKey` הוא טקסט שהמחסנאי מקליד |
| 41 עד 47 | `request`, טרנזקציה, פריט בלי נעילה, בעלות בלבד | אין בדיקת מצב או hold. בלי נעילה `assertNotAlreadyOpen` לא מגן מלחיצה כפולה |
| 53 עד 83 | `complete`. `in_progress`, גרסה כמקסימום ועוד אחת על כל סוגי המדיה, insert ל `item_image`, סגירה | אין בדיקת סוג. אין אינדקס ייחודי על `item_id, version`. המפתח לא נבדק מול האחסון, וכל קובץ בדלי יכול להיחתם ולהיות מוגש בשוק, קרוב ל E9 |

**כיוון תיקון.** `for('update')` על הפריט ב `request` ובדיקת מצב והחזקה, כמו בשירותים המאוחרים. בדיקת `req.type` ב `complete` לא תשבור את הממשק, כי `ServiceQueue.tsx` כבר ממפה כל סוג לנתיב שלו.

#### `apps/api/src/modules/dis/media.service.ts`
וידאו ובדיקת מצב. לא נוגע בבייטים. יש מחלקה נוספת בשם `MediaService` ב `med/media.service.ts` שמקבלת העלאות, ושתיהן שונות לגמרי. עורך שמייבא אוטומטית עלול לבחור את הלא נכונה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 67 | `VideoFulfillment`, `AreaFinding`, `InspectionFulfillment`, `SEVERITIES` של `clean`, `minor`, `notable` | |
| 68 עד 77 | `assertOwnedAndPresent`, בעלות ומצב `stored` או `listed` | היחיד שמתיר `listed`, כי הדרישה היא שהקלף פיזית במחסן וקלף מוצע עדיין שם. בלי נעילה ובלי בדיקת hold |
| 81 עד 125 | `requestVideo` עם `service_fee:video_review`, `completeVideo` כמו צילום עם בדיקת סוג בשורה 101 ו `type: 'video'` | אותה בעיית מפתח לא מאומת |
| 136 עד 151 | `requestInspection`, מסנן אזורים לא מוכרים בשקט, חיוב `service_fee:condition_inspection` | כפילויות לא מוסרות. מחיר אחד בלי קשר למספר האזורים |
| 160 עד 193 | `completeInspection`. כל ממצא עם אזור, חומרה והערה, כל אזור שהתבקש קיבל ממצא, ואז סגירה | הממצאים נשמרים פעמיים, כמחרוזת ב `fulfillment` וכמערך ב `type_fields` |

**כיוון תיקון.** להוסיף מטרות `professional` ו `video` ל `UploadPurpose` ב `med/media.service.ts`, ולדרוש שמפתח בהשלמה יתחיל בקידומת שנוצרה שם. בדיקת קיום באחסון דורשת פעולה חדשה ב `StorageAdapter` ב `packages/adapters/src/storage.ts`, שיש בו היום רק `putObject` ו `getSignedUrl`. שינוי שם המחלקה ל `ItemMediaRequestService` נוגע רק ב `dis.module.ts` וב `dis.controller.ts`.

#### `apps/api/src/modules/dis/lot-split.service.ts`
הדלת ללקוח אל `IntakeService.breakLot` מ `inv`. הלקוח משלם `service` על הבקשה ו `intake` על כל ילד.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 43 | `LotSplitFulfillment`, הערת עיצוב | |
| 44 עד 67 | `request`. נעילת פריט, בעלות, לוט שלא פוצל, `stored`, בלי hold, חיוב, `lotSize` ו `willCreate` | |
| 76 עד 87 | `complete`. בדיקות על הבקשה בלי נעילה, ואז `breakLot` מחוץ לטרנזקציה | `breakLot` יוצר כל ילד בטרנזקציה משלו ומסמן `lotBroken` רק בסוף. השלמה כפולה יוצרת פי שניים ילדים וחיובים. כשל באמצע משאיר ילדים מחויבים. אין בדיקה שהלוט עדיין `stored` |
| 89 עד 99 | סגירה בטרנזקציה נפרדת עם `producedCount` | אם הסגירה נכשלת, ניסיון חוזר נתקע על `Lot has already been broken` |

**כיוון תיקון.** טרנזקציה אחת שנועלת את הלוט ומסמנת `lotBroken` בתחילתה, כוללת את כל הילדים ואת סגירת הבקשה. זה מחייב ש `breakLot` יקבל `tx`, ושינוי החתימה נוגע גם בנתיב `break-lot` ב `inv/inv.controller.ts` שורה 145. `WarehouseConsole.tsx` קורא `producedCount` ישירות.

#### `apps/api/src/modules/dis/donation.service.ts`
תרומה לפלטפורמה. דו שלבית עם token ובלי תור.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 35 | הזרקה, הערה שהתרומה מחויבת | הלקוח משלם `service` כדי לתרום, בכוונה |
| 36 עד 42 | `request`, קריאה בלי טרנזקציה, בעלות, בלי hold, `stored`, `confirmation.issue` עם מזהה הפריט במטען | token תקף 300 שניות, קשור למשתמש ולפעולה |
| 45 עד 83 | `confirm`. `consume`, ואז טרנזקציה, `platformAccountId`, `create` מחויב, `transferOwnership`, `changeState` ל `donated`, `transaction` מסוג `transfer`, `setStatus` ל `completed`, outbox `item_donated` | הפריט לא נקרא מחדש. מכירה בתוך החלון מעבירה את קלף הקונה לפלטפורמה, E4. `consume` בלי `WHERE consumed_at IS NULL`, ושני confirm מקבילים יוצרים שני חיובים |

**שים לב.** ה token מגיע מ `shared/confirmation/confirmation.service.ts`, ש `consume` שלו בשורות 40 עד 72 קורא ואז מעדכן בלי תנאי ובלי ה `tx` של הקורא. התיקון שם, `UPDATE ... SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL RETURNING` בתוך ה `tx`, סוגר את הכפילות בתרומה, בשבירת slab ובסילוק יחד. בנוסף צריך לנעול את הפריט ב `confirm` ולחזור על שלוש הבדיקות.

#### `apps/api/src/modules/dis/disposal-services.service.ts`
שבירת slab והסרת commons. שתיהן דו שלביות עם token.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 57 | `DeslabFulfillment`, `CULL_WINDOW_DAYS` של 30 | שינוי החלון משפיע מיד על `remove-commons/window` |
| 58 עד 70 | `requestDeslab`, בעלות, `stored`, בלי hold, ציון שאינו `raw`, token | |
| 73 עד 87 | `confirmDeslab`, `consume` ו `create` עם `service_fee:deslab` | אין בדיקה מחודשת. אחרי מכירה בחלון המחסנאי ישבור את ה slab של הקונה |
| 96 עד 123 | `completeDeslab`, נעילת פריט, `conditionAfter` ל `condition_grade`, `item_change_history`, סגירה | ההערה אומרת שהציון מנוקה, בפועל הוא מוחלף בטקסט של המחסנאי. `Mint` ייחשב מדורג |
| 135 עד 162 | `requestCull`. dedupe, תוצאה `discard` או `donate`, כל הפריטים קיימים, ולכל אחד בעלות, `stored`, בלי hold ובתוך 30 יום מ `received_at` | הודעה נפרדת לפריט שלא קיים מגלה קיום מזהים. אין תקרת כמות |
| 171 עד 208 | `confirmCull`. `create` עם `free: true` בלי `itemId`, ולכל פריט תרומה עם העברת בעלות או `discarded`, `setStatus`, outbox `commons_removed` | שום בדיקה חוזרת. פריט שנמכר בחלון יסומן מושלך אצל הקונה. `service_request.item_id` ריק וציר הזמן של הפריט לא יראה את הבקשה |

**כיוון תיקון.** לכתוב `null` או `Raw` ל `condition_grade` בשבירה ולשמור את התיאור רק בטופס. ב `confirmCull` וב `confirmDeslab` לקרוא את הפריטים עם `for('update')` בתוך הטרנזקציה ולחזור על כל בדיקות השלב הראשון.

#### `apps/api/src/modules/dis/custom-request.service.ts`
בקשה חופשית. השאלה חינמית, אדם מצטט מחיר, והלקוח משלם רק בקבלה. אותו מבנה `stage` כמו buyout.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 65 | `CustomRequestInput`, `CustomQuoteForm`, הערה | |
| 66 עד 106 | `ask`. סיכום 3 תווים ופירוט 10, בעלות אם צוין פריט, `create` עם `free: true` ו `allowDuplicate: true`, outbox `custom_request_raised` | `assertNotBlocked` חוסם שאלה גם כשהיא חינמית |
| 116 עד 146 | `quote`. סכום והיקף, `assertAccepted`, סוג, ציטוט ל `type_fields`, outbox `custom_request_quoted` | אין בדיקת `stage`. ציטוט אחרי קבלה מחזיר `quoted` והלקוח יכול לשלם שוב |
| 154 עד 178 | `declineToQuote`, נימוק, דוחה רק `completed` ו `cancelled` | מבטל גם אחרי `accepted` ששולם, בלי החזר. לא נקרא מה SPA |
| 187 עד 241 | `acceptQuote`. 404 לזר, `stage === 'quoted'`, `assertNotBlocked` ויתרה מספיקה, חיוב `fee` ישירות ל ledger, `stage: 'accepted'` | היחיד בפרק שבודק יתרה מספיקה. עוקף את `BillingPort`, ולכן אין `charge`, אין snapshot ואין הטבת מנוי. `stage` נקרא בלי נעילה, שתי קבלות גובות פעמיים |
| 244 עד 256 | `declineQuote`, `cancelled` עם `quote_declined` | כאן באמת לא חויב כלום |
| 264 עד 285 | `complete`, הערות של 5 תווים, `stage === 'accepted'`, `setStatus` | `fulfilled_by` ריק, מי שסיים ב `type_fields.completedBy`. `ShippingServicesPage.tsx` בונה ציר לפי ערכי `stage` |

**כיוון תיקון.** לדרוש `stage` של `awaiting_quote` או `quoted` ב `quote` וב `declineToQuote`, ולקרוא עם `for('update')` ב `acceptQuote`. החזר בדחייה אחרי קבלה יהיה רשומת `credit` ב ledger עם `referenceType: 'service_request'`.

**שים לב.** החיוב הישיר ב ledger מכוון. `BillingPort` מקבל שם פעולה ולא סכום כדי שאף קורא לא ימציא מחיר, ובקשה חופשית היא בדיוק המקרה שבו הסכום לא בא מכלל. המחיר הוא שהחיוב לא נראה בכל מקום שקורא את `charge`. הרחבת `BillableAction` עם סכום מפורש שמותר רק ל `custom` תפתור את זה.

#### `apps/api/src/modules/dis/dis.module.ts`
דפוס P1, בקר אחד ואחד עשר ספקים בלי `imports`. `IntakeService` רשום כאן כספק מקומי, מופע שני לצד זה של `inv`, כי `InvModule` לא מייצא אותו. רק `LotSplitService` צריך אותו. שינוי בבנאי של `IntakeService` שידרוש ספק לא גלובלי ישבור את העלייה כאן.

**תלויות `dis`.** קורא ל `cst/custody.service.ts`, `pay/ledger.service.ts`, `pay/wallet.service.ts`, `BILLING_PORT`, `prc/pricing.service.ts`, `inv/intake.service.ts`, `not/outbox` ו `shared/confirmation`. כותב לטבלת `transaction` של `mkt` ב buyout, קונסיגנציה ותרומה. `vlt/vault.service.ts` קורא את `service_request` לציר הזמן של פריט, ו `vlt/break-even.service.ts` קורא את שורות `transaction` שנכתבות כאן. משתני סביבה אין, יש קבוע קשיח אחד, `platform@bault.dev`. הצרכנים ב SPA הם `ServiceQueue.tsx`, `ShippingServicesPage.tsx` וטופסי הכספת.

### משלוח החוצה, `shp`

שלוש שכבות. קבצי נתונים טהורים בלי IO, `carriers.ts`, `boxes.ts`, `shipping-options.ts`, `fulfilment.ts`, `countries.ts`, `destinations.ts`. שירותים שמחשבים ושומרים, עם `ParcelProfileService` שמתרגם פריטים לחבילה ו `ShipmentService` שמצטט וגובה. ולמעלה `DispatchService` שקונה תווית אצל הספק דרך `SHIPPING_ADAPTER`, ו `ShpController` תחת `/shipping`.

שני דברים לפני הקוד. הכסף של הלקוח זז בבחירת השירות, ב `settle` או ב `pay`, והתווית נקנית רק ב `dispatch`, לפעמים ימים אחר כך. בחלון הזה הפריטים עדיין `stored`, ורק `item_ids` של המשלוח ו `assertItemsFree` מסמנים שהם תפוסים. בנוסף, `picking`, `packed` ו `labeled` קיימים ב enum וב `OPEN_STATUSES` אבל שום קוד לא כותב אותם. בפועל משלוח קופץ מ `rates_selected` ל `shipped`.

```mermaid
stateDiagram-v2
    [*] --> requested : create or white-glove
    [*] --> rates_selected : direct or pickup, charged at once
    requested --> rates_selected : select-rate, wallet covers, CHARGE
    requested --> awaiting_payment : select-rate, wallet short, due in 7 days
    awaiting_payment --> rates_selected : pay, CHARGE
    awaiting_payment --> cancelled : worker shipment-expiry or cancel
    requested --> cancelled : cancel, or merge source
    rates_selected --> rates_selected : select-rate again, CHARGE AGAIN
    rates_selected --> cancelled : cancel, 25 dollar fee, no refund
    rates_selected --> shipped : dispatch, buyLabel
    rates_selected --> delivered : hand-over
    shipped --> in_transit : worker tracking-refresh
    in_transit --> delivered
    in_transit --> exception
```

המעבר `CHARGE AGAIN` והחייאה של משלוח מבוטל דרך `choose-for-me` הם באגים ולא תכנון. ה worker של המעקב משתמש תמיד ב `SandboxShippingAdapter`, E17, ולכן בייצור שום חבילה לא מגיעה ל `delivered` דרכו.

**מה רץ מחוץ ל API.** שני jobs ב `apps/worker/src/index.ts` נוגעים בטבלת `shipment` ב SQL גולמי. `shipment-expiry` רץ בדקה 20 של כל שעה, נועל `FOR UPDATE` משלוחי `awaiting_payment` שעבר להם `payment_due_at`, מעביר ל `cancelled` ומשגר `shipment_expired`. `tracking-refresh` רץ כל 30 דקות על `shipped` ו `in_transit` ומעדכן סטטוס, בלי try ו catch לכל שורה, כך שחריגה אחת עוצרת את הריצה. `ShipmentService.expireUnpaid` הוא מימוש שני של התפוגה שאף אחד לא קורא לו.

**מה המתאם עושה ולא עושה.** `SHIPPING_ADAPTER` הוא `SandboxShippingAdapter` או `EasyPostShippingAdapter` מ `packages/adapters`, לפי `SHIPPING_PROVIDER`, דפוס P11. ב EasyPost כל `getRates` יוצר shipment אצל הספק עם הכתובת והשם. `buyLabel` קונה את התעריף שצוטט לפי מזהה ומתעלם מהבקשה ומהמשקל שנשקל. `RateRequest` לא מכיל שורות מכס, ולכן החשבונית ש `customs.service.ts` מפיק לא מגיעה לספק. `fetch` בלי `AbortSignal`. שגיאת ספק נזרקת כ `Error` רגיל ויוצאת 500 אטום.

**איפה הכסף זז ב `shp`.** כל חיוב כותב שורת `charge` עם `actionType: 'shipping'` ו snapshot, ושורת ledger `service_charge` בכיוון debit עם `referenceType: 'charge'`, באותו `tx`.

| נקודה | קובץ | מה נגבה |
|---|---|---|
| בחירת שירות כשהארנק מספיק | `shipment.service.ts`, `settle` | `totalMinor`, אחרי `spendShippingCover` |
| תשלום משלוח מוחזק | `shipment.service.ts`, `pay` | `cost` הקפוא |
| משלוח לילי ישיר | `direct-ship.service.ts` | 100 דולר ועוד פרמיה |
| קבלת הצעת מסירה ידנית | `human-fulfilment.service.ts`, `acceptQuote` | הסכום שהמפעיל הקליד |
| איסוף בתערוכה | `human-fulfilment.service.ts`, `requestPickup` | מחיר התערוכה או `show_pickup`, אחרי ויתור חברות |
| ביטול אחרי תשלום | `shipment-edit.service.ts`, `cancel` | 25 דולר נוספים |
| קניית תווית | `dispatch.service.ts` | כסף של Bault אצל הספק, לא נרשם |

אין שום נתיב שמזכה את הארנק בתחום הזה.

#### `apps/api/src/modules/shp/carriers.ts`
קטלוג שירותי השילוח והפונקציה `checkService` שמחזירה את כל הסיבות ששירות לא יכול לשאת חבילה. טהור. נקרא מ `ShipmentService.priceServices`, מ `countries.ts` ומ `DirectShipService`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 50 | הערה היסטורית ו `Destination`, רק `country` ו `postalCode` חובה | שתי הערות JSDoc צמודות, הראשונה שארית |
| 61 עד 76 | `destinationOf` מחזיר יעד מ `destinationDetail` אם יש בו מדינה ומיקוד, אחרת מהעמודות הישנות | ה cast ל `Partial<Destination>` לא מאמת. כל מה שב jsonb נשלח לספק |
| 78 עד 134 | `CarrierService`. `key` יציב, זוג `carrier` ו `serviceLevel` להתאמת תעריף, `scope`, `countries` שריק פירושו כל מקום, תקרות משקל, מכס וביטוח, מידות, ושדות של השירות הלילי | אפס בתקרת מכס פירושו בלי תקרה, אפס בביטוח פירושו בלי ביטוח |
| 137 עד 155 | `DOMESTIC_COUNTRY` הוא US, `EPACKET_COUNTRIES` 32 קודים, `DIRECT_OVERNIGHT_KEY` ו `DIRECT_OVERNIGHT_FACILITY` של DE | `EPACKET_COUNTRIES` הוא גם המקור של רשימת היעדים בטופס הכתובת |
| 157 עד 285 | `CARRIER_SERVICES`, שבעה שירותים. שלושה מקומיים, ePacket, ePost, FedEx International, והשירות הלילי ב 100 דולר עד חמישה פריטים ו 500 גרם | המספרים הצהרות בקוד בלי מקור. שינוי `carrier` או `serviceLevel` מנתק מתעריפי ה sandbox ושובר משלוחים קיימים ש `findService` מחפש לפי הזוג |
| 287 עד 296 | `carrierService` לפי מפתח, `findService` לפי הזוג | `selectRate` ו `pay` משתמשים בזוג |
| 299 עד 341 | `ParcelProfile` עם `weightGrams` של תכולה ו `packagingGrams` של קופסה, ו `ServiceProblem` עם `rule` מתשעה ערכים ו `limit` | ה SPA מתרגם לפי `rule` |
| 343 עד 354 | הפורמטרים `usd`, `inches`, `lb` | `usd` מניח דולרים |
| 356 עד 465 | `checkService` אוסף את כל הבעיות. היקף, חוזה מדינה, משקל עם קופסה, ערך מכס, ביטוח, חתימה, מידות כשידועות, מספר פריטים, מתקן מוצא | במשלוח רגיל `originFacilityCode` תמיד null, ולכן השירות הלילי תמיד לא זכאי בציטוט |
| 468 עד 470 | `eligibleServices` | אין לו צרכן |

**שים לב.** ההתאמה בין הקטלוג לתעריף שהספק החזיר היא שוויון מחרוזות. ב sandbox השמות זהים בכוונה, ב EasyPost סביר ששום תעריף לא יותאם. לא נבדק מול API חי.

**מה נשבר בשינוי.** שינוי `key` שובר כללי תמחור ושורות ששמרו `serviceKey`. הוספת מדינה ל `EPACKET_COUNTRIES` מוסיפה אותה גם לטופס הכתובת אם יש לה שם ב `COUNTRY_NAMES`. שינוי `DOMESTIC_COUNTRY` לא ישנה את `needsCustoms` ב `shipping-options.ts` ואת `ORIGIN_COUNTRY` ב sandbox, שקשיחים ל US בנפרד.

#### `apps/api/src/modules/shp/boxes.ts`
חמש קופסאות עם מידות, משקל עצמי ותקרה, ובחירת הקטנה שמתאימה. נקרא מ `ParcelProfileService.boxFor` ומה DTO.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 38 | הערה ו `ShippingBox` עם `dimensionsCm`, `tareGrams`, `maxContentsGrams`, `onlyClasses`, `takesOversized` | |
| 40 עד 82 | `SHIPPING_BOXES`, `rigid_mailer` לקלפים וסלאבים עד 500 גרם, `small`, `medium`, `large`, `extra_large` | סכום הצלעות של `large` ו `extra_large` מעל תקרת ePacket, ולכן ePacket נפסל בהן |
| 84 עד 98 | `SHIPPING_BOX_KEYS` ל `@IsIn`, `BY_KEY`, `shippingBox`, `BY_VOLUME` ממוין פעם אחת | שינוי `key` שובר משלוחים ששמרו `boxSize` |
| 100 עד 134 | הערה על השרשרת מחלקה ומשקל, קופסה, מידות, מחיר, ו `chooseBox` שמחזיר את הראשונה בלי בעיות | `undefined` כשאין קופסה |
| 136 עד 177 | `BoxProblem` ו `checkBox`, משקל תכולה מול תקרה ומחלקה מול `onlyClasses` או oversized | לא יודע כמה פריטים נכנסים פיזית. המידות לא נשמרות על המשלוח ונגזרות מחדש מהמפתח |

#### `apps/api/src/modules/shp/shipping-options.ts`
ביטוח, חתימה, תוספות, עמלת ביטול, חלון תשלום ומכס, והכללים שקושרים אותם. טהור. נקרא מיצירה, עריכה וציטוט.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 53 | `MAX_INSURED_VALUE_MINOR` 5,000 דולר, `SIGNATURE_REQUIRED_ABOVE_MINOR` 500 דולר, פרמיה 1.5 אחוז עם מינימום 2 דולר ועיגול למעלה, `signatureForced` | |
| 59 עד 88 | `SHIPMENT_ADD_ONS` עם `gps_tracker` ב 30 דולר שדורש ביטוח 500 דולר, `shipmentAddOn`, `addOnFeeAction` שבונה `shipping_addon:<key>` | הקידומת משמשת בכללי תמחור ובמכסות VIP ב `mem/membership.service.ts`. `inv/item-classes.ts` אוסר `gps_tracker` בקליטה |
| 94 עד 105 | `RESTOCKING_FEE_MINOR` 25 דולר, `PAYMENT_WINDOW_DAYS` 7 | ההערה אומרת שהעמלה רק אחרי אריזה. בקוד היא נגבית על כל ביטול מ `rates_selected`. ה worker לא קורא את 7, הוא סומך על `payment_due_at` |
| 117 עד 132 | `needsCustoms` לכל יעד שאינו US, `DEFAULT_HS_CODE` 4911.99, `DEFAULT_COUNTRY_OF_ORIGIN` US | US קשיח כאן בנפרד מ `DOMESTIC_COUNTRY` |
| 134 עד 190 | `checkOptions`. ערך שלילי, מעל תקרה, חתימה חסרה, ערך מכס לא חיובי בינלאומי, תוספת לא מוכרת, תוספת בלי ביטוח מספיק | כפילויות בתוספות לא נבדקות. `direct-ship.service.ts` לא קורא לה |

#### `apps/api/src/modules/shp/fulfilment.ts`
שלוש שיטות סיום, `carrier`, `hand_delivery`, `show_pickup`, וקבועים ובדיקות של מסירה ידנית ואיסוף.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 37 | `FULFILMENT_METHODS`, `isKnownFulfilmentMethod`, `usesCarrier` | שתי הפונקציות לא נקראות. שום שירות לא בודק `fulfilmentMethod` לפני תעריף או dispatch, רק `handOver` |
| 51 עד 60 | מחיר בסיס למסירה ידנית, 1,000 דולר מקומי ו 1,500 בינלאומי, 48 שעות, `whiteGloveFeeAction` | ברירות מחדל לתצוגה בלבד, ההצעה עצמה מוקלדת |
| 62 עד 114 | `HandDeliveryProblem` ו `checkHandDelivery`, כתובות, סדר חלונות, 48 שעות מראש | תאריך לא תקין הופך NaN וכל השוואה false, ולכן עובר. נכשל רק ב INSERT |
| 128 עד 131 | `PICKUP_USES_SHOW_DEADLINE` תיעודי, `PICKUP_FEE_ACTION` | |

**מתכונים.** שירות שילוח חדש הוא אובייקט ב `CARRIER_SERVICES` עם `carrier` ו `serviceLevel` שזהים בדיוק למה שהמתאם מחזיר, ואם הוא מקומי בלי רשימת מדינות, הוא לא משנה את טופס הכתובת. קופסה חדשה היא אובייקט ב `SHIPPING_BOXES`, ו `BY_VOLUME` ימיין אותה לבד. תוספת חדשה היא אובייקט ב `SHIPMENT_ADD_ONS` ועוד כלל תמחור `shipping_addon:<key>` אם המחיר בקטלוג לא מספיק, ומכסת VIP ב `mem` אם רוצים שתהיה מכוסה. יעד מכס חדש הוא אובייקט ב `DESTINATIONS` עם רשות וקישור, בלי סכומי מכס, לפי הכלל בראש `destinations.ts`.

#### `apps/api/src/modules/shp/countries.ts`
רשימת המדינות שאפשר לשלוח אליהן, נגזרת מקטלוג המובילים ולא כתובה שוב. נקרא מ `GET /shipping/countries`, מ `profile.service.ts` ומ `country.validator.ts`. נכתב אחרי באג שבו טופס הכתובת שמר Israel כטקסט חופשי וכל כללי המוביל השוו לקוד דו אותי.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 42 | הערה היסטורית ו `ShippingCountry` עם `code`, `name`, `domestic` | |
| 43 עד 77 | `COUNTRY_NAMES`, 33 קודים לשם באנגלית | ה SPA מתרגם את המשפט סביב השם ולא את השם |
| 79 עד 102 | `shippingCountries`, Set שמתחיל ב `DOMESTIC_COUNTRY`, מוסיף כל קוד מ `countries` של כל שירות, מסנן קודים בלי שם, מיון מקומי ראשון ואז `localeCompare` | בפועל הרשימה היא חוזה ePacket. מדינה ש ePost מגיע אליה ו ePacket לא, כמו הודו, לא מופיעה. קוד חדש ב `EPACKET_COUNTRIES` בלי שם כאן נעלם בשקט |
| 104 עד 107 | `isShippableCountry` | אין לו צרכן |
| 109 עד 123 | `toCountryCode`, קוד באותיות גדולות או חיפוש שם מלא לא רגיש לרישיות, null אם אין | `ParcelProfileService.resolveDestination` לא משתמש בו, ושם מדינה בכתובת ישנה יגיע לספק כשם באותיות גדולות |

#### קבצי נתונים קטנים ב `shp`

| קובץ | מה הוא עושה |
|---|---|
| `apps/api/src/modules/shp/country.validator.ts` | דקורטור `IsShippableCountry` של class-validator, true רק כש `toCountryCode` מצליח. רק מאמת ולא מנרמל. משמש ב `profile.controller.ts` ולא באף DTO של `shp` |
| `apps/api/src/modules/shp/destinations.ts` | הנחיות מכס לארבעה יעדים, AU, CA, GB, IL, עם רשות ו `notHandled`, ו `UNIVERSAL_CUSTOMS_NOTES`. `destinationGuidance` מחזיר `specific: null` ליעד לא כתוב. להוספת יעד מוסיפים אובייקט ב `DESTINATIONS` |

#### `apps/api/src/modules/shp/parcel-profile.service.ts`
מתרגם מזהי פריטים לחבילה. טוען ומאמת פריטים, שוקל, בוחר קופסה, מאתר יעד, בונה שורות מכס, ומרכיב `ParcelProfile`. כל נתיב שמתמחר עובר כאן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 54 | `CustomsLine` עם `weightEstimated`, `ItemMeasurements` | |
| 55 עד 71 | `loadShippableItems`. dedupe, `inArray`, ספירה שווה, ולכל פריט בעלות, בלי hold ו `stored` | ה control המרכזי נגד שליחת פריט של אחר. הודעת השגיאה בשורה 64 כוללת `serialNumber` של פריט זר. ה `tx` האופציונלי אף פעם לא מועבר |
| 74 עד 87 | `measure`, משקל נמדד או טיפוסי למחלקה כפול גודל הלוט, ודגל `estimated` | |
| 95 עד 124 | `boxFor`, קופסה שהמשתמש בחר עם הבעיות שלה, או `chooseBox` | כשאין קופסה מתאימה חוזר `box` ריק בלי בעיה |
| 134 עד 172 | `resolveDestination`. עם `addressId` טוען כתובת שמורה, `notFound` לזרה, יעד מלא. בלי `addressId` רק מדינה ומיקוד | `region` לא מועבר, ו EasyPost צריך state. אין `toCountryCode`, שם מדינה הופך לשם באותיות גדולות |
| 183 עד 215 | `buildCustomsLines` מחלק את הערך המוצהר לפי משקל, ערכים מפורשים גוברים, השורה האחרונה מקבלת את ההפרש | `apportioned` לא סופר ערכים מפורשים, וסכום החשבונית לא שווה לערך המוצהר שנבדק מול ePacket. ערך שברי עובר |
| 218 עד 241 | `toProfile`, `customsValueMinor` אפס ליעד מקומי, `originFacilityCode` null | |

**שים לב.** העברת ה `tx` של הקורא ל `loadShippableItems` בתוך dispatch היא שינוי רצוי, היא תקרא את מצב הפריטים באותה נקודת זמן של הנעילה. שינוי `buildCustomsLines` משפיע רק על משלוחים חדשים, כי השורות נקפאות על השורה. שינוי ההודעה בשורה 64 ישבור בדיקות שמצפות לטקסט.

**שים לב.** ריכוז המדידה, הקופסה והיעד כאן הוא מה ששומר על ציטוט, חיוב ותווית עקביים. מי שמוסיף נתיב שמתמחר חבילה חייב לעבור דרך `measure`, `boxFor` ו `toProfile`, ולא לחשב משקל בעצמו. בחירת קופסה אוטומטית נוספה אחרי שציטוטים בחסר הפכו לחיובים בחסר.

#### `apps/api/src/modules/shp/shipment.service.ts`
השירות המרכזי. ציטוט, יצירה, רשימות ותצוגת מעקב, בעלות, תמחור מחדש, בחירת שירות וגבייה או החזקה לתשלום, תשלום מוחזק, ובניית בקשת התווית. דפוס P3 עם חריגות חשובות, הבדיקות רצות מחוץ לטרנזקציה וה UPDATE בלי תנאי סטטוס, E18.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 158 | ייבוא, `ShipmentActor`, `DAY_OF_WAITING_MINOR` 2.50 דולר, `ShipmentOptionsInput`, `CreateShipmentInput`, `QuotedRate` עם `totalMinor` ו `recommended`, `Quote` | |
| 159 עד 185 | בנאי עם `SHIPPING_ADAPTER` לפי token, `OPEN_STATUSES` של שישה סטטוסים | שלושה מהם לא נכתבים לעולם |
| 198 עד 220 | `assertItemsFree`, Map מפריט למשלוח פתוח של אותו משתמש, 409 על תפוס | בלי טרנזקציה ובלי נעילה ובלי אילוץ במסד. רק משלוחים של אותו משתמש. פריט שנמכר בשוק יוצא מהבדיקה |
| 223 עד 241 | `services`, הקטלוג, תוספות, קופסאות, תקרות, חלון ועמלה | |
| 255 עד 315 | `quote`. פריטים, יעד, מידות, חתימה כפויה, קופסה, בעיות אפשרויות מוחזרות ולא נזרקות, `priceServices` | לא נשמר כלום. עם EasyPost כל ציטוט יוצר shipment אצל הספק |
| 325 עד 431 | `priceServices`. `pricing.price('shipping')` שזורק בלי כלל, rush דרך `tryPrice`, פרמיה ותוספות, כיסוי חברות ל rush, ביטוח ותוספות, `getRates`, לולאה על הקטלוג עם התאמת זוג, `checkService`, `totalMinor`, מיון | שירות בלי תעריף תואם פשוט לא מוצג. ה spread בשורה 409 שומר `providerShipmentId` ו `providerRateId` |
| 444 עד 459 | `originAddress`, מתקן ראשי פעיל, `undefined` כשהרחוב placeholder | בכוונה, כדי ש EasyPost יסרב במשפט ברור |
| 462 עד 503 | `priceAddOns` לפי כלל או קטלוג. `pickBest` לפי נטו ועוד כיסוי הדואר ועוד ימים כפול 2.50 | כיסוי הדואר חוזר לציון כדי שהמהיר לא ינצח וישרוף קרדיט |
| 509 עד 574 | `create`. `assertNotBlocked`, פריטים, `assertItemsFree`, יעד, `checkOptions` זורק על הבעיה הראשונה, קופסה, שורות מכס, insert ב `requested` | בלי טרנזקציה. אין אינדקס ייחודי על `shipment.code`. `recipientName` מהקלט גובר |
| 580 עד 601 | `listFor`, צוות רואה הכל, לקוח את שלו | בלי עימוד |
| 609 עד 651 | `toTrackingView`, הצורה האחידה של שורה | אין `fulfilmentMethod`, `quoteMinor`, `quoteNotes`. `HumanFulfilmentPanels.tsx` מסנן לפי `fulfilmentMethod` ולכן פאנל הצעת המסירה הידנית תמיד ריק |
| 653 עד 672 | `load` ו `loadFor`. לקוח זר מקבל `notFound`, צוות עובר תמיד | ה control נגד IDOR. גם מאפשר לאיש צוות לבחור, לשלם ולבטל בשם לקוח מהארנק שלו |
| 675 עד 691 | `profileOf`, טוען מחדש פריטים עם `loadShippableItems`, `destinationOf`, קופסה מ `boxSize` | נכשל אם פריט כבר לא `stored` |
| 693 עד 737 | `labelRequest`, משקל שנשקל פחות הקופסה, `RateRequest` ו `Rate` מהשדות השמורים כולל מזהי הספק | `costMinor` הוא מה שנגבה מהלקוח ולא מחיר המוביל. `EasyPostShippingAdapter.buyLabel` מתעלם מהבקשה, והמשקל שנשקל לא מגיע לספק |
| 740 עד 745 | `rates`, `loadFor`, `profileOf`, `priceServices` עם הכיסוי של בעל המשלוח | |
| 751 עד 771 | `selectRate`. סטטוס `requested`, `rates_selected` או `awaiting_payment`, לא ממוזג, תמחור מחדש, זכאות, `settle` | `rates_selected` ברשימה פירושו גבייה שנייה בלי זיכוי. אין בדיקת `fulfilmentMethod` |
| 780 עד 794 | `selectRecommended`, המומלץ, `serviceMode: 'simple'` מחוץ לטרנזקציה, `settle` | אין שום בדיקת סטטוס או מיזוג. משלוח `cancelled` חוזר לחיים ונגבה |
| 796 עד 862 | `settle`. ETA, יתרה מחוץ לטרנזקציה, ואז או `awaiting_payment` עם `paymentDueAt` חדש, או טרנזקציה עם `spendShippingCover`, `chargeFor` ו `rates_selected` | יתרה לא נעולה ו UPDATE בלי תנאי, E18. שתי בחירות מקבילות גובות שתיהן. בחירה חוזרת בהמתנה מאריכה את החלון בשבוע. ETA הוא עכשיו כש `estimatedDays` אפס |
| 872 עד 911 | `chargeFor`, שורת `charge` מסוג `shipping` עם snapshot ו `service_charge` ב ledger, באותו `tx` | אין אינדקס ייחודי על `charge.reference_id` |
| 913 עד 970 | `pay`. `awaiting_payment`, מחיר ומוביל, יתרה, ואז טרנזקציה עם כיסוי, חיוב ו `rates_selected` | בדיקה מחוץ לטרנזקציה ו UPDATE בלי תנאי. אם ה worker ביטל בינתיים, `pay` גובה ומחייה את המשלוח, E18. `!s.cost` דוחה משלוח שהכיסוי שילם. ה snapshot מדווח `handlingMinor: 0` |
| 977 עד 1006 | `expireUnpaid` | אף אחד לא קורא לו. המימוש שרץ הוא `apps/worker/src/jobs/shipment-expiry.ts` עם טקסט סיבה אחר |
| 1008 עד 1023 | `track`, `loadFor` ו `toTrackingView` | לא פונה לספק, מציג מה שה worker כתב |

**הנוסחה.** `totalMinor` הוא מחיר המוביל, או `flatCostMinor` לשירות קבוע, ועוד דמי טיפול מ `shipping`, ועוד rush אם התבקש, ועוד פרמיה, ועוד תוספות, פחות כיסוי החברות. זה הסכום שנקפא על השורה ב `cost` ונגבה מהארנק. `pay` לא מתמחר מחדש, ו `providerRateId` שנשמר עלול להיות בן שבוע כש `dispatch` קונה.

**כיוון תיקון.** לצמצם את `selectRate` ל `requested` ו `awaiting_payment`. להוסיף ל `selectRecommended` את אותן בדיקות. ב `settle` וב `pay`, UPDATE מותנה כמו `and(eq(shipment.id, s.id), eq(shipment.status, 'awaiting_payment'))` ובדיקה שנגעה שורה, ונעילה על הארנק לפני בדיקת היתרה. הוספת `fulfilmentMethod`, `quoteMinor` ו `quoteNotes` ל `toTrackingView` תחיה את פאנל המסירה הידנית. `tests/integration/shp-outbound.test.ts` מכסה את מסלול ההחזקה ואת החשבונית, ולא מכסה מקביליות או יתרה אחרי ביטול.

**החלטות שכדאי לשמר.** גבייה בבחירת שירות ולא ב dispatch, כדי שאף אחד לא ילך למדף על משלוח שלא שולם. החזקה ב `awaiting_payment` במקום יתרה שלילית, מתועד ונבדק. הקפאת המחיר על השורה, ש `pay` לא מתמחר מחדש. ו `loadFor` עם 404 ללקוח זר, דפוס עקבי שכל נתיב חדש צריך לעבור בו. הבעיה איננה ההחלטות, היא שהן מוחזקות רק לבקשה אחת בכל רגע, כי אין נעילה ואין תנאי סטטוס ב UPDATE.

#### `apps/api/src/modules/shp/shipment-edit.service.ts`
עריכה, מיזוג וביטול של משלוח קיים. עריכה מותרת רק ב `requested`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 61 | הזרקה ו `loadEditable`, `loadFor` ודחייה של ממוזג או שאינו `requested` | |
| 70 עד 133 | `update`. פריטים של `s.userId`, `assertItemsFree` בלי המשלוח הנוכחי, חתימה כפויה, `checkOptions`, קופסה, שורות מכס מחדש, UPDATE | ה UPDATE בלי `status = 'requested'`, עריכה מקבילה ל `selectRate` מוסיפה פריטים שלא שולמו. עריכה בלי `perItemCustomsValues` מוחקת ערכים פר פריט |
| 146 עד 232 | `merge`. לא עם עצמו, אותו בעלים ואותה כתובת, איחוד פריטים, סכום ערכים, ביטוח עד התקרה, חתימה OR, איחוד תוספות, קופסה גדולה או null. בטרנזקציה היעד מתעדכן והמקור `cancelled` עם `mergedIntoShipmentId` | UPDATEs בלי תנאי. A לתוך B ו B לתוך A במקביל משאירים שני מבוטלים. אין בדיקת `groupId` או `fulfilmentMethod` |
| 234 עד 319 | `cancel`. סיבה, `loadFor`, מותר מ `requested`, `awaiting_payment`, `rates_selected`. 25 דולר רק מ `rates_selected`, חיוב, `cancelled`, outbox `shipment_cancelled` | אין החזר של שום דבר, גם לא כיסוי חברות, אף שהתווית עוד לא נקנתה. ה UPDATE בלי תנאי, ביטול מקביל ל dispatch משאיר חבילה שיצאה כ `cancelled` |

**שים לב.** החזר בביטול דורש רשומת credit ב ledger, סימון של ה `charge` המקורי, והחזרת הכיסוי ל `membership_period`, כלומר נגיעה ב `pay/ledger.service.ts` וב `mem/membership.service.ts`. כי `picking` ו `packed` לא קיימים בפועל, החלון בין תשלום ל dispatch הוא שטח מת, אי אפשר לערוך וביטול עולה את כל הסכום.

#### `apps/api/src/modules/shp/customs.service.ts`
חשבונית מסחרית ובדיקת מוכנות למכס, כתצוגה של `customsLines` הקפואות. לא נשמר כלום.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 42 | הזרקה, הערה שהערך המוצהר של האספן | |
| 43 עד 122 | `invoice`. `loadFor`, זורק ליעד מקומי או בלי שורות, בעלים ומתקן ראשי, סכומים, שולח, נמען, מוביל, מעקב | המתקן נטען בלי בדיקת `active`. טקסט משתמש מוחזר כ JSON והסיכון ברינדור בצד הלקוח. `shp-outbound.test.ts` בודק שסכום השורות שווה לערך המוצהר |
| 125 עד 141 | `required` ו `outstanding` | לשניהם אין נתיב. `outstanding` טוען הכל לזיכרון |
| 167 עד 213 | `readiness`, אזהרות על שורות חסרות, ערך אפס ומשקל מוערך, ו `destinationGuidance` | `ready` לא חוסם dispatch |

**שים לב.** הפיכת `ready` לתנאי ל dispatch תחסום משלוחים עם משקל מוערך, שהם רוב המשלוחים. שינוי צורת `invoice` שובר את מסך החשבונית ואת הבדיקה ב `shp-outbound.test.ts`.

#### `apps/api/src/modules/shp/group-shipment.service.ts`
חבילה משותפת לכמה אספנים. כל אחד שומר משלוח ובעלות משלו. בפועל הקבוצה היא תווית מידע, `DispatchService` לא קורא `groupId` ושום דבר לא גובה מהמשלם.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 51 | הערה, הזרקה | ההערה ב `shipment-group.schema.ts` על תשלום המשלם סותרת את הקוד |
| 52 עד 89 | `open`. `loadFor` ובעלים זהה לקורא, `requested`, בלי קבוצה, טרנזקציה עם קוד `GRP` אקראי ועדכון `groupId` | גם צוות לא פותח בשם אחר |
| 98 עד 129 | `join`, קבוצה `forming`, משלוח של המצטרף ב `requested` עם כתובת זהה | המשלם לא מאשר מי מצטרף |
| 132 עד 154 | `leave`, לא המשלם, `forming` | |
| 157 עד 206 | `describe`, פרטי קבוצה וחברים עם שם מלא, משקל וערך | אין בדיקת הרשאה. `loadShippableItems` לכל חבר זורק ברגע שפריט אחד יצא או נמכר, ומפיל גם את `mine` |
| 209 עד 218 | `mine`, `describe` לכל קבוצה של המשתמש | |
| 232 עד 265 | `lock`, רק המשלם, `forming`, שני חברים לפחות, `locked` ו outbox `group_shipment_locked` לכל חבר עם הכתובת במטען | לא בודק סטטוס חברים, ואפשר לנעול קבוצה שכל חבריה ביטלו. ה UPDATE בלי תנאי. נעילה לא מונעת מחבר לבטל, לערוך או לבחור שירות אחר |
| 268 עד 288 | `cancel`, רק המשלם, לא אחרי `dispatched`, מנתק את כולם | `notes` נדרס בסיבה |

**כיוון תיקון.** להעביר את המשתמש מהבקר ל `describe` ולבדוק חברות, ולהחליף את `loadShippableItems` שם בטעינה פשוטה של פריטים. `join` ו `mine` ימשיכו לעבוד כי הם כבר עוברים דרך חבר. חיבור הקבוצה ל dispatch דורש שינוי ב `dispatch.service.ts` ובסכמה.

#### `apps/api/src/modules/shp/direct-ship.service.ts`
משלוח לילי ישיר של `parcel` מהמתקן הפטור ממס בדלאוור, בלי כניסה לכספת. 100 דולר, עד חמישה קלפים, מקומי.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 65 | הערה ו `terms` מתוך הקטלוג | |
| 74 עד 98 | `eligibility`, חבילה `received`, לא הועברה, מתקן DE. `loadParcel` מחזיר `notFound` לזרה | ה control נגד IDOR על חבילות |
| 109 עד 163 | `request`, בדיקות מחוץ לטרנזקציה. ארנק, שירות, זכאות, 1 עד 5 קלפים, יעד US, ביטוח עם `Math.min`, פרמיה ויתרה | לא קורא ל `checkOptions`, מקצץ ביטוח במקום לסרב |
| 164 עד 268 | טרנזקציה. משלוח עם `itemIds: []` ישר ל `rates_selected`, חיוב, ledger, `parcel` ל `processed`, `parcel_event` מסוג `direct_shipped`, outbox `direct_ship_booked` | אין דרך לסגור את המשלוח. `DispatchDto` דורש מערך לא ריק ו `loadShippableItems` זורק על ריק. ה UPDATE של החבילה בלי תנאי, שתי בקשות מקבילות גובות 200 דולר. ביטול גובה 25 ולא מחזיר 100 |

**כיוון תיקון.** מסלול dispatch שמזהה `serviceKey === DIRECT_OVERNIGHT_KEY` ולא דורש פריטים, יחד עם שינוי `DispatchDto`. הסרת `ArrayNotEmpty` לבדה לא מספיקה, כי `labelRequest` עדיין ייכשל על רשימה ריקה. `tests/integration/shp-outbound.test.ts` עוצר אחרי ההזמנה ולא מגיע לשליחה.

#### `apps/api/src/modules/shp/dispatch.service.ts`
שליחה מאומתת בסריקה. נקרא מ `POST /shipping/shipments/:id/dispatch` לצוות. הרגע היחיד שה API מוציא כסף אצל ספק.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 41 | הזרקה, הערות על הסריקה ועל `labelRequest` | |
| 42 עד 47 | `custody.run` ונעילת המשלוח `FOR UPDATE`, דורש `rates_selected` | אין בדיקת `fulfilmentMethod`. איסוף או מסירה ידנית ששולמו יכולים לקבל תווית |
| 49 עד 62 | טופס עם מוביל, הערות ומשקל חיובי, ושוויון סטים בין הסרוק ל `itemIds` | control חזק נגד שליחה חלקית או עודפת |
| 64 עד 74 | `labelRequest` ואז `buyLabel` בתוך הטרנזקציה הפתוחה | קריאת רשת שמוציאה כסף, בלי timeout, עם נעילה וחיבור תפוסים. `labelRequest` קורא פריטים על חיבור אחר |
| 76 עד 78 | `changeState` ל `shipped` לכל פריט | כשל כאן מגלגל אחורה אחרי שהתווית נקנתה, ומספר המעקב אובד |
| 80 עד 110 | UPDATE ל `shipped` עם מעקב, מפתח תווית, משקל, `fulfillment`, ו outbox `shipment_out` | `form.carrier` לא מושווה ל `s.carrier`. `label.costMinor` לא נשמר, אין התאמה בין גבייה לעלות |

**שים לב.** התיקון הסביר הוא שלושה שלבים, לסמן `labeled` ולבצע commit, לקנות מחוץ לטרנזקציה ולשמור מעקב, ורק אז `shipped`. זה ידרוש לעדכן את `cancel` ואת `OPEN_STATUSES`.

**מה נשבר בשינוי.** שינוי הסטטוס הסופי מ `shipped` שובר את `tracking-refresh` שבוחר רק `shipped` ו `in_transit`. הוצאת `buyLabel` מהטרנזקציה מחייבת סטטוס ביניים ובדיקה שלו ב `cancel` וב `OPEN_STATUSES`. שוויון הסטים חייב להישאר, הוא ה control היחיד נגד שליחה חלקית.

#### `apps/api/src/modules/shp/human-fulfilment.service.ts`
מסירה ידנית, white glove, ואיסוף בתערוכה. אדם ולא חבילה, נסגר בחתימה ולא בסריקת מוביל. משתמש באותה טבלת `shipment`, ו `rates_selected` כאן פירושו שולם.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 85 | הזרקה ו `whiteGloveTerms`, שתי `tryPrice` במקביל | |
| 94 עד 156 | `requestHandDelivery`. ארנק, פריטים, `assertItemsFree`, `checkHandDelivery`, insert ב `requested` בלי מחיר, ואז outbox `white_glove_requested` בטרנזקציה נפרדת | ה insert מחוץ לטרנזקציה, סטייה מ P3. כשל בפליטה משאיר משלוח בלי אירוע. המדינה לא מאומתת |
| 159 עד 198 | `quoteHandDelivery` לצוות, סכום והערות, `requested`, עדכון הצעה ו outbox `white_glove_quoted` | אין הגבלה על ציטוט חוזר, והלקוח לא שולח את הסכום שהוא מאשר |
| 206 עד 254 | `acceptQuote`. `loadFor`, שיטה, הצעה, `requested`, יתרה מחוץ לטרנזקציה, ואז חיוב, ledger ו `rates_selected` | E18. UPDATE בלי תנאי, שתי קבלות גובות פעמיים. אותו מפעיל יכול לצטט ולאשר בשם הלקוח. בלי `assertNotBlocked` |
| 266 עד 308 | `pickupShows`, תערוכות פעילות שמקבלות איסוף, ספירת משלוחים לכל אחת, `remaining` ו `open` | N ועוד 1 |
| 317 עד 411 | `requestPickup`. ארנק, פריטים, `assertItemsFree`, דדליין ומקום מחוץ לטרנזקציה, ובתוכה ויתור חברות לפני בדיקת היתרה, כדי שויתור שנכשל לא ייצרך, יתרה, insert ישר ל `rates_selected`, חיוב, outbox `show_pickup_booked` | הקיבולת לא נעולה, בקשות מקבילות עוברות את התקרה. ויתור שנכשל מתגלגל יחד |
| 426 עד 488 | `handOver` לצוות. נעילת המשלוח, לא `carrier`, `rates_selected`, שוויון סטים, `changeState` ל `shipped`, `delivered` עם מי קיבל, outbox `handed_over` | אין קריאה חיצונית, הטרנזקציה נקייה |

**שים לב.** כל פונקציה שבודקת `rates_selected` צריכה לזכור שזה לא בהכרח משלוח מוביל. `selectRate`, `selectRecommended` ו `dispatch` לא זוכרים. הוספת סכום צפוי לקבלת הצעה דורשת שינוי ב DTO וב `HumanFulfilmentPanels.tsx`.

#### `apps/api/src/modules/shp/shp.controller.ts`
כל נתיבי `/shipping`. דפוס P2. ה DTO כאן, הבעלות בשירות, בעיקר ב `loadFor`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 146 | ה DTO. `ShipmentOptionsDto` בסיס ליצירה ועריכה עם `@IsIn(SHIPPING_BOX_KEYS)`. `CreateShipmentDto`, עריכה, בחירה, מיזוג, ביטול, קבוצות, `DirectShipDto`, `HandDeliveryDto`, `QuoteDto`, `PickupDto`, `HandOverDto`, `DispatchDto` | `perItemCustomsValues` רק `@IsObject()`. מדינה רק `@MaxLength(2)` בלי `@IsShippableCountry`. תאריכים בלי `@IsDateString`. `DispatchDto` עם `@ArrayNotEmpty` חוסם את המשלוח הישיר. ההערה בשורות 105 עד 109 שייכת ל `DispatchDto` |
| 149 עד 197 | המחלקה עם שבעה שירותים, `GET countries`, `GET services`, `POST quote` | |
| 199 עד 240 | `POST shipments`, `GET shipments`, `GET groups`, `POST groups`, `groups/join`, `groups/leave`, `GET groups/:id` | `GET groups/:id` לא מעביר את המשתמש לשירות, כל משתמש מחובר עם מזהה קורא שמות וכתובת |
| 243 עד 313 | `groups/:id/lock` ו `cancel`, `white-glove/terms`, `POST white-glove`, `white-glove/:id/quote` לצוות, `white-glove/:id/accept`, `pickup/shows`, `POST pickup`, `direct/terms`, `direct/:parcelId/eligibility`, `POST direct/:parcelId` | |
| 317 עד 372 | `shipments/:id/rates`, `select-rate`, `choose-for-me`, `pay`, `PATCH shipments/:id`, `merge`, `cancel`, `customs`, `customs/readiness` | כולם דרך `loadFor`. `choose-for-me` בלי בדיקת סטטוס |
| 374 עד 411 | `GET destinations/:country` ציבורי, `hand-over` ו `dispatch` לצוות, `GET shipments/:id` אחרון | אין `ParseUUIDPipe`, מזהה לא תקין נכשל ב Postgres עם `22P02` והמסנן הגלובלי מחזיר 400. שגיאות EasyPost הן `Error` רגיל ויוצאות 500 אטום |

**שלושה דפוסי בעלות.** `loadFor` מחזיר 404 ללקוח זר ומעביר צוות תמיד, ולכן כל פעולה דרכו, כולל `pay`, `select-rate`, `cancel` ו `white-glove/:id/accept`, יכולה לחייב לקוח בפעולה של עובד. בקבוצות, `open`, `join` ו `leave` מוסיפים השוואה ל `userId` וזורקים 403 גם לצוות. בחבילות ישירות `loadParcel` בודק `ownerId`. נתיב חדש שמקבל `:id` חייב לעבור באחד מהם, ו `describe` הוא הדוגמה למה שקורה כשהמשתמש לא מועבר. מי ביצע פעולה בשם לקוח נשמר רק ב `quotedBy`, `fulfilledBy` וברשומת ה `AuditInterceptor`.

**סדר הנתיבים.** `GET shipments` מוגדר לפני `GET shipments/:id` ו `GET shipments/:id` מוגדר אחרון. ב Express זה לא חובה לזוג הזה, כי לפרמטר חסר מקטע, אבל זה חשוב לליטרלים באותו עומק כמו `groups/join` מול `groups/:id`. שמרו על ההרגל ונתיבים ספציפיים יבואו לפני פרמטרים.

#### `apps/api/src/modules/shp/shp.module.ts`
דפוס P1, בקר אחד ושמונה ספקים. `exports: [ShipmentService]` בלי צרכן, `cst/inventory.service.ts` קורא את טבלת `shipment` ישירות. הסרת `ShipmentService` שוברת את חמשת השירותים שמזריקים אותו.

**תלויות `shp`.** קורא ל `cst/custody.service.ts`, `pay/ledger.service.ts`, `pay/wallet.service.ts`, `prc/pricing.service.ts`, `mem/membership.service.ts` לכיסוי ולוויתור, `not/outbox`, ו `SHIPPING_ADAPTER` מ `shared/adapters/adapters.module.ts`. כותב `shipment`, `shipment_group`, `charge`, `ledger_record`, `membership_period`, `parcel`, `parcel_event`, `item`, `custody_event`, `outbox_message`. `cst/inventory.service.ts` קורא את `shipment` ישירות. הצרכנים ב SPA הם המסכים תחת `apps/web/src/areas/customer/shipping` וקונסולת המחסן.

## פרק 7. ה worker והבדיקות

### סקירה

ה worker הוא תהליך Node נפרד, בלי Nest ובלי HTTP. הוא מריץ שמונה עבודות רקע דרך pg-boss 10.4.2 מול אותו PostgreSQL של ה API. כל עבודה היא פונקציה שמקבלת `Pool` ומריצה SQL גולמי, ולכן אף guard, service או validation של ה API לא חל עליה. כל כלל עסקי שהיא אוכפת כתוב בה מחדש, ולפעמים בנוסח אחר מה API. ה API מדבר עם ה worker רק דרך טבלאות, בעיקר `outbox_message`. אף בדיקה בריפו לא מריצה עבודה של ה worker, וה CI לא מפעיל אותו.

הבדיקות יושבות בשתי תיקיות. `tests` מחזיק שש שכבות, integration, concurrency ו property מול API חי, contract על ה adapters, web לפונקציות טהורות ו ux לרכיבי React ב jsdom. `tests3` מחזיק חבילות אדברסריות שבודקות מהצד הלא נכון. כל הבדיקות החיות נשענות על `tests/integration/helpers/http.ts`.

סדר קריאה. `apps/worker/src/index.ts`, אחריו העבודות שמזיזות כסף, `storage-fee.ts`, `debt.ts`, `interest-accrual.ts`, `membership-renewal.ts`, ואז ה outbox. אחר כך `tests/README.md`, `helpers/http.ts`, `tests/ux/setup.ts` ורק אז הטבלאות של קבצי הבדיקה.

| קובץ | מה הוא עושה |
|---|---|
| `apps/worker/package.json` | ה manifest של `@bault/worker`. תלוי ב `pg`, ב `pg-boss` בטווח caret שה lockfile פותר ל 10.4.2, וב `@bault/config` ו `@bault/adapters` דרך ה `dist` שלהן, ולכן `dev` בונה אותן קודם. אין סקריפט `test`. |
| `apps/worker/tsconfig.json` | יורש מה base, CommonJS עם `outDir` `dist`. מכבה `isolatedModules` כי `JobName` מיוצא גם כ value וגם כ type. `noUncheckedIndexedAccess` מה base הוא הסיבה ל `rows[0]!` בכל העבודות. |
| `apps/worker/src/jobs/registry.ts` | `JobName`, תשעה שמות תורים כ const וכ union type. `IMAGE_SYNC` מוגדר ולא נרשם בשום מקום. ההערה טוענת שה API הוא producer, אבל ה API לא משתמש ב pg-boss כלל. שינוי ערך כאן הוא שינוי שם תור, וה schedule הישן נשאר חי. |

#### `apps/worker/src/index.ts`

נקודת הכניסה, שרצה ב Docker כ `node dist/index.js`. מחבר כל עבודה לתור, ל handler ול cron. כאן נקבעות ברירות המחדל של ההרצה, ובפועל לא נקבע כלום. דפוס P7 בגרסה הבסיסית ביותר.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 26 | imports של pg-boss, `pg`, `loadEnv`, `JobName` ושמונה העבודות, והערת קובץ. | ההערה אומרת שהחיבור הישיר נחוץ בגלל LISTEN ו NOTIFY. זה שגוי לגרסה המותקנת, שעושה polling. החיבור הישיר עדיין נכון, כי עבודות מחזיקות `client` לאורך `BEGIN` ו `COMMIT` ו PgBouncer במצב transaction לא מתאים לזה. |
| 27 עד 37 | `loadEnv()`, `Pool` של `pg` ומופע `PgBoss`, שניהם על `DIRECT_DATABASE_URL` ושניהם עם 10 חיבורים כברירת מחדל. `boss.on('error')` מדפיס. `boss.start()` מריץ migrations של סכמת `pgboss` ומדליק supervisor ו timekeeper. | `loadEnv` מאמת את כל סכמת ה API, כך שה worker לא עולה בלי `SESSION_COOKIE_SECRET`, משתני `STORAGE_*` ו `PAYMENT_PROVIDER` שהוא לא צורך. עבודה שנכשלה לא מגיעה ל `error`, כי pg-boss תופס את החריגה וכותב אותה רק ל `pgboss.job`. |
| 39 עד 61 | מערך הצהרתי של שם, cron ו `run`. `outbox.dispatch` כל דקה, `storage-fee.run` ב `02:00`, `interest.accrual` ב `03:00`, `wallet.suspension-sweep` ב `03:15`, `ledger.invariant-check` כל שעה עגולה, `shipment.tracking-refresh` כל 30 דקות, `shipment.expiry-sweep` בדקה 20, `membership.renewal` בדקה 40. | כל ה cron ב UTC, כי לא מועבר `tz`. `02:00` הוא ארבע או חמש בבוקר בישראל. ההערה בשורות 46 עד 48 מניחה שהריבית מסתיימת לפני `03:15`, אין תלות אמיתית. ההערה בשורות 56 עד 59 מניחה שהחידוש קודם ל sweep, וזה לא נכון למחזור שנגמר בין `01:40` ל `02:00`, ראה `storage-fee.ts`. |
| 63 עד 71 | לכל עבודה `createQueue`, `work` עם handler שקורא `job.run()`, ו `schedule`. | `createQueue` ו `schedule` הם upsert, ולכן עליה חוזרת בטוחה. אין שום אופציה לתור, כך שחלים `retry_limit` 2 עם `retry_delay` 0 ו `expire_in` של 15 דקות. הוספת `policy` אחר כך לא תשנה תור קיים, כי ה INSERT הוא `ON CONFLICT DO NOTHING`, צריך `updateQueue`. |
| 73 עד 81 | `main` מסתיים והתהליך חי על הטיימרים של pg-boss. חריגה בעליה מדפיסה ויוצאת עם 1. | אין מאזין ל `SIGTERM` ואין `boss.stop`, זה E15. עבודה בלי טרנזקציה נעצרת באמצע, וה job נשאר `active` עד שה supervisor מסמן אותו כפג תוקף ומריץ שוב. |

**שים לב.** שלוש מסקנות חוזרות בכל עבודה. עבודה שנכשלה רצה שוב מיד, עד פעמיים, ולכן עבודה לא אידמפוטנטית מכפילה כתיבה. עבודה ארוכה מ 15 דקות מסומנת כנכשלת בזמן שה handler הישן עדיין רץ, וה retry רץ במקביל אליו באותו תהליך. שני מופעים, למשל ב rolling deploy, מריצים כל עבודה בלי נעילה, ואף עבודה לא לוקחת advisory lock. cron שהוחמץ כשה worker היה כבוי לא מושלם. הסרת עבודה מהמערך לא מוחקת את השורה ב `pgboss.schedule`, צריך `boss.unschedule(name)` פעם אחת.

העובדות על pg-boss 10.4.2 שכל עבודה נשענת עליהן, כפי שהן בקוד המותקן.

| נושא | מה קורה בפועל |
|---|---|
| תור | `createQueue` בלי אופציות יוצר תור `standard`. שני מופעים מושכים עבודות שונות מאותו תור במקביל. |
| retry | `retry_limit` 2 ו `retry_delay` 0, בלי backoff. |
| תפוגה | `expire_in` 15 דקות דרך `Promise.race` מול טיימר. ה promise המקורי ממשיך לרוץ, ואיש לא עוצר אותו. |
| מקביליות בתהליך | `Worker` אחד לתור, מושך עבודה אחת וממתין ל handler. אין הרצה כפולה בתהליך אחד, חוץ ממקרה התפוגה. |
| cron | timekeeper כל 30 שניות, נעילה ברמת DB דרך `trySetCronTime`, ו `singletonKey` בשם העבודה. נוצרת עבודה אחת לכל תקתוק גם עם כמה מופעים. |
| תקתוק שהוחמץ | `shouldSendIt` בודק רק את 60 השניות האחרונות. worker שהיה כבוי ב `02:00` לא ישלים את `02:00`. |
| כשלון handler | `onFetch` קורא ל `fail` בלי לפלוט `error`. הכשלון נשאר רק כשורה ב `pgboss.job`, ונמחק אחרי retention של 14 יום. |
| כיבוי | pg-boss לא רושם מאזין לאותות, ו `stop` לא נקרא. |

**להוספת עבודה.** כותבים ב `src/jobs` פונקציה שמקבלת `Pool`, מוסיפים שם ל `registry.ts` ושורה למערך בשורות 40 עד 61. בגלל ה retry המיידי, כל עבודה שכותבת כסף חייבת להיות אידמפוטנטית בעצמה, טרנזקציה אחת עם `FOR UPDATE` כמו `shipment-expiry.ts`, או מפתח ייחודי במסד שה INSERT נבלע מולו. ספירה ואז INSERT אינה הגנה. עבודה שכותבת חיוב צריכה גם כניסה בבדיקת ה invariants.

#### `apps/worker/src/jobs/outbox-dispatch.ts`

החצי השני של ה transactional outbox. ה API כותב `outbox_message` באותה טרנזקציה של שינוי המצב דרך `OutboxService.emit`, והעבודה הזו הופכת כל שורה שלא נשלחה להתראות in_app ולמייל. בלי הקובץ אף משתמש לא מקבל התראה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 33 | imports של `loadEnv`, adapters של מייל, `notificationMessage`, `defaultEmailEnabled` ו `eventSubject`, והערה עם שלוש הבטחות. | שלוש ההבטחות מתקיימות, in_app קודם ובנפרד, מייל שנכשל נרשם כ `failed`, רק חשבון `active` מקבל מייל. ההבטחה ההפוכה, שהודעה לא נשלחת פעמיים, לא קיימת. |
| 34 עד 48 | `recipientsOf` מחזיר את `recipientIds` אחרי סינון וביטול כפילויות, ואם אין, את הראשון שקיים מבין `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`. | הסדר ברשימה הוא חוזה שקט עם ה emitters ב API. event עם `sellerId` ו `buyerId` בלי `recipientIds` מגיע רק למוכר. שינוי שם מפתח ב emitter גורם להודעה להיצרך בלי נמען ובלי שגיאה. |
| 50 עד 73 | `emailAdapter`, singleton ברמת המודול. SMTP אם `EMAIL_PROVIDER` הוא `smtp`, אחרת console. | ה transport של nodemailer נבנה בלי timeouts, כך ששליחה תקועה יכולה להימשך דקות ולדחוף את ההרצה מעבר ל 15 דקות. console מדפיס כתובת ותוכן ללוג, ו `loadEnv` חוסם אותו רק ב production. |
| 75 עד 97 | `Recipient` ו `channelEnabled`. שורה ב `notification_preference` לפי משתמש, event וערוץ קובעת. בלי שורה, in_app דלוק תמיד ומייל לפי `defaultEmailEnabled`. | זו אותה סמנטיקה כמו ב API, חוץ מ `mandatoryInApp`. ה API מסרב לשמור כיבוי של התראת חובה, אבל ה worker יכבד שורה כזו אם תגיע לטבלה בדרך אחרת. |
| 99 עד 110 | `SELECT` מ `outbox_message` עם `dispatched_at IS NULL` לפי `created_at`. | בלי `LIMIT` ובלי `FOR UPDATE SKIP LOCKED`. האינדקס החלקי `outbox_undispatched_idx` ממיגרציה 0024 הופך את זה לזול כשהתור קטן, אבל backlog של יום נטען כולו לזיכרון. |
| 112 עד 173 | לכל שורה בונה `message` ו `content`, שהוא ה payload ועוד `message`. לכל נמען, INSERT ל `notification` ב in_app אם דלוק, ואם מייל דלוק שולף את `user_account`, מדלג על חשבון לא `active` או בלי מייל, שולח, וכותב שורת מייל `sent` עם `provider_ref` או `failed` עם 500 תווי שגיאה. בסוף `UPDATE outbox_message SET dispatched_at = now()` בשורה 172. | כל INSERT הוא autocommit, אין `BEGIN` ואין claim. קריסה אחרי שליחה ולפני שורה 172, retry של pg-boss אחרי חריגה, הרצה ארוכה מ 15 דקות או שני מופעים, כולם שולחים שוב in_app ומייל. אין אילוץ ייחודי על `notification`. התיקון הוא claim עם `SKIP LOCKED` או מפתח ייחודי לפי מזהה outbox, נמען וערוץ. |
| 175 עד 178 | שורת לוג עם ספירות. | זה ה signal היחיד שהעבודה רצה. |

**שים לב.** תרחישי תקלה. הרצה שניה ברצף בטוחה, כי השורות כבר מסומנות. קריסה אחרי שליחה ולפני הסימון, שני מופעים, או הרצה ארוכה מ 15 דקות בגלל SMTP איטי ו backlog, שולחים הכל שוב. חריגת DB באמצע, למשל INSERT שנכשל, מפעילה retry מיידי, וכל הנמענים שכבר טופלו בשורה הנוכחית מקבלים כפילות. הוספת event ב API בלי `case` ב `notification-message.ts` נותנת משפט גנרי, ובלי כניסה ב `notification-events.ts` לא יישלח מייל.

#### `apps/worker/src/jobs/notification-events.ts`

לכל סוג event, האם מייל דלוק כברירת מחדל ומה נושא המייל. עותק לפי ערך של חלק מ `apps/api/src/modules/not/event-types.ts`, כי ה worker לא מייבא מעץ ה API. אין imports.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 19 עד 54 | `EMAIL_BY_DEFAULT`, `Set` של 34 מפתחות. | תואם בדיוק את `emailByDefault: true` בקטלוג של ה API, שיש בו 41 מפתחות. |
| 63 עד 65 | `defaultEmailEnabled` מחזיר `false` לכל מפתח לא מוכר. | event חדש לא מתחיל לשלוח מייל בלי החלטה. |
| 74 עד 121 | `SUBJECTS` עם נושא לכל 41 המפתחות, ו `eventSubject` עם fallback גנרי. | |

**שים לב.** מה שמחזיק את השכפול הוא `tests/web/notification-catalogue.test.ts`, שמייבא את שני הצדדים ומשווה. `mandatoryInApp` לא שוכפל לכאן.

#### `apps/worker/src/jobs/notification-message.ts`

מרנדר משפט באנגלית לכל event מתוך ה payload. המשפט נשמר ב `content.message` ונשלח גם במייל. הצרכן היחיד הוא `outbox-dispatch.ts` שורה 117. אין imports ואין בדיקה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 44 | עזרים. `str` מחזיר מחרוזת לא ריקה או `null`, `num` מספר סופי או `null`, `usd` מחלק ב 100 ומעצב ב `en-US`, `ref` מחזיר את הערך הראשון מרשימת מפתחות וחותך ל 8 תווים ערך ארוך מ 12, `titleCase` הופך שם event לכותרת. | הפונקציה לא זורקת לעולם על payload עם טיפוס שגוי. `usd` מניח שכל סכום הוא USD. `ref` משאיר קוד אנושי כמו `SH-ABCD1234` שלם וחותך UUID. |
| 46 עד 253 | `switch` עם `case` לכל event, גרסה עשירה כשהשדה קיים וגרסה חסרה כשלא. דוגמאות, `item_sold` משתמש ב `price`, `parcel_damaged` מוסיף את `conditionNotes` של המפעיל, `escrow_inspected` בודק `p.matches === true`. | שינוי שם שדה ב emitter של ה API מאבד מידע מהמשפט בשקט. טקסט חופשי של מפעיל לא הופך להזרקה במייל, כי `renderEmail` עושה escaping. שינוי ניסוח לא משנה שורות שכבר נכתבו. |
| 254 עד 259 | `default` מחזיר את שם ה event בכותרת. | |

**שים לב.** כדי להוסיף event, מוסיפים `case` עם אותם עזרים ובודקים מול ה emitter ב API אילו שמות שדות הוא באמת שולח. אין i18n כאן, ה SPA מתרגם לפי המפתח.

#### `apps/worker/src/jobs/storage-fee.ts`

היצרן היחיד של חיובי אחסון. פעם ביום ב `02:00` UTC עובר על כל פריט `stored`, סופר כמה תקופות חיוב התחילו מאז סוף התקופה הכלולה, מחסיר את מספר חיובי האחסון שכבר קיימים לפריט, ומחייב את ההפרש. כל תקופה היא שורת `charge` ושורת `ledger_record` מסוג `service_charge` בכיוון `debit`. מסך הכספת ב API, `vault.service.ts` ו `storage-policy.ts`, קורא את מה שנכתב כאן. דפוס P7 עם טרנזקציה אחת להרצה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 48 | import של `Pool` והערה. המודל, 180 יום כלולים ואז 10 אחוז מדמי ה intake לכל 90 יום, ולפריט oversized 90 יום ואז 100 אחוז. האידמפוטנטיות היא ספירת החיובים הקיימים. | ההערה טוענת שהחישוב ב SQL מונע read then write race. זה לא נכון, ה CTE סופר והלולאה מכניסה אחר כך. ההבטחה שהרצה שניה לא מחייבת נכונה רק כשההרצות רצות זו אחרי זו. |
| 49 עד 53 | `pool.connect()` ו `BEGIN` אחד לכל ההרצה. | קריסה באמצע מגלגלת הכל, וההרצה הבאה מחייבת מאפס. זה ההבדל מ `interest-accrual.ts`. |
| 54 עד 87 | `SELECT DISTINCT ON (action_type)` מ `pricing_rule` על `storage` ו `storage_oversized` שבתוקף, העדכני לכל סוג. בלי `storage`, `ROLLBACK`, warning ויציאה. בלי `storage_oversized`, הכלל הרגיל משמש גם לפריט גדול. | |
| 89 עד 113 | `num` קורא מפתח מ `parameters` עם ברירת מחדל לערך לא סופי או שלילי. `params` בונה לכל וריאנט `freeDays`, `periodDays` עם מינימום 1, `bps`, מזהה כלל, מטבע, `flat` מ `value` ו `effectiveFrom`. | סטיה מה API. בלי כלל oversized, `num(oversized.parameters, 'freeDays', 90)` קורא את הכלל הרגיל, שב seed כותב `freeDays: 180` במפורש. פריט גדול יקבל 180 יום ו 10 אחוז, וה API יציג 90 יום ו 100 אחוז לפי `OVERSIZED_STORAGE`. |
| 115 עד 136 | פתיחת השאילתה הגדולה ו CTE `policy`, שמונה פרמטרים כשורה אחת עם טיפוסים מפורשים. | |
| 141 עד 157 | `member_cap`. לכל מנוי `active` או `cancelling` שנמצא עכשיו בתוך המחזור, מספר הפריטים הכלולים מ `parameters ->> 'storedItems'` של הכלל `membership:<tier>` העדכני, דרך `JOIN LATERAL`. | מנוי שהכלל שלו חסר נופל מה join ואינו מכוסה כלל. המנוי בפער בין סוף מחזור לחידוש לא נמצא כאן. |
| 163 עד 177 | `member_covered`. ממספר פריטי `stored` של כל מנוי לפי `received_at` ואז `id`, ומשאיר `rn <= stored_items`. | הישנים מכוסים ראשונים, לטובת יציבות. לא נרשמת צריכה ב `membership_period.consumed`, בניגוד ל `memberships.consume` ב API. |
| 178 עד 197 | `stored`. כל פריט `stored` עם `received_at` שאינו מכוסה. `intake_minor` הוא סכום חיוב ה `intake` האחרון של הפריט, ואם אין, `flat` של הכלל. `periods_billed` סופר חיובי `storage` ו `storage_oversized` לפי `reference_id`. | `periods_billed` הוא מגן האידמפוטנטיות. האינדקס `charge_action_reference_idx` ממיגרציה 0010 תומך בשתי תת השאילתות. שינוי שם `action_type` של intake ב API מפיל את כל הפריטים ל `flat`. |
| 198 עד 209 | `computed` בוחר `free_days`, `period_days` ו `bps` לפי `oversized`. | |
| 210 עד 223 | `elapsed`. `floor(seconds_since_free_end / (period_days * 86400)) + 1`, רק לפריטים שעברו את התקופה הכלולה. | ה `+ 1` אומר שביום הראשון אחרי התקופה הכלולה כבר מחויבת תקופה שלמה מראש. שינוי שלו מחייב שינוי ב `nextChargeAt` ב `storage-policy.ts`. `make_interval` לפי אזור הזמן של ה session, וה API מחשב במילישניות קבועות, פער של עד שעה ב session שאינו UTC. |
| 224 עד 241 | SELECT סופי, `periods_due` הוא `periods_elapsed - periods_billed`, וסכום לתקופה `GREATEST(1, ROUND(intake_minor * bps / 10000.0))`. | מינימום סנט אחד. `periodChargeMinor` ב API מחזיר 0 כשה intake הוא 0, כך שהמסך אומר 0 וה worker גובה סנט. |
| 243 עד 289 | לכל שורה ולכל תקופה, INSERT ל `charge` עם snapshot של הכלל, `settled`, אמצעי `wallet`, ואז INSERT ל `ledger_record` `service_charge` `debit` עם `reference_type` `charge`. | אותן שורות ש `BillingService.charge` כותב. `if (!chargeId) continue` בשורה 277 מיותר, `RETURNING` מחזיר שורה או זורק. |
| 291 עד 315 | INSERT ל `storage_fee_run` עם `triggered_by` `system`, `COMMIT`, לוג. ב catch `ROLLBACK` שבולע שגיאה משלו ו rethrow, `finally` משחרר. | `threshold_days` מקבל את `freeDays` הרגיל, שם עמודה מהמודל הישן. |

**שים לב.** התנהגות תחת תקלות. הרצה כפולה ברצף בטוחה, הספירה מתעדכנת. קריסה באמצע בטוחה, הכל מתגלגל. יום שהוחמץ מושלם בהרצה הבאה. שני באגים. הראשון, חיוב רטרואקטיבי. `periods_elapsed` נמדד מ `received_at`, ופריט מכוסה מנוי פשוט מדולג בלי ש `periods_billed` עולה. כשהכיסוי נגמר, כל התקופות שהצטברו מחויבות בבת אחת. פריט שכוסה 400 יום יחויב על שלוש תקופות מיד. זה קורה גם בפער קצר, מחזור שנגמר ב `01:50` מחודש רק ב `02:40`, וה sweep של `02:00` מחייב בינתיים. זה סותר את ההבטחה בהערה של `MembershipService.cancel`. השני, הספירה וה INSERT הם read then write בלי נעילה ובלי אילוץ ייחודי, כך ששתי הרצות חופפות מחייבות פעמיים. תיקון אמיתי דורש עמודת מספר תקופה ב `charge` ואינדקס ייחודי, או `pg_advisory_xact_lock`. `AdmService.runStorageFees` ב API הוא מימוש ישן ומת של אותו דבר, בלי אידמפוטנטיות, וההערה שלו טוענת בטעות שה worker קורא לו.

#### `apps/worker/src/jobs/debt.ts`

שאילתה משותפת לשתי עבודות החוב. `negativeAccounts` מחזירה לכל חשבון שהיתרה שלו שלילית עכשיו את היתרה, את החוב, ומתי התחילה ריצת החוב הנוכחית. אין עמודת יתרה במערכת, וזה המחיר.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 23 | `DebtPosition`, `balanceMinor` שלילי, `debtMinor` ערך מוחלט, `negativeSince` ו `negativeDays` שלמים. | |
| 24 עד 38 | הערה שמסבירה למה החציה האחרונה ולא הראשונה. | הטענה בשורות 36 עד 38 שחשבונות סולבנטיים מסוננים לפני החישוב שגויה. |
| 39 עד 49 | CTE `running`, יתרה מצטברת לכל משתמש עם window function לפי `occurred_at` ואז `id`. | סורק וממיין את כל `ledger_record` בכל הרצה, פעמיים ביום. `id` הוא UUID אקראי, שובר שוויון דטרמיניסטי ולא לפי סדר הכנסה. |
| 50 עד 56 | `crossings` מוסיף `LAG` של היתרה הקודמת. | |
| 57 עד 63 | `owing`, יתרה סופית שלילית לכל משתמש. `HAVING` חוזר על הביטוי. | הסכום מתעלם מ `currency` ומחבר את כל המטבעות. |
| 64 עד 72 | `went_negative` לוקח את `MAX(occurred_at)` של חציה מאי שלילי לשלילי, ו SELECT מחבר אותו ל `owing`. | חוב שנפרע וחזר לא נושא ריבית על התקופה הקודמת. |
| 75 עד 87 | מיפוי. `negativeDays` לפי `Date.now()` של התהליך. | שעון ה worker ולא `now()` של המסד, סטיית שעון מזיזה את גבול ימי ההשהיה. |

**שים לב.** כל שינוי כאן משפיע על ריבית ועל השעיה, ואין לו בדיקה. הוספת `WHERE user_id IN (SELECT user_id FROM owing)` בתוך `running` תממש את מה שההערה מבטיחה.

#### `apps/worker/src/jobs/interest-accrual.ts`

פעם ביום ב `03:00` UTC, לכל חשבון שלילי ברציפות לפחות `WALLET_DEBT_GRACE_DAYS` ימים, ברירת מחדל 14, מוסיף `ledger_record` מסוג `interest` בכיוון `debit` בגובה `WALLET_DEBT_INTEREST_BPS`, ברירת מחדל 5, מהחוב. אין ב API קוד שכותב ריבית, זה הבעלים היחיד של הכלל.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 32 | imports, קריאת קונפיגורציה, יציאה מוקדמת אם השיעור 0. | |
| 34 עד 35 | `negativeAccounts` וסינון לפי ימי ההשהיה. | |
| 37 עד 46 | `Math.max(1, Math.floor(debt * bps / 10000))` ו INSERT עם `currency` קבוע `USD`, `reference_type` `interest` ובלי `reference_id`. | כל INSERT autocommit. החוב כולל ריבית קודמת, כלומר ריבית דריבית יומית בלי שזה כתוב. `floor` כאן ו `ROUND` באחסון, שני כללי עיגול. |
| 48 עד 52 | לוג. | |

**שים לב.** העבודה הפגיעה ביותר ב worker. אין מפתח שאומר שהיום כבר חויב. חריגה באמצע גורמת ל retry מיידי, וכל מי שכבר חויב מחויב שוב, עד שלוש פעמים. גם `boss.send` ידני מחייב כפול. יום שהוחמץ לא מושלם. התיקון הוא `reference_id` לפי תאריך UTC ואינדקס ייחודי חלקי על `(user_id, reference_id) WHERE type = 'interest'`.

#### `apps/worker/src/jobs/wallet-suspension.ts`

פעם ביום ב `03:15` UTC מעביר ל `suspended` כל חשבון `active` שהיתרה שלו מתחת ל `WALLET_SUSPEND_BELOW_MINOR`, ברירת מחדל `-2000` ומוגבל ל nonpositive, ומחזיר ל `active` חשבון שהושעה אוטומטית ועלה חזרה לסף.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 33 | imports והערה. | ההערה אומרת שחשבון מושעה לא מתחבר. זה כבר לא נכון. הוא מתחבר, ו `SessionAuthGuard` חוסם הכל חוץ מ routes עם `@AllowSuspended()`, מסך הפרופיל וה helpdesk. |
| 34 עד 53 | `negativeAccounts`, סינון `balanceMinor < threshold`, ו UPDATE של `user_account` ל `suspended` עם `auto_suspended_at = now()` לפי `id = ANY($1::uuid[]) AND status = 'active'`. | התנאי על `active` עושה את זה אידמפוטנטי ולא נוגע בהשעיה ידנית או בחשבון סגור. אין תלות בימי ההשהיה, חשבון שירד אתמול מושעה הבוקר. `user_id` שאינו UUID ב ledger יפיל את כל ההרצה ב cast. |
| 55 עד 74 | CTE `balances` על כל ה ledger ו UPDATE ל `active` עם ניקוי `auto_suspended_at`, רק לשורות `suspended` עם `auto_suspended_at` ויתרה `>= threshold`. | העמודה מבדילה השעיה של מכונה מהשעיה של אדם. הסרת `status = 'active'` מההשעיה תסמן השעיות ידניות כאוטומטיות והן יוחזרו. admin שמחזיר ידנית חשבון בחוב בלי לנקות את העמודה יראה אותו מושעה שוב ב `03:15`. |
| 76 עד 80 | לוג. | |

#### `apps/worker/src/jobs/membership-renewal.ts`

רץ כל שעה בדקה 40 UTC. מסיים מנויים `cancelling` שהמחזור שלהם עבר, ולכל מנוי `active` שהמחזור שלו עבר פותח מחזור של 30 יום, כותב `membership_period` ומחייב את הארנק. זה המימוש שרץ בייצור. `MembershipService.renewDue` ב API לא נקרא מאף controller או בדיקה, והוא קוד מת.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 29 | import של `Pool` והערה. | ההערה טוענת שאם העבודה לא רצה אין חיוב כפול. נכון להטבות שעוברות דרך `consume`, לא נכון לאחסון, ראה `storage-fee.ts`. |
| 30 עד 45 | client אחד. UPDATE של `membership` ל `ended` לכל `cancelling` עם `current_period_end <= now()`. | autocommit, מחוץ לטרנזקציה, אידמפוטנטי בזכות התנאי. אין outbox, המשתמש לא שומע שהמנוי הסתיים. |
| 47 עד 54 | SELECT של מנויים `active` שהמחזור שלהם עבר, עם `coalesce(scheduled_tier, tier)` כ tier. | זה המנגנון של downgrade מתוזמן, מיגרציה 0030. בלי `FOR UPDATE`, הבחירה מחוץ לטרנזקציה. |
| 56 עד 85 | לכל מנוי `BEGIN` ובחירת הכלל `membership:<tier>` שבתוקף. בלי כלל, `ROLLBACK`, warning, והמנוי נשאר עם מחזור שפג. | סטיה מה API. `feeFor` שם נופל ל `tier.listPriceMinor` כשאין כלל, כך שה API היה מחדש וה worker לא. |
| 87 עד 108 | snapshot מינימלי, ו UPDATE של `membership` שקובע `tier`, מאפס `scheduled_tier`, ומציב `current_period_start` ל `date_trunc('milliseconds', now())` וסוף ל `+ interval '30 days'`. | מילישניות כי ה API מוצא את המחזור בשוויון מדויק דרך `Date`. המחזור מתחיל ב `now()` ולא בסוף הקודם, כך שכל חידוש מזיז את המחזורים קדימה ומשאיר פער לא מכוסה, וכך גם `renewDue`. `interval '30 days'` לפי אזור הזמן של ה session מול `CYCLE_MS` ב API. |
| 110 עד 124 | INSERT ל `membership_period` עם `ON CONFLICT (membership_id, period_start) DO NOTHING`. אם לא נכתבה שורה, `ROLLBACK` ודילוג. | ההגנה מדומה. ה UPDATE לפניה מסנן רק לפי `id`. טרנזקציה שניה שחיכתה לנעילה ממשיכה עם `now()` אחר, `period_start` שונה, אין התנגשות, והמנוי מחויב פעמיים. התיקון הוא `AND status = 'active' AND current_period_end <= now()` ב UPDATE ובדיקת `rowCount`. |
| 126 עד 148 | אם המחיר חיובי, `charge` עם `action_type` `membership:<tier>` ו `reference_id` המנוי, ו `ledger_record` `service_charge` `debit`. `COMMIT`. ב catch `ROLLBACK` ולוג, והלולאה ממשיכה. | זהה במבנה ל `openPeriod` ב API. אין בדיקת יתרה ואין בדיקת השעיה, חשבון מושעה בחוב מחודש וצובר עוד חוב. כשל של מנוי לא מכשיל את העבודה, ולכן אין retry, וזה נכון כאן. |
| 150 עד 158 | `finally` משחרר, לוג רק אם היה שינוי. | |

**שים לב.** אין התראה על חידוש או סיום, בניגוד לכל אירוע כספי אחר. הוספת outbox מחייבת כניסה ב `notification-message.ts`, ב `notification-events.ts` ובקטלוג של ה API. מעבר לחידוש מ `current_period_end` מחייב אותו שינוי ב `renewDue`.

#### `apps/worker/src/jobs/shipment-expiry.ts`

רץ כל שעה בדקה 20. מבטל כל משלוח `awaiting_payment` שה `payment_due_at` שלו עבר, וכותב outbox `shipment_expired`, כך שהפריטים שבו פנויים שוב למשלוח אחר. ה API קובע את `payment_due_at` ל `PAYMENT_WINDOW_DAYS` קדימה. הקובץ הנקי ביותר ב worker.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 38 | `BEGIN` ו `SELECT ... FOR UPDATE` על המשלוחים שפג תוקפם. | מופע שני נחסם, ואחרי ה commit של הראשון מעריך מחדש את `status` ולא מוצא כלום. |
| 40 עד 50 | UPDATE ל `cancelled` עם `cancelled_at`, `cancel_reason` ו `payment_due_at = NULL`. | |
| 52 עד 57 | INSERT ל `outbox_message` עם `userId`, `shipmentCode` ו `itemCount`, באותה טרנזקציה. | שינוי שם ה event מחייב שינוי ב `notification-message.ts`, ב `notification-events.ts` ובקטלוג של ה API. |
| 60 עד 70 | `COMMIT`, לוג, `ROLLBACK` ו rethrow, שחרור. | |

**שים לב.** הבעיה בצד השני. `ShipmentService.pay` ב API בודק סטטוס מחוץ לטרנזקציה ומעדכן לפי `id` בלבד. תשלום ברגע האחרון נחסם על הנעילה של ה worker, ואחרי ה commit דורס את `cancelled` ל `rates_selected`. התוצאה, משלוח ששולם ופעיל עם `cancelled_at` מלא והודעת ביטול למשתמש. זה מאותו שורש כמו E18, והתיקון הוא `AND status = 'awaiting_payment'` ב UPDATE של `pay`. `ShipmentService.expireUnpaid` ב API הוא עותק מת שהתפצל, בלי `FOR UPDATE` ועם סיבה אחרת.

#### `apps/worker/src/jobs/tracking-refresh.ts`

כל 30 דקות שואל את ה shipping adapter על כל משלוח בדרך ומעדכן סטטוס. בפועל placeholder שרץ בייצור, זה E17.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 10 | `new SandboxShippingAdapter()` ברמת המודול, בלי תנאי. | לא קורא `SHIPPING_PROVIDER`. `getTracking` של ה sandbox מחזיר תמיד `in_transit`, ולכן אף משלוח לא מגיע ל `delivered` במסלול הזה. |
| 12 עד 16 | SELECT של משלוחים `shipped` או `in_transit` עם `tracking_number`. | בלי `LIMIT`. |
| 18 עד 26 | לולאה סדרתית, `getTracking`, מיפוי `delivered` ו `exception` כמו שהם וכל השאר ל `in_transit`, ו UPDATE עם `updated_at = now()`. לוג. | `updated_at` נדרס כל חצי שעה ומאבד משמעות. אין outbox, גם מסירה אמיתית לא תייצר התראה. ה `unknown` של EasyPost ימופה ל `in_transit`, בניגוד להערה ב adapter. |

**שים לב.** חיבור `EasyPostShippingAdapter` כמו שהוא יעשה POST ל `/trackers` בכל קריאה, כלומר tracker חדש אצל הספק כל חצי שעה לכל משלוח, בלי timeout. חריגה אחת עוצרת את הלולאה, ו retry מריץ את כולה שוב פעמיים. לפני חיבור צריך לשמור `tracker_id`, לקרוא GET, להוסיף `LIMIT` ולתפוס חריגה לכל משלוח, ולהעביר ל worker את `EASYPOST_API_KEY`.

#### `apps/worker/src/jobs/ledger-invariant-check.ts`

ניטור שעתי, קריאה בלבד.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 14 | סופר `ledger_record` עם `amount <= 0`. | |
| 15 עד 25 | סופר `charge` במצב `settled` בלי `ledger_record` עם `reference_type` `charge` שמצביע עליו, דרך `c.id::text`. | |
| 27 עד 37 | אם אחד חיובי, `console.error` עם ALERT, אחרת `ok`. | העבודה מסתיימת בהצלחה בכל מקרה. אין exception, אין שורה בטבלה, אין התראה. מי שלא קורא stderr לא יידע. |

**שים לב.** הבדיקה לא מוצאת שני ledger לאותו חיוב, ledger שמצביע על חיוב חסר, אי התאמה בסכום, או ריבית ואחסון כפולים. אף אחד מבאגי הכפילות של הפרק לא יתגלה בה. ערוץ התרעה חיצוני, למשל `SENTRY_DSN` שכבר קיים בסכמה, הוא מה שחסר, יחד עם heartbeat, E15.

**כפילויות מול ה API.** כל שורה כאן היא כלל שכתוב פעמיים. מי שמשנה צד אחד חייב לשנות את השני.

| עבודה | העותק ב API | הסטיה היום |
|---|---|---|
| `storage-fee.ts` | `vault.service.ts` ו `storage-policy.ts` שמציגים תקופה כלולה וחיוב הבא, `AdmService.runStorageFees` המת | מינימום סנט מול אפס, fallback לכלל oversized, ימים לפי אזור זמן מול מילישניות, כיסוי מנוי שהמסך לא רואה |
| `membership-renewal.ts` | `MembershipService.renewDue` המת, `feeFor`, `openPeriod` | בלי כלל מחיר ה worker לא מחדש וה API נופל למחיר הקטלוגי, snapshot מינימלי מול מלא |
| `shipment-expiry.ts` | `ShipmentService.expireUnpaid` המת | בלי `FOR UPDATE`, בלי איפוס `payment_due_at`, סיבת ביטול אחרת |
| `notification-events.ts` | `event-types.ts` | תואם, נשמר בבדיקה, חסר `mandatoryInApp` |
| `outbox-dispatch.ts` | `notification.service.ts` | ה worker מכבד העדפה שמכבה התראת חובה |
| `interest-accrual.ts`, `wallet-suspension.ts` | אין, ה worker הוא הבעלים היחיד | |

#### `tests/README.md`

מסמך של 12 שורות שממפה ארבע סוויטות לעקרונות ה constitution ולפקודות. אף קוד לא קורא אותו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 3 | הרעיון, כל סוויטה מגינה על עיקרון. | |
| 5 עד 10 | טבלה של integration, concurrency, property ו contract. | מיושן. חסרים `web`, `ux`, `tests3`, האחסון ו EasyPost ב contract, `scripts/test.mjs`, מגבלות הקצב המוגדלות ו `--no-file-parallelism`. |
| 12 | הפניה לקובץ משימות תחת `specs/`. | |

**שים לב.** המפה האמיתית. `vitest.workspace.ts` מגדיר שמונה projects. `integration`, `concurrency`, `property` ו `core` צריכים API חי על `localhost:3000`, מסד ממוגרר וזרוע, ו `.env` עם `AUTH_RATE_LIMIT_PER_MINUTE=5000` ו `RATE_LIMIT_PER_MINUTE=20000`, אחרת 429 אחרי ההתחברות העשירית. `contract`, `core-contract`, `web` ו `ux` לא צריכים דבר, חוץ מ MinIO לארבע בדיקות אחסון. `pnpm test` מריץ את `scripts/test.mjs`, לולאה סדרתית מ `web` דרך `ux`, `contract`, `core-contract`, `integration`, `core`, `concurrency` ועד `property`, שעוצרת בכשלון הראשון ותמיד מסיימת ב `db:seed`, כלומר TRUNCATE בלי לבדוק לאן `DATABASE_URL` מצביע, אותו seed הרסני של E11. ה CI מריץ כל project כצעד נפרד ולא מאפס. `fileParallelism: false` בתוך project לא נאכף ב Vitest 2.1.9, רק הדגל `--no-file-parallelism` אוכף, ולכן `pnpm test:all-parallel` לא אמין. הדגל לא קובע סדר קבצים, וכמה בדיקות מניחות מצב שקובץ אחר שינה, זה E16. אין `testTimeout`, כל בדיקה מקבלת 5 שניות.

#### `tests/integration/helpers/http.ts`

ה harness של כל בדיקה שמדברת עם API חי, ב `tests/integration`, `tests/concurrency`, `tests/property` ו `tests3/integration`. אין imports, רק `fetch` של Node ו `API_URL`. דפוס P10 נשען עליו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 8 | `BASE`, `API_URL` או `http://localhost:3000/api/v1`. כל נתיב בבדיקות יחסי אליו. | שני קבצים קוראים `fetch` ישירות ומשכפלים את ברירת המחדל במקום לייבא. |
| 10 עד 26 | `Client.request`. שולח תמיד `Content-Type: application/json`, מוסיף עוגייה, מסדר גוף רק אם truthy, שומר `name=value` הראשון מ `set-cookie`, מחזיר `null` על 204 או גוף שאינו JSON, ומחזיר `{ status, body }` עם `body` כ `any`. | עובד כי ה API מגדיר עוגייה אחת. עוגייה שניה מחוברת בפסיק על ידי undici, והחיתוך ישמור רק את הראשונה, בדיקות יאבדו session בשקט. אין CSRF, timeout, retry או לוג בקשות. |
| 28 עד 38 | קיצורים `get`, `post`, `patch`, `put`, `del` כ arrow functions, כך ש `this` קשור גם כשמעבירים `c.get`. | `put` נוסף מאוחר. ההערה בסוף `not-notifications.test.ts` שאומרת שאין PUT מיושנת. |
| 40 עד 57 | `FIXTURE_EMAIL_DOMAIN` שהוא `fixture.bault.test`, ו `fixtureEmail(label)` שמחזיר label, `Date.now()` ומספר אקראי. | הקבוע מוגדר שוב ב `apps/api/src/shared/fixtures.ts` לפי ערך, ו `AdmService.listUsers` מסנן לפיו את מסך המשתמשים. שינוי בצד אחד בלבד מחזיר חשבונות בדיקה למסך. |
| 59 עד 82 | `SEED_PASSWORD` שהוא `11111111`, `SEED` ו `SEED_USERNAME` לחמשת החשבונות. `red`, `golden` ו `veteran` אספנים, `hermon` מפעיל, `eldar` admin. | `veteran` מדמה חשבון ממוגרר עם intake ID מסוג `OW-` ושם לא מפוצל. שינוי ב `seed.ts` שובר כאן הכל. |
| 84 עד 94 | `signIn` יוצר `Client`, `POST /auth/login` עם `identifier` ו `password`, וזורק אם לא 200. | כל קריאה יוצרת session חדש ומאמתת argon2 בשרת. אחת הסיבות למגבלות הקצב המוגדלות ולבדיקות שמתקרבות ל 5 שניות. |
| 96 עד 109 | `usernameOf` מתחבר וקורא `/me/profile`. | החליף את `intakeIdOf` כשה intake ID הוסתר מהלקוח. עולה התחברות נוספת בכל קליטה. |
| 111 עד 154 | `fundWallet`. מסרב לממן את ה admin, מגיש `cash_in` בהעברה בנקאית עם `reference` ייחודי, ומתחבר כ admin כדי לאשר ולהשלים, כל שלב חייב 201. | אין קיצור דרך לכסף, וזה מכוון. כל מימון עובר את קוד הייצור וכותב שורת ledger אחת בהשלמה. לא מחזיר מזהה בקשה. שלב ביקורת חובה חדש בשרת ישבור כמעט את כל סוויטת ה integration. |
| 156 עד 162 | `binIds` קורא `/custody/bins` כמפעיל וזורק אם יש פחות משניים. | |
| 164 עד 183 | `intakeFor` מריץ במקביל `usernameOf` ו `binIds`, ושולח `POST /intake/items` עם `ownerUsername`, `typeClass: 'trading_card'`, `binId: bins[0]` ו `overrides`. זורק אם לא 201. | כל קליטה מחייבת את הבעלים בדמי intake ומשנה את היתרה שלו. עם `quantity` ה API מחזיר מערך, והטיפוס לא משקף זאת. |

**שים לב.** הבדיקות רצות מול תהליך API נפרד ולא מול `Test.createTestingModule`. הן בודקות בדיוק את מה שרץ, כולל `main.ts` וה throttler, אבל לא יכולות לשלוט בשעון, להחליף provider או לקרוא את המסד. אף בדיקה לא מנקה אחריה.

#### `tests/ux/setup.ts`

קובץ ה setup של project ה `ux`, מוגדר ב `vitest.workspace.ts`, ורץ לפני כל אחד מאחד עשר הקבצים. מכין את jsdom לרכיבי ה SPA.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 16 | import של `@testing-library/jest-dom/vitest`, ו `cleanup` אחרי כל בדיקה. | עם `globals: true` Testing Library כבר רושמת `cleanup`, כך שזה כפול ולא מזיק. |
| 18 עד 37 | stub ל `matchMedia` שמחזיר תמיד `matches: false`, ו `scrollTo` ריק, רק אם חסרים. | כל בדיקה רצה כאילו המסך רחב ובלי מצב כהה. stub שמחזיר `true` יעביר רכיבים לפריסה ניידת וישבור את עמדת הקבלה. |
| 39 עד 46 | `scrollIntoView` ריק, בשביל עמדת הקבלה. | |
| 48 עד 61 | `beforeEach` כותב `en` ל `bault.locale`, שאותו `apps/web/src/shared/i18n.tsx` קורא. | בלעדיו כל הסוויטה בעברית והשאילתות נכשלות. שאר localStorage, למשל `bault.theme`, ו `dir` של המסמך לא מתאפסים. |

**שים לב.** הדפוס של רוב קבצי ה `ux` הוא `vi.mock` על `apps/web/src/shared/api` ואז `await import` של הרכיב. ה mock מחליף את `ApiError` במחלקה ריקה, חוץ מ `audit-screens.test.tsx` שמגדיר `MockApiError` עם `kind`, `status` ו `code`. הצורות ב mock נכתבו ביד, ואין בדיקה שמרנדרת את ה SPA מול API אמיתי, כך ששינוי צורת תשובה לא ייתפס.

קבצי ה integration. דפוס P10, כל אחד רץ מול API חי, יוצר נתונים דרך ה helpers ובודק מצב דרך endpoints של קריאה. אף אחד לא ניגש למסד.

| קובץ | מה הוא עושה |
|---|---|
| `tests/integration/acc-addresses.test.ts` | יצירה, עריכה ומחיקה ב `/me/addresses`, בדיוק ברירת מחדל אחת, ומשתמש שלא קורא ולא עורך כתובת זרה. מחיקה של כתובת זרה לא נבדקת, ואחרי הרצה ל `red` אולי אין ברירת מחדל. |
| `tests/integration/acc-identity.test.ts` | שם משתמש ייחודי, קבוע ומנורמל, שם פרטי ושם משפחה, חשבון ממוגרר, וה intake ID שמוסתר מהלקוח, גלוי ל admin ומתקבל בקליטה. |
| `tests/integration/acc-lifecycle.test.ts` | רישום במצב `pending_verification`, שדות חובה, התחברות, איסור שינוי שם משתמש, החלפת סיסמה, התנתקות ואסימון אימות לא תקף. לא נבדק ביטול sessions אחרים אחרי החלפת סיסמה ולא איפוס סיסמה. |
| `tests/integration/acc-status-block.test.ts` | למרות השם לא משעה אף חשבון. בודק רק 401 בלי עוגייה ובסיסמה שגויה. פער אמיתי, החסימה של `SessionAuthGuard` לחשבון מושעה לא נבדקת בשום מקום. |
| `tests/integration/adm-pricing-storage.test.ts` | כל כלל תמחור נושא תיאור, ערך, היקף וטריגר, חיובי אחסון אוטומטיים בלבד, ומחלוקת מצביעה על טרנזקציה קיימת. משנה את התמחור הגלובלי, וכל קובץ שרץ אחריו מתומחר מול כללים שהבדיקה המציאה, E16. |
| `tests/integration/dev-proxy.test.ts` | החוזה של פיתוח מקומי, `/healthz` שעליו `pnpm dev` מחכה ו `/me/profile` שה SPA שולח בטעינה. בדיקות ה proxy לא רצות ב CI כי ה web לא עולה שם. |
| `tests/integration/dis-item-services.test.ts` | שירותים לפריט על המדף, דירוג בדרגות מחיר, משלוח למדרג, וידאו, דוח מצב, פתיחת slab, פיצול lot והסרה מרוכזת. אף סכום שחויב לא נבדק, וקולט כ 17 פריטים ל `red` בכל הרצה. |
| `tests/integration/dis-services.test.ts` | הקובץ הוותיק של שירותי ערך מוסף, קבלה והשלמה עם טופס מבני מלא. הטענה על טרנזקציית `transfer` בשורה 123 עוברת בזכות נתוני seed ולא בזכות התרומה הנבדקת. |
| `tests/integration/esc-and-human-fulfilment.test.ts` | escrow עם שערי מימון ובדיקה, החזרה, קונה בלי כסף, צד חיצוני ופרטיות, white glove ואיסוף בתערוכה. בודק יתרות לפני, באמצע ואחרי, כי החזקת כסף היא שורת ledger אמיתית. מימון מקביל לא נבדק. התערוכה הזרועה מקבלת 12 איסופים ונקבעת 28 יום קדימה, כך שאחרי שש הרצות או כמה שבועות בלי seed הבדיקה נכשלת בהודעה לא מסבירה. |
| `tests/integration/inv-batch-split.test.ts` | batch שנפתח מתפצל לפריטים, וכל אחד מקבל אירוע `batch_split`, מדף וקישור ל batch. הפיצול הראשון לא נבדק לסטטוס, ופיצולים מקבילים לא נבדקים. |
| `tests/integration/inv-intake.test.ts` | קליטה יוצרת פריט עם סריאל `SN-` ששווה לברקוד, מדף ואירוע `intake`. גם lot, תיקון, העברת מדף וחסימת לקוח. ההערה מבטיחה חיוב, אבל יתרה ו ledger לא נבדקים. |
| `tests/integration/mkt-house-store.test.ts` | חנות הבית. רשומת הפריט נוצרת רק ברגע התשלום, בבעלות הקונה ובמצב `received`, והמחסן משלים את החצי הפיזי. קנייה מקבילה של העותק האחרון לא נבדקת למרות הנעילה בשירות. |
| `tests/integration/mkt-offers.test.ts` | קבלת הצעה מחזירה את מחיר ההצעה, ואי אפשר להציע על מודעה של עצמך. לא בודק בעלות או חיוב בפועל. ההערה מתעדת כשלון שנראה כחיוב כפול ונבע משני קבצים מקבילים על אותו חשבון. |
| `tests/integration/mkt-purchase.test.ts` | קנייה ישירה, חיוב במחיר, העברת בעלות וטרנזקציית `sale`, ואיסור לקנות מודעה של עצמך. זיכוי המוכר, price freeze ויתרה לא מספיקה לא נבדקים למרות השם וההערה. |
| `tests/integration/mkt-swap-transfer.test.ts` | החלפה אחרי הסכמת שני הצדדים ומתנה אחרי אישור המקבל, לפי שם משתמש. לא מוכיח את הכלל שבשם, אין בדיקה שהפריטים לא זזו לפני האישור ואין בדיקה של הכיוון השני. |
| `tests/integration/not-channels-and-content.test.ts` | מטריצת העדפות לפי ערוץ, שתי התראות in_app שאי אפשר לכבות, ושלושה endpoints ציבוריים, לוח תערוכות, פרטי קשר ומיקומים, שנקראים ב `fetch` ישיר. בדיקת המסירה עוברת גם עם פיד ריק. שחזור ההעדפות לא נמצא ב `finally`, ואחרי הקובץ ל `golden` יש העדפות מפורשות שונות מה seed. |
| `tests/integration/not-notifications.test.ts` | כל התראה בפיד נושאת משפט קריא וסכום בדולרים, in_app דלוק כברירת מחדל וביטול נשמר. עובר גם בלי worker, ואז בודק רק את מה שה seed כתב. בדיקת הדולר עוברת אם הודעה אחת מכילה `$`. |
| `tests/integration/pay-flow.test.ts` | קובץ הארנק המרכזי, בעיקר על `golden`. יתרה משתנה רק בהשלמה. `cash_in` של 300 דולר מזכה פעם אחת עם `credit_topup`, `cash_out` כותב `withdrawal` ו `fee` נפרדים, משיכה מעל היתרה 409 `insufficient_balance`, מעל התקרה 400, בקשה זהה בלי `reference` 409, השלמה בלי אישור או שניה 409, separation of duties ותאימות endpoints ישנים. השלמה כפולה נבדקת רק ברצף, לא במקביל. |
| `tests/integration/pay-money-in-out.test.ts` | מסלולי מימון, טעינה מיידית בכרטיס עם idempotency, ציטוט עמלת משיכה שתואם לחיוב בפועל, chargeback, ורשימת מחירים ציבורית. שורה 176 יוצאת בשקט אם יצירת הבקשה לא החזירה 201, כך שהבדיקה יכולה לעבור בלי לבדוק. שורה 277 מצפה לקליטה של 100 סנט, בסתירה ל 500 ש `membership-tiers.test.ts` מניח. |
| `tests/integration/shp-outbound.test.ts` | הגדול בסוויטה. ציטוט שזז עם משקל ויעד, קופסה, שירות שמסרב לחבילה, ביטוח עם חתימה, שינוי, מיזוג וביטול בקשה, בחירה ותשלום, מכס, חבילות משותפות ומשלוח ישיר מאתר ההעברה. נכתב כך שייכשל מול הסטאב הישן שהחזיר אותם שני מחירים לכל חבילה. כתשע התחברויות לבדיקה, קרוב למגבלת 5 השניות. שורה 485 מניחה ש `veteran` עני מהמשלוח לאוסטרליה, וכל הרצה מוסיפה ל `red` כעשרים כתובות. |
| `tests/integration/shp-shipment.test.ts` | הקובץ הוותיק של משלוח יוצא, בקשה לכמה פריטים, תעריפים, בחירה ו dispatch שמאומת בסריקה ובטופס מחסן. ה dispatch קונה תווית דרך ה adapter של השרת, ומול EasyPost אמיתי זו קנייה אמיתית. |
| `tests/integration/shp-tracking-list.test.ts` | משלוח נכנס לרשימת המעקב מעצם יצירתו, עם כל שדות המסך, בלי intake ID, ורק לבעלים. הבדיקה בשורות 114 עד 120 נשענת על משלוח ה seed ולא על זה שנשלח בבדיקה. |

שתי הסוויטות הקטנות מול אותו API חי.

| קובץ | מה הוא עושה |
|---|---|
| `tests/concurrency/no-double-sale.test.ts` | הבדיקה היחידה ב `tests` עם שתי כתיבות באותו רגע. `red` מפרסם, `golden` ו `veteran` ממומנים, `Promise.all` שולח שתי קניות, ובדיוק אחת מחזירה 201 והשניה 409 או 403. בדיקת עשן לנעילה `for('update')` על המודעה ב `purchase.service.ts` שורה 88. שום דבר לא מכריח חפיפה, אין טענה על כסף, ולא יכולה לתפוס את E1, קונה אחד על כמה מודעות שונות במקביל שיורד מתחת לאפס. |
| `tests/property/wallet-ledger.test.ts` | למרות השם, תרחיש קבוע בלי אקראיות. חמש `cash_in` בסכומים לא עגולים מושלמות, שלוש נשארות מאושרות, נדחות או מבוטלות, ומשיכה מפחיתה סכום ועוד עמלה מ `/finance/cash-out-quote`. הבדיקה השניה דורשת שורת ledger אחת לכל בקשה שהושלמה. הטענה שיתרה שווה לסכום השורות כמעט טאוטולוגית, החשובה היא ההשוואה לסכום הצפוי. |

קבצי ה contract בונים adapters מ `@bault/adapters` בתוך תהליך הבדיקה, דרך alias לקוד המקור, בלי API ובלי מסד.

| קובץ | מה הוא עושה |
|---|---|
| `tests/contract/payment-adapter.test.ts` | `SandboxPaymentAdapter` מממש את `PaymentAdapter` ומחזיר מזהה ספק בלבד. ההערה טוענת שכל adapter אמיתי עובר אותה סוויטה, אבל היא לא פרמטרית ו PayPal לא עובר דרכה. |
| `tests/contract/shipping-adapter.test.ts` | `SandboxShippingAdapter` כמודל תמחור, מחירים שזזים עם משקל, יעד וגודל קופסה. נבדקים כיוונים ולא מספרים, כי מחירי ה sandbox מומצאים. |
| `tests/contract/easypost-adapter.test.ts` | ה adapter היחיד שקונה בכסף אמיתי, מול `fetch` מזויף עם `vi.stubGlobal`. אימות `Basic`, מחיר בסנטים וממוין, משקל ומידות ביחידות EasyPost כולל אריזה, `signatureRequired` כבר בתמחור, קנייה רק של התעריף שצוטט, סירוב לכתובת שאי אפשר לתמחר, ושגיאת ספק שעוברת כלשונה. אין בדיקה לקנייה במחיר שונה מהציטוט, ו `easypost.ts` מחזיר אז את המחיר החדש בשקט. ה worker לא משתמש בו, E17. |
| `tests/contract/storage-adapter.test.ts` | נולד מתקרית שבה ה sandbox זרק כל תמונה. בייטים שנכנסים חוזרים, URL חתום בלי הסוד, דלי פרטי, כשל העלאה מדווח. ארבע מתוך שש מדלגות בלי MinIO, כולל בדיקת הסוד שלא צריכה רשת, ו `docker-compose.yml` לא יוצר את הדלי. |

קבצי ה `ux` רצים ב jsdom עם הדפוס שתואר ב `setup.ts`. כל אחד מוכיח שהרכיב קורא לנתיב הנכון ומציג נכון את מה שה mock מחזיר, לא שה API מחזיר את הצורה הזו.

| קובץ | מה הוא עושה |
|---|---|
| `tests/ux/auth.test.tsx` | בדיקות הרינדור הראשונות, על `SignInPage`. `post` נקרא ל `/auth/login` עם `{ identifier, password }`, שגיאה מוצגת ונעלמת בניסיון חוזר. `vi.stubEnv('DEV', false)` מוודא שבייצור השדות ריקים ושורת הסיסמה המשותפת לא מוצגת. ענף ה DEV שמציג משתמשי דמו נבדק בזמן ריצה בלבד, ולכן צריך גם את סריקת הבאנדל. |
| `tests/ux/landing.test.tsx` | כל מחיר בעמוד הנחיתה מגיע מ `GET /pricing/list`, וכשהרשימה לא נטענת לא מוצג שום מספר. צורת `PRICE_LIST` לא מאומתת מול ה controller. |
| `tests/ux/membership.test.tsx` | `MembershipPage` סביב הסכמה. המחיר על הכפתור, לחיצה לא שולחת כלום עד אישור שמזכיר 30 יום ומחיר, ורק אז `POST /membership/subscribe`, והמסך אומר מה קורה כשמכסה נגמרת. כשלון חיוב לא נבדק. |
| `tests/ux/customer-screens.test.tsx` | טעינה, סיבת כשלון ומצב ריק ב `AccountPill`, `IntakePolicyPanel` ו `VaultPage`. ה mock מחזיר אובייקט שרירותי לכל נתיב לא מוכר. |
| `tests/ux/sign-ins.test.tsx` | יומן ההתחברויות של ה admin מציג כשלונות, ניחוש כתובת בלי חשבון, ודפוס של ניחוש סיסמאות מעל הטבלה. |
| `tests/ux/audit-screens.test.tsx` | כל בלוק מצמיד פגם מביקורת UX על מוצר חי, `Field`, טופס הרשמה, `ConfirmationModal`, מחיר על כפתור, שפה לפני התחברות ואוצר מילים. היחיד עם `MockApiError` אמיתי. העברית לא נבדקת. |
| `tests/ux/barcode-printing.test.tsx` | `printBarcode` ו `printBarcodes` כותבים HTML ל iframe מוסתר, ואצווה היא דיאלוג הדפסה אחד. ה escaping נבדק על הכיתוב בלבד ולא על `<title>`. |
| `tests/ux/custody-grade.test.tsx` | רכיבי זהות, כסף ומצב, כל בדיקה ב `ltr` וב `rtl` בגלל ארבעה באגים שהופיעו רק בעברית. הרכיב `Row` מוגדר בתוך הבדיקה ולא מיובא מהאפליקציה. |
| `tests/ux/design-system.test.tsx` | תווית שממקדת שדה, כפתור עסוק שלא נלחץ, ערכת נושא שנשמרת ופאנל תשואת המדפים. בדיקת המיון בשורות 201 עד 213 לא יכולה להיכשל, `ShelfYieldPanel` לא ממיין וה mock כבר מסודר. |
| `tests/ux/receiving-bench.test.tsx` | עמדת הקבלה ב `WarehouseConsole`, חבילות וקליטה בלשונית אחת, קופסה עם כמה יחידות בבקשה אחת, צילום, תוויות ומצב בלי מדף. הכבד בסוויטה, כארבע שניות, הראשון שייפול על timeout. |
| `tests/ux/warehouse-bench.test.tsx` | החלטת האחסון בעמדת הקבלה, יעד המדף שמוצג למפעיל והמטען שנשלח ל API. השרת מחליט בפועל ב `autoStow`, והבדיקה לא רואה פער בין ההצעה לבחירה. |

קבצי ה `web` רצים ב node בלי DOM ובודקים פונקציות טהורות וקטלוגים. חלקם מייבאים מ `apps/api/src`, מ `apps/worker/src` ומ `packages/adapters/src`. כמה טוענים שהם שומרים התאמה בין עותק בשרת לעותק ב SPA, ורובם מייבאים רק צד אחד.

| קובץ | מה הוא עושה |
|---|---|
| `tests/web/api-client.test.ts` | הלקוח `api` מבחין בין API שלא זמין לבין API שאומר שהמשתמש לא מחובר, כדי ששרת מת לא יהפוך למסך התחברות. `TypeError` של `fetch` ו 503 עם `api_unreachable` מה proxy הופכים ל `kind: 'unreachable'`, `credentials: 'include'` נשלח, ו 409 שומר את ההודעה של ה API. |
| `tests/web/faq-legal.test.ts` | `answerQuestion` מחזיר תמיד אותה תשובה גם להזרקת הוראות או SQL, שומר ריקבון מכשיל רשומה `adapted` שאומרת ש Bault לא עושה משהו, ה FAQ המועתק שלם ומסומן, והמסמכים המשפטיים לא ממציאים טקסט. מספרי השאלות מקובעים בכוונה. אוכף שהעתק ה FAQ יישאר מילולי, ראה E20 ו E21. |
| `tests/web/i18n-catalogue.test.ts` | בקטלוג ההודעות, עברית ראשונה וברירת מחדל, מפתח שלא תורגם, מחרוזת עברית שזהה לאנגלית, placeholder שנשמט בשפה אחת, מפתחות שהוסרו, אזכור ShipMyCards רק בשלושה מפתחות ייחוס, ושם המותג. |
| `tests/web/membership-actions.test.ts` | `tierAction` קובע מה כפתור כל tier עושה ועולה היום. חישוב הזיכוי כתוב גם ב `membership.service.ts` שורה 324, ורק צד הלקוח נבדק. |
| `tests/web/membership-tiers.test.ts` | הקטלוג ב `apps/api/src/modules/mem/tiers.ts` כאריתמטיקה, אין חיוב על חריגה ולכל מכסה יש תקרה. `UNIT_PRICES` לא נקרא מה seed. |
| `tests/web/names.test.ts` | כללי שם ושם משתמש ב `apps/web/src/shared/names.ts`. טוען שהוא תופס סטייה מהשרת, אבל מייבא רק את עותק ה web. `describe.each` על שני העותקים יסגור את זה. |
| `tests/web/nav-rail.test.ts` | ה reducer הטהור של פס הניווט ב `navRailState.ts`, שנכתב כך בדיוק כדי להיבדק בלי DOM. |
| `tests/web/no-credentials-in-bundle.test.ts` | סורק את `apps/web/dist/assets` ומוודא שאף `.js` או `.css` לא מכיל את סיסמת ה seed או את כתובות החשבונות הזרועים. `FORBIDDEN` הוא שש מחרוזות מילוליות, כי regex היה תופס צבעי hex. נולד משתי תקריות, דרך קטלוג ה i18n ודרך build של פיתוח. כשהתיקייה חסרה הבדיקה עוברת ולא מדלגת, וה CI לא בונה את ה web, כך שם היא תמיד עוברת ריקה. לא סורק `index.html` או קבצי map, והנתיב נבנה מ `process.cwd()`. |
| `tests/web/notification-catalogue.test.ts` | הבדיקה היחידה שמייבאת קוד של ה worker. משווה את `event-types.ts` של ה API ל `defaultEmailEnabled` ו `eventSubject` של `notification-events.ts` ולמפת התוויות של ה SPA. ברירת מחדל זהה, נושא שאינו fallback, רק `arrival_not_accepted` ו `parcel_damaged` חובה ב in_app, מייל לעולם לא חובה, ותווית לכל אירוע ורק לאירוע קיים. בודקת קטלוג ולא התנהגות. |
| `tests/web/proxy-target.test.ts` | `resolveApiProxyTarget` ו `isLoopbackHost`, שקובעים לאן Vite מעביר את `/api` בפיתוח. ברירת המחדל `127.0.0.1` ולא `localhost`, כי `localhost` נפתר גם ל `::1`. `VITE_API_PROXY_TARGET` גובר על `API_PORT`, וערך לא תקין זורק. |
| `tests/web/rayquaza-only.test.ts` | מדיניות תוכן. סריקה טקסטואלית של כל קבצי md ו ts בריפו שמוודאת שהקטלוג נשאר עשרה קלפי Rayquaza. מסמך חדש שמצטט מחרוזת מהרשימה יכשיל את `pnpm test:web` ויעצור את `scripts/test.mjs` לפני ה integration. |
| `tests/web/routing.test.ts` | `legacyRedirect` מעביר כתובות hash ישנות מסימניות למקום החדש. |
| `tests/web/session.test.ts` | `loadProfile` משתף בקשה אחת בין שני קוראים בו זמנית, כי StrictMode מריץ את האתחול פעמיים. גם כשלון משותף, אין cache לאורך זמן, ניסיון חוזר אחרי כשלון, ו 401 הופך ל `unauthenticated`. |
| `tests/web/shipment-tracking.test.ts` | `matchesShipmentSearch` ו `SHIPMENT_TONE`. רשימת הסטטוסים הידנית חסרה את `awaiting_payment` ו `cancelled`, וסטטוס חדש ב enum לא יכשיל כלום. ייבוא `shipmentStatus.enumValues` יסגור את זה. |
| `tests/web/shipping-boxes.test.ts` | השרשרת מסוג ומשקל לקופסה הקטנה שמתאימה, למידות, למשקל נפחי ולמחיר, על חמש קופסאות קבועות. |
| `tests/web/sign-ins.test.ts` | תרגום user agent וכתובת גולמיים מיומן ההתחברויות לשפה של admin. |
| `tests/web/wallet-requests.test.ts` | כללי בקשות הארנק כפי שה SPA מיישם אותם. הגבולות נקראים מ `walletRequests.ts` של ה web ולא מושווים ל `wallet-request.rules.ts` בשרת, כך ששינוי בשרת בלבד לא ייתפס. |

החבילות ב `tests3` רצות בשני projects. `core-contract` כולל את `tests3/contract`, לא צריך מסד או שרת, ורץ ב CI לפני שהמסד עולה. `core` כולל את `tests3/integration`, צריך API חי ומסד זרוע ומשתמש באותו `helpers/http.ts`. ב CI הוא רץ אחרי migrate ו seed עם `STORAGE_PROVIDER=s3` מול MinIO ו `PAYMENT_PROVIDER=sandbox`. כל קובץ נכתב אחרי ממצא, וההערה בראשו מספרת מה הצליח כשהיה צריך להיכשל. אף אחד לא שולח שתי בקשות במקביל, אף אחד לא נוגע ב worker, ואף אחד לא מנקה אחריו.

| קובץ | מה הוא עושה |
|---|---|
| `tests3/contract/payment-provider-gate.test.ts` | נולד מ `POST /finance/checkout` עם token מומצא שסילק 5,000 דולר, כי ה sandbox היה קשור בלי תנאי. מקבע שה sandbox לא בטוח, `createTopup` מצליח עם כל token ו `verifyWebhook` מקבל חתימה מזויפת, וזה מכוון. טבלת החלטה, sandbox רק ב development וב test, ספק לא ממומש נדחה ולא נופל ל sandbox. הטבלה נבדקת על `decide` מקומית ולא על `createPaymentAdapter`, כך ששינוי ב factory לא ישבור כלום. ההגנה האמיתית היא ה enum וה `superRefine` ב `env.ts`. |
| `tests3/contract/paypal-adapter.test.ts` | `PayPalPaymentAdapter` מול `fetchImpl` מדומה. top up הוא capture של order מאושר, `settledAmountMinor` הוא מה שהספק סילק גם כשאושר order של דולר וביקשו 5,000, `PayPal-Request-Id` נושא את מפתח האידמפוטנטיות, payout מדווח `pending`, ו webhook נדחה בלי אימות של PayPal או בלי כל אחד מחמשת ה headers. ההשוואה בין סכום שסולק למבוקש יושבת ב `checkout.service.ts` ולא נבדקת, והיא מדלגת כש `settledAmountMinor` הוא `undefined`. שום דבר במוצר לא יוצר את ה order, E3. |
| `tests3/integration/adm-shelf-yield.test.ts` | דוח תשואת מדפים סגור למפעיל ול collector, מייחס הכנסה גם מעמלת `fee` על listing ולא רק מ `charge`, וסכומיו עקביים. הסף של 1,000 סנט נשבר כש `fin-invariants` מכפיל את מחיר ה intake בכל הרצה, ואז הבדיקה עוברת גם בלי ייחוס עמלה. |
| `tests3/integration/band1-money-ownership.test.ts` | קונה לא יכול להציע 40 דולר על listing של 100 ולקבל את ההצעה של עצמו, הודעת validation אומרת איזה שדה ולמה, וקנייה כפולה נדחית. הקנייה הכפולה נבדקת ברצף בלבד. |
| `tests3/integration/band2-negotiation.test.ts` | הצד שהציע מחיר לא יכול לקבל אותו, counter נסגר רק בידי הצד שאליו נשלח, הצעה גבוהה מהיתרה נדחית ב 409, הצעה פתוחה אחת לקונה ל listing. הבדיקה בשורות 140 עד 168 לא בודקת דבר, `/finance/withdrawals` רק מגיש בקשה, היתרה לא יורדת, וה `if` על 409 מדלג על כל ה expect. |
| `tests3/integration/band3-guardrails.test.ts` | שבעה מעקות שהצליחו כשהיו צריכים לסרב. admin שלא משעה את עצמו ולא מוריד את התפקיד של עצמו, שירות שלא מוזמן פעמיים על אותו כרטיס והארנק יורד פעם אחת, מדינה לפי קוד, הודעת שגיאה לבני אדם בלי שמות שדות פנימיים, חשבון שלא אומת שמקבל 403 `email_unverified` רק עם סיסמה נכונה, סינון ומיון בשוק, hold אידמפוטנטי. ההזמנה הכפולה נבדקת ברצף, ו `assertNotAlreadyOpen` בשירות קורא ואז כותב בלי נעילה. |
| `tests3/integration/custom-requests.test.ts` | בקשת שירות חופשית בצורה של buyout, מחיר שנקבע רק אחרי קריאה, קבלה, ביצוע, תור וסיום, וקליטה של כמות. `accept-quote` כפול לא נבדק, וגם לא שינוי הצעה אחרי שהתקבלה. |
| `tests3/integration/fin-invariants.test.ts` | `walletAndLedger` משווה יתרה מוצגת לסכום שורות `/finance/ledger` אחרי מימון, קליטות, מכירה ומשיכה. קנייה מעבירה כסף ופריט יחד, קנייה שנדחתה לא כותבת, append only בפועל, admin לא מאשר בקשה של עצמו, רק `complete` מזיז כסף, ותמחור נשמר כ snapshot. זה הקובץ של E16. הוא יוצר כלל intake במחיר כפול ולא מסיר אותו, ומשאיר משיכה של 2,500 סנט בלי `reference`, כך שבהרצה הבאה על אותו מסד הגנת הכפילות מחזירה 409 נכון. pagination ב `/finance/ledger` ישבור אותו בשקט. |
| `tests3/integration/flows-lifecycle.test.ts` | מכסה מודולים שאיש לא בדק, helpdesk, disposals, משטח ה admin, consignment ו buyout, והולך על המעברים האסורים בכל מכונת מצבים, למשל `received` ל `processed` לפני פתיחה, פתיחה שניה, relocate של פריט ב hold, listing שני על אותו פריט. בדיקת העדפות ההתראה מחזירה את המצב המקורי, אחת היחידות שמנקות אחריהן. במשלוח של פריט שנמכר יצירת הכתובת לא נבדקת, ו `addressId` חסר יחזיר 400 מה DTO והבדיקה תעבור בלי לבדוק בעלות. |
| `tests3/integration/inv-intake-policy.test.ts` | מדיניות הקליטה המפורסמת והנחיות המכס ליעד נגישות ללקוח ולא מתרחקות מהכלל שנאכף. יוצר פריט לכל class בכל הרצה ומשאיר שני משלוחים ב `awaiting_payment` שרק ה worker יבטל. |
| `tests3/integration/inv-stow.test.ts` | זרימת הקליטה כמו שמפעיל עובר אותה. המערכת אומרת לאן, המפעיל סורק barcodes של Bault, וחבילה לא נסגרת ריקה בלי `emptyReason`. יוצר שני מדפים בכל הרצה שמצטברים בדוח התשואה. בדיקת המדף הריק ביותר תלויה בכך שאיש לא קולט באותו רגע. |
| `tests3/integration/receiving-bench.test.ts` | עמדת הקבלה המאוחדת, ערימת חבילות בקריאה אחת וצילום דרך `/media/uploads`. ערימה עם שורה פגומה נדחית כולה, הכל או כלום, ו `/intake/items/batch` עם יחידה פגומה לא מגדיל את הכספת. תמונת חבילה של אחר מחזירה 404 ולא 403. הבדיקה היחידה של אחסון מול API חי. עם `STORAGE_PROVIDER=s3` ובלי MinIO תשע בדיקות נכשלות ב 500, כשל סביבה שמראה את E10. |
| `tests3/integration/sec-authorization.test.ts` | מטריצת ההרשאות. ארבע רשימות ביד, `STAFF_ONLY`, `ADMIN_ONLY`, `PUBLIC_ROUTES` ו `OWNER_SCOPED`, מול שלושה probes, אנונימי מקבל 401, תפקיד שגוי 403, ו `golden` לא קורא ולא כותב פריט, parcel, ticket או כתובת של `red`. גם session אחרי logout, cookie מזויף והגבלת קצב על איפוס סיסמה. כשלונות נאספים לרשימה אחת. הרשימות לא נגזרות מהקוד, ולכן endpoint חדש שלא נוסף כאן לא נבדק, וחלק מהבדיקות מקבלות כל 4xx בלי לוודא שההכנה הצליחה. |
| `tests3/integration/sec-validation.test.ts` | קלט זבל ל API. בקשה רעה מחזירה 4xx, וכל 5xx הוא ליקוי. סכומים שליליים, אפס, שבר ו `MAX_SAFE_INTEGER` בכסף, מזהים שאינם UUID שהיו מפילים את Postgres ל 500, SQL injection ו path traversal בפרמטר, שדה לא מוכר שנדחה בזכות `forbidNonWhitelisted`, תג `script` שנשמר כטקסט, payload ענק, וכמויות קצה. רוב הבדיקות מקבלות כל 4xx ולא מבחינות בין דחייה ב DTO לדחייה בבדיקת יתרה. גבול ה body הוא `16mb` לכל ה API בגלל תמונות ב base64. |
| `tests3/integration/vlt-break-even.test.ts` | Break-Even Watch לא ממציא מחיר. ל Bault אין מקור מחירים, ולכן רוב הקובץ בודק מה קורה כשאי אפשר לתמחר, ו `valueBasis` מסמן מחיר מבוקש של הבעלים. אין בדיקה שחיובי האחסון שה worker כותב נספרים ב `storageSpentMinor`. |

## פרק 8. ה SPA, עלייה, רכיבי יסוד, מודולים משותפים ומסכי לקוח ראשונים

### סקירה

האזור הוא ה SPA מהבקשה ל `index.html` ועד מסכי הלקוח הראשונים. אין router, ספריית state, ספריית UI או ספריית i18n. כל אלה ממומשים ביד תחת `apps/web/src/shared`, והתלות היחידה בזמן ריצה היא React 19. `index.html` טוען את `main.tsx`, שעוטף את `App.tsx` ב providers. `App.tsx` שואל את השרת מי מחובר דרך `session.ts` ו `api.ts`, בוחר מסך לפי ה hash ש `routing.ts` מפרק, ומרכיב את דפי האזורים. הדפים בנויים מהפרימיטיבים ב `shared/ui` ומתרגמים ערכי שרת לתוויות דרך קטלוגי הדומיין ב `shared`.

סדר קריאה. בנייה ואתחול, אחר כך `api.ts`, `session.ts`, `routing.ts` ו `i18n.tsx`, אחר כך הפרימיטיבים, קטלוגי הדומיין, ובסוף המסכים. כלל אחד מלווה את כל האזור. כל מספר כספי שהלקוח מחשב הוא תצוגה בלבד, והשרת מחשב מחדש בכל פעולה. רוב הבאגים כאן הם פערי תצוגה בין עותק בלקוח לכלל בשרת. שלושה חמורים יותר, E3 בהפקדה המיידית, עמודת היתרה המצטברת בארנק, ומפתח אידמפוטנטיות שמתחדש בכל לחיצה.

```mermaid
flowchart LR
  H[index.html] --> M[main.tsx]
  M --> A[App.tsx]
  A --> S[session.ts] --> API[api.ts]
  A --> R[routing.ts]
  A --> P[areas pages]
  P --> UI[shared/ui]
  P --> D[shared catalogues]
```

#### קבצי בנייה ונכסים

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/package.json` | המניפסט של `@bault/web`. תלויות זמן ריצה רק `react` ו `react-dom`. `build` מריץ `tsc --noEmit` לפני `vite build`, כי esbuild של Vite מוחק טיפוסים בלי לבדוק אותם |
| `apps/web/tsconfig.json` | יורש מ `tsconfig.base.json` עם `strict` ו `noUncheckedIndexedAccess`. `vite/client` נותן את `import.meta.env`. כולל רק את `src`, ולכן `vite.config.ts` לא נבדק בטיפוסים בשום שלב |
| `apps/web/src/fonts.css` | 19 בלוקים של `@font-face` שנוצרו על ידי `scripts/fetch-fonts.mjs`, לא עורכים ביד. `unicode-range` מוריד רק את מה שהדף צריך. שינוי שם של קובץ preload מחייב עדכון ב `index.html` |

#### `apps/web/index.html`
המסמך היחיד שהשרת מחזיר, בפיתוח, ב preview וב nginx. Vite משתמש בו גם כתבנית ומשכתב בבנייה את תגית ה script ואת הזרקת ה CSS.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 8 | `<html lang="he" dir="rtl">` קובע כיוון בסיס עוד לפני ש React עולה | מונע הבהוב LTR לעברית. משתמש אנגלית רואה הבהוב הפוך עד ה effect של `I18nProvider` |
| 10 עד 30 | `charset`, `viewport`, `title`, `description`, ושני `theme-color` לפי `prefers-color-scheme` | הצבעים זהים ל `--surface-page`, אבל לא עוקבים אחרי בחירה ידנית ב `ThemeToggle`. אין `og:url` ו `og:image` בכוונה |
| 32 עד 50 | preload לשני הפונטים של הצביעה הראשונה, Plex לטיני ו Plex עברי, עם `crossorigin` | בלי `crossorigin` הדפדפן מוריד את הפונט פעמיים. שם קובץ שגוי יחזיר ב production את `index.html` במקום פונט |
| 51 עד 61 | Open Graph, `div#root` ו `script type="module"` אחד ל `/src/main.tsx` | אין inline script, כדי ש `script-src 'self'` יעבוד. המחיר הוא שאי אפשר לקבוע `data-theme` לפני הצביעה. ב production הכותרות לא מגיעות לדף, ראה E22 |

#### `apps/web/vite.config.ts`
קובע איך שרת הפיתוח, הבנייה וה preview מתנהגים. רובו תפעול, לאן מעבירים את `/api`, מי רשאי לגשת לשרת חשוף, ואיך מבטיחים שבנייה היא באמת production.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 11 | imports, ו `appDir` ו `repoRoot` מ `import.meta.url`, כי החבילה ESM | |
| 14 עד 19 | הקונפיג הוא פונקציה של `mode`. `loadEnv` עם prefix ריק קורא את קבצי ה env של השורש ושל `apps/web` כדי לקבל את `API_PORT`, ו `resolveApiProxyTarget` בוחר יעד | prefix ריק מכניס ל `fileEnv` גם את כל `process.env`, שגובר על הקבצים. שום ערך מכאן לא נכנס לבאנדל. נקראים גם `.env.local`, `.env.<mode>` ו `.env.<mode>.local`, והקבצים של `apps/web` דורסים את השורש |
| 21 עד 44 | `delete process.env.VITE_USER_NODE_ENV`. ה `.env` בשורש מגדיר `NODE_ENV=development`, ו `loadEnv` מציב ממנו את `VITE_USER_NODE_ENV`, ש Vite הופך לבנייה של פיתוח | הבלוק הקריטי בקובץ. בלעדיו `vite build` מייצר באנדל שבו `SignInPage.tsx` ממלא חשבון seed וסיסמה. מגן רק מ `NODE_ENV` שבא מקובץ, לא מ shell ולא מ `apps/web/.env`. חייב לרוץ אחרי שתי קריאות `loadEnv` |
| 46 עד 64 | `publicHosts`, איחוד של `WEB_PUBLIC_HOST` מקובץ ומהתהליך, מפוצל בפסיקים ובלי כפילויות | |
| 66 עד 80 | `previewUser` עם ברירת מחדל `bault`, ו `previewPassword` עם ברירת מחדל ריקה. סיסמה ריקה פירושה בלי basic auth | `scripts/tunnel.mjs` מייצר סיסמה ומסרב לפתוח tunnel אם ה preview עונה בלי 401 |
| 82 עד 91 | לוג של יעד ה proxy, `react()`, plugin ה basic auth רק כשיש סיסמה, ו `publicDir` שמצביע על `assets` בשורש | כל קובץ שמונח ב `assets` מתפרסם לכל מבקר. ההערה אומרת jpg, הקבצים PNG |
| 92 עד 121 | שרת הפיתוח על 5173. עם `publicHosts` הוא מקבל `host: true` ו `allowedHosts` מפורש, אחרת loopback בלבד | לא `allowedHosts: true`, שמבטל הגנת DNS rebinding. שרת פיתוח חשוף אין לו סיסמה והוא מגיש קוד מקור עם הערות |
| 122 עד 167 | proxy ל `/api` עם `changeOrigin` ו `xfwd`. `secure` כבוי רק ל https על loopback. `configure` מוחק `authorization` מכל בקשה, ובשגיאת חיבור מחזיר 503 עם JSON וקוד `api_unreachable` | הקוד מתואם עם `kindForStatus` ב `api.ts`. הסרת `xfwd` שוברת rate limit לפי IP בפיתוח. המחיקה הגורפת של `authorization` תשבור bearer tokens אם יתווספו |
| 169 עד 201 | ה preview על 4173 עם אותו תנאי host | Vite מוריש ל preview את `proxy` אבל לא את `host` ו `allowedHosts`, ולכן הבלוק נחוץ |
| 205 עד 218 | `collectErrorCodes` אוסף קודי שגיאה, כולל מתוך `AggregateError` של חיבור dual stack | |
| 220 עד 248 | `previewBasicAuth`. middleware שנרשם ישירות ב `configurePreviewServer`, ולכן רץ לפני הגשת הקבצים ולפני ה proxy. השוואת אורך ואז `timingSafeEqual`, וכישלון מחזיר 401 עם `WWW-Authenticate` | העברת הרישום לפונקציה המוחזרת תריץ אותו אחרי ה proxy ותחשוף את `/api`. אין הגבלת קצב |

**שים לב.** `tests/web/no-credentials-in-bundle.test.ts` היא קו ההגנה השני, אבל היא מדלגת כשאין `dist`, ו CI לא בונה את הווב לפניה.

#### `apps/web/proxy-target.ts`
מחשב לאן ה proxy של Vite שולח את `/api`. הוצא מהקונפיג כדי ש `tests/web/proxy-target.test.ts` יבדוק אותו. משפיע רק על פיתוח ו preview, ב production nginx מעביר לפי `API_UPSTREAM`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 37 | הערה, `DEFAULT_API_PORT` של 3000, `DEFAULT_API_HOST` של `127.0.0.1`, וטיפוס `ApiProxyTarget` שמחזיר גם `url` מפורש | `127.0.0.1` ולא `localhost`, כי ב Windows `localhost` נותן `AggregateError` עמום. הפורט אמור לשקף את `@bault/config` ואין אכיפה |
| 39 עד 43 | `isLoopbackHost` מסיר סוגריים של IPv6 ובודק שלושה ערכים | צר בכוונה, כי אמת מכבה אימות TLS |
| 45 עד 50 | `fail` זורק שגיאה קריאה, עם טיפוס `never` | |
| 56 עד 85 | `resolveApiProxyTarget`. קודם `VITE_API_PROXY_TARGET`, רק http או https, ומחזיר רק origin. אחר כך `API_PORT` שלם בין 1 ל 65535. אחרת ברירת המחדל | כל ערך לא תקין זורק מיד, במקום proxy שקט למקום הלא נכון |

#### `apps/web/src/main.tsx`
נקודת הכניסה של ה JavaScript והקובץ היחיד שנוגע ב `react-dom/client`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 7 | imports, כולל `./index.css`, ה import היחיד של CSS באפליקציה | |
| 9 עד 21 | מוחק את המפתח הישן `bault.railPinned` בתוך `try`, פעם אחת לכל טעינת דף | שארית מהתקופה שבה אפשר היה לנעוץ את הרייל |
| 23 עד 27 | מוצא את `#root` וזורק שגיאה ברורה אם חסר | |
| 29 עד 48 | מרכיב `StrictMode`, ואז `ThemeProvider`, `I18nProvider`, `ErrorBoundary` ו `App` | `StrictMode` מריץ כל effect פעמיים בפיתוח, ולכן `loadProfile` מאחד קריאות. `initialLocale` ב `i18n.tsx` ניגש ל `localStorage` בלי `try` ויושב מעל הגבול, כך שאחסון חסום נותן דף לבן |

**שים לב.** יש רק גבול שגיאה אחד לכל האפליקציה. שגיאה בפאנל אחד מורידה את כל ה shell.

#### `apps/web/src/App.tsx`
רכיב השורש. עונה מי מחובר, מה להראות לאורח ומה למשתמש מחובר. זה המקום היחיד שמייבא את כל דפי האזורים, ולכן הוא בפועל טבלת הניתוב של ה SPA.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 56 | imports של המודולים המשותפים, של `shared/ui` ושל כל דפי האזורים, והערת הכותרת | כל הדפים מיובאים סטטית, ואין `import()` דינמי בשום מקום ב `src`. `lazy` ל `AdminConsole` ול `WarehouseConsole` הוא הצעד הראשון לפיצול |
| 57 עד 74 | `ROLE_KEY`, שלושה roles למפתחות תרגום | role לא מוכר מוצג בשמו הגולמי |
| 76 עד 139 | `SectionSpec` ו `SECTIONS`, יעדי הרייל לפי הסדר. `key` הוא המקטע הראשון ב hash, `requires` הוא `staff` או `admin`, `secondary` מציב מתחת לקו | `profile` לא ברשימה, מגיעים אליו מתפריט המשתמש. סקשן חדש דורש רשומה כאן, תנאי ב `main`, מפתחות ב `i18n.tsx` ואולי `TAB_PREFIX`. שכחת התנאי נותנת עמוד ריק |
| 141 עד 155 | `TAB_PREFIX`, קידומת מפתח תרגום ללשונית ב breadcrumb | |
| 157 עד 170 | `BootState` עם `loading`, `anonymous`, `ready` ו `blocked` | 401 הוא אורח. API שלא עונה או 5xx הם `blocked`, כדי שתקלה לא תיראה כהתנתקות ותזמין הקלדת סיסמה |
| 172 עד 209 | `TOKEN_ROUTES` של `verify-email` ו `reset-password`, `AUTH_ROUTES` שממפה `signin`, `signup` ו `forgot`, ו `LANDING_ROUTES` של ריק ו `welcome` | deep link כמו `#/vault` של מי שאיבד session מקבל טופס כניסה ולא דף נחיתה |
| 211 עד 246 | `App`. `loadSession` קורא ל `loadProfile`. `probeSession` מסווג, `unauthenticated` הופך ל `anonymous` וכל השאר ל `blocked` עם `apiErrorKey`. effect אחד בעלייה | ניסיון אחד בלבד, חזרה רק בכפתור |
| 248 עד 266 | נתיבי טוקן מוצגים ב `AuthShell bare` לפני כל בדיקת session, עם `route.params.token` | גם משתמש מחובר מקבל את דף הטוקן ולא מאבד אותו |
| 268 עד 286 | דף נחיתה לכל מצב שאינו `ready`, גם בזמן `loading` | הזזה מתחת ל `loading` תציג spinner לכל מבקר, ומסך שגיאה כשה API למטה. משתמש מחובר שנוחת על `#/` רואה את הנחיתה לרגע לפני האפליקציה |
| 288 עד 320 | מסכי `loading` ו `blocked`. `blocked` מציג `ErrorState` עם retry, ואת `detail` כטקסט LTR | |
| 322 עד 342 | `anonymous`. `onSignedIn` מציב `ready`, מנווט עם `replace` ל `admin`, `warehouse` או `vault`, מאפס עם `resetProfileRequest` וטוען פרופיל מלא | תשובת login מכילה רק `id` ו `role`, ועד ההשלמה ה shell לא יודע על `suspended` |
| 344 עד 361 | עוטף את `Workspace` בלי `key` לפי שפה. `onSignedOut` מאפס ועובר ל `anonymous` | `key={locale}` יחזיר איבוד state בהחלפת שפה |
| 363 עד 395 | `Workspace`. `isMobile` ב 767px, `useNotificationFeed`, `isStaff`, `isAdmin`, `suspended`, ו `allowed` מסונן. מושעה רואה רק `support` | סינון תצוגה בלבד. קוד המנהל והמחסן נמצא בבאנדל של כ 906KB שכל אורח מוריד, כי אין `React.lazy`. ה breakpoint חייב להתאים ל CSS |
| 397 עד 421 | `fallback` לפי role, `requested` מה hash או מ `lastVisitedSection`, `known`, ו `legacyRedirect` שמפורק לשני ערכים פשוטים. effect מיישר את ה hash עם `replace` | הפירוק מונע ריצת effect בכל רינדור בגלל אובייקט חדש |
| 423 עד 449 | `goto`, `roleLabel`, `destinations` עם מונה התראות, כותרת, ו breadcrumb עם `hasMessage` על מפתח הלשונית | `route.tab` משמש רק כמפתח חיפוש בקטלוג, ולכן אינו משטח הזרקה |
| 451 עד 464 | `signOut` שולח `POST /auth/logout`, מתעלם מכישלון, מוחק את הסקשן האחרון ומנווט ל `vault`. בהפניה ישנה מחזירים `null` לפריים אחד | `navigate` כותב את `vault` מחדש מיד אחרי המחיקה. logout שנכשל משאיר עוגייה תקפה בשרת |
| 466 עד 561 | ה shell. skip link, `NavigationRail`, `mobile-bar` בנייד, `PageHeader` עם פעמון, ערכה, שפה ותפריט משתמש, ו `main` עם `key={section}` ושרשרת תנאים לפי סקשן | `href="#main"` משנה את ה hash ומקפיץ לסקשן ברירת המחדל. בערכה כהה בנייד `.mobile-bar` בהיר וכפתור התפריט עם `color: '#fff'` נעלם. שורות 554 ו 555 בודקות שוב `isStaff` ו `isAdmin` |

**שים לב.** חשבון מושעה יכול להיכנס. פעם הוא נחסם בכניסה, ומאז שהשעיה אוטומטית על חוב נוספה זה חסם את הדרך היחידה לשלם. היום ה API מגביל הכל חוץ מנתיבי התמיכה, והרייל מצטמצם ל `support`. מי שמוסיף נתיב לקוח שמושעה צריך, מסמן אותו `@AllowSuspended()` בשרת ומוסיף את הסקשן לסינון כאן.

#### `apps/web/src/index.css`
גיליון הסגנון היחיד, 7146 שורות, בלי CSS modules ובלי Tailwind. כל רכיב משתמש בשמות מחלקה גלובליים, והמבנה הוא שכבות שנוספו לאורך זמן. אין `@layer`, ולכן הסדר בקובץ הוא העדיפות.

| שורות | אזור | שים לב |
|---|---|---|
| 1 עד 379 | `@import './fonts.css'`, מניפסט, ו `:root` עם כל הטוקנים. טיפוגרפיה, משטחים, דיו, חמישה צבעי הדגשה, מרווחים על בסיס 4px, צפיפות, layout ושכבות z. בסוף בלוק legacy שמפנה שמות ישנים כמו `--navy` לטוקנים | טוקן כמו `--text` מחושב על `:root`, ודריסת `--ink-body` בתת עץ לא תשנה אותו |
| 381 עד 407 | מרחבי צפיפות `marketing` ו `warehouse` | |
| 409 עד 535 | הערכה הכהה, פעמיים. פעם תחת `prefers-color-scheme` עם `:root:not([data-theme='light'])`, ופעם תחת `:root[data-theme='dark']` | כל טוקן כהה משנים בשני הבלוקים. `color-scheme` לא עוקב אחרי `data-theme`, ופקדים מקוריים מצוירים לפי המערכת |
| 537 עד 868 | reset, קודים מול מספרים, `.serial`, `.amount`, `.ltr-run` ו `.date` לבידוד bidi, ו focus | תאריך מקבל `plaintext` ולא `ltr`, כי תאריך עברי אינו רצף לטיני |
| 870 עד 1617 | shell, skip link, רייל, כותרת ופופאוברים | |
| 1619 עד 2203 | `.page`, `.panel`, סרגל הלשוניות `.ctx-bar`, כפתורים `.btn--gold`, `--navy`, `--secondary`, `--ghost` ו `--danger`, `.field` ו `.money-input` | זה האזור ש `primitives.tsx` נשען עליו. שם מחלקה שגוי לא נותן שגיאה, רק רכיב בלי עיצוב |
| 2205 עד 2869 | `.hero-balance` ליתרה, `.metric-card`, `.data-table` ו `dt-wrap--stack` שהופך טבלה לכרטיסים בנייד, ותגים `.pill--<tone>` | `.metric-icon` מוסתר בשורה 2335 |
| 2871 עד 3421 | מגירה עם `--drawer-from` שמתהפך ב RTL, במת צילום, דיאלוג, מצבים ריקים ושלדים | `.confirm-sheet` בשורות 3186 עד 3280 הוא CSS מת |
| 3423 עד 4546 | כספת, ברקוד על רקע `#fff` קבוע, מסכי אורח, נחיתה ומנוי | |
| 4548 עד 4871 | עזרים ישנים, האזור הרספונסיבי עם breakpoints של 1199, 900 ו 767 פיקסלים, ו `.sr-only` | ב 767px הרייל הופך למגירה ומוצג `.mobile-bar` |
| 4873 עד 5985 | אזורי מוצר, הפחתת תנועה והדפסה | |
| 5987 עד 7146 | שכבת מערכת מאוחרת שדורסת לפי סדר, רכיבים מאוחרים, ובסוף `.error-boundary` | `.field`, `.skel`, `.data-table` ו `.icon-btn` מוגדרים שוב כאן |

**איך עורכים.** מחפשים את כל ההגדרות של מחלקה ולא רק את הראשונה. משתמשים רק בטוקנים ובמאפיינים לוגיים כמו `margin-inline-start`, ובקובץ אין `margin-left` בכלל. transform שתלוי בכיוון מקבל משתנה שמתהפך תחת `[dir='rtl']`. צבע חדש הוא טוקן ב `:root` ובשני בלוקי הכהה. מריצים `node scripts/design-lint.mjs`, שאינו מחובר ל CI, ובודקים עברית ואנגלית, בהיר וכהה, ורוחב 767px ומטה.

#### `apps/web/src/shared/api.ts`
ה client היחיד של ה API בדפדפן. כל רכיב קורא ל `api.get`, `post`, `patch`, `put` או `del` ומקבל גוף מפוענח או `ApiError`. שלוש החלטות מרוכזות כאן, העוגייה נשלחת תמיד, כל כישלון מסווג, ואין retry. נבדק ב `tests/web/api-client.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 | `BASE` הוא `/api/v1`, נתיב יחסי ולכן תמיד אותו origin | שינוי מחייב שינוי מקביל ב `vite.config.ts` וב `nginx.conf` |
| 14 עד 26 | `ApiErrorKind`, שישה סוגים. `unreachable`, `unauthenticated` ל 401, `forbidden`, `not_found`, `server` ל 5xx, ו `client` לכל 4xx אחר | זה החוזה ש `App.tsx` נשען עליו להבחנה בין אורח לתקלה |
| 28 עד 42 | `ApiError` יורש מ `Error` ומוסיף `kind`, `status` שהוא 0 כשלא הגענו לשרת, ו `code` מהמעטפה האחידה של השרת, למשל `insufficient_funds` | הגבו לפי `code` ולא לפי טקסט ההודעה |
| 44 עד 47 | `isUnreachable` | |
| 49 עד 78 | `apiErrorKey` ממפה סוג למפתח תרגום, ומחזיר `null` ל `client` ולכל חריגה אחרת, כי הודעת השרת מועילה יותר | הטיפוס מוגדר כאן כמחרוזות ולא מיובא מהקטלוג, אבל מחיקת מפתח `error.*` תכשיל קומפילציה ב `App.tsx` |
| 80 עד 89 | `kindForStatus` בודק קודם את הקוד `api_unreachable` של ה proxy ורק אחר כך את הסטטוס | ב production nginx מחזיר 502 עם HTML, והשגיאה תסווג `server` ולא `unreachable` |
| 91 עד 121 | `request`. `fetch` עם `credentials: 'include'`, `...options` לפני `headers`, ו headers ממוזגים כך ש `Idempotency-Key` לא דורס את `Content-Type`. כישלון של `fetch` עצמו הופך ל `unreachable` עם סטטוס 0. 204 בלי גוף, JSON לא תקין הופך ל `null`, וסטטוס לא תקין זורק עם `error.code` ו `error.message` | אין timeout ואין `AbortController`. תשובת 200 שאינה JSON חוזרת כ `null` מוקלד כ `T`. הטיפוס `T` הוא הבטחה ולא בדיקה. ההודעה נבחרת עם `\|\|` ולא `??`, כי `statusText` ריק ב HTTP/2 |
| 123 עד 142 | האובייקט `api`. רק `post` מקבל headers, ולכן הוא הדרך היחידה לשלוח `Idempotency-Key`. `put` נוסף אחרי ש `NotificationsPage` כתב `fetch` ידני ואיבד את הסיווג | גוף falsy כמו `0` או מחרוזת ריקה לא נשלח בכלל. היום רק `HouseStorePanel.tsx` שולח `Idempotency-Key` כ header, ו checkout מקבל את המפתח בגוף |

**שים לב.** אין טיפול גלובלי ב 401. session שפג באמצע משאיר את המשתמש עם מסכים שנכשלים אחד אחד עד רענון. ההגנה מ CSRF נשענת רק על `sameSite: 'lax'` של העוגייה, וה API מקבל גם גוף urlencoded, ראה E8. retry אוטומטי יהפוך כל POST לא אידמפוטנטי למסוכן.

**איך קוראים ל API מרכיב חדש.** רק דרך `api`, לעולם לא `fetch` ישיר, אחרת הסיווג הולך לאיבוד. מגדירים ביד את טיפוס התשובה ב `api.get<T>`, ותופסים `ApiError`. להודעה מתורגמת משתמשים ב `apiErrorKey`, ונופלים ל `message` רק כשהוא מחזיר `null`. לשגיאה עסקית מגיבים לפי `code`. נתיב שדורש אידמפוטנטיות מקבל את המפתח כ header דרך הפרמטר השלישי של `api.post`, או בגוף כ `idempotencyKey`, לפי מה שהבקר בשרת מצפה. המפתח נוצר פעם אחת לכל כוונה, לא לכל לחיצה.

#### `apps/web/src/shared/session.ts`
עונה מי מחובר. העוגייה `httpOnly`, ולכן חייבים לשאול את השרת ב `GET /me/profile`, שמסומן `@AllowSuspended()`. נבדק ב `tests/web/session.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 32 | `SessionProfile` עם `id`, `role`, `status`, אימייל, שם משתמש, חלקי שם ו `nameReviewRequired` | `role` מוקלד `string`, ולכן טעות כתיב בהשוואה ב `App.tsx` לא נתפסת. הטיפוס כתוב ביד ושדה שהשרת לא שולח יהיה `undefined` |
| 34 עד 47 | `inFlight`, promise ברמת המודול | נבחר על פני ביטול `StrictMode` ועל פני ref, שהיה בולע גם טעינה שנייה לגיטימית |
| 49 עד 63 | `loadProfile` מחזיר את הבקשה הפעילה אם יש. ה `finally` מנקה את המשבצת רק אם היא עדיין מחזיקה את אותה בקשה, וה `.catch` אחריו מונע אזהרת unhandled rejection על כל 401 של אורח | איחוד בקשות מקבילות בלבד, לא cache. cache אחרי הצלחה יציג פרופיל של משתמש קודם אחרי יציאה וכניסה |
| 65 עד 68 | `resetProfileRequest`, נקרא אחרי כניסה ואחרי יציאה | בלעדיו טעינה אחרי כניסה יכולה לקבל 401 של בקשה מלפני הכניסה |

**שים לב.** זהות המשתמש לעולם לא נשמרת ב `localStorage`, וכך צריך להישאר.

#### `apps/web/src/shared/routing.ts`
ה router, בלי ספרייה. הכתובת היא `#/<section>/<tab>?<params>`. גם מיילי האימות והאיפוס ב `verification.service.ts` בונים קישורי hash, כך שכל המערכת נשענת על הבחירה הזו. טבלת הנתיבים וה role gating נמצאים ב `App.tsx`, לא כאן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 24 | `Route` עם `section`, `tab` ו `params`, והמפתח `bault.tab` לסקשן האחרון | השם `tab` היסטורי, הערך הוא section. אין union של סקשנים |
| 26 עד 68 | `LEGACY_ROUTES` של `services` ו `shipping`, ו `LEGACY_TABS` לפי סקשן, למשל `wallet/topup` ל `cash-in` | ההערה טוענת שה tab המבוקש נשמר. הקוד תמיד מחזיר את ה tab הקבוע מהטבלה |
| 78 עד 86 | `legacyRedirect`, סקשן שהוסר גובר על לשונית שהוסרה | כל היעדים קבועים מטבלה סגורה, ולכן אין open redirect. נבדק ב `tests/web/routing.test.ts` |
| 88 עד 101 | `parse` מסיר `#/`, מפצל על `?` הראשון, מפענח כל מקטע ומחזיר section ו tab | `decodeURIComponent` בשורה 91 זורק על `#/%E0` בזמן render, והאפליקציה כולה עוברת למסך תקלה שרענון לא מתקן. `?` נוסף בערך שנכתב ביד הולך לאיבוד, ו `build` מקודד אותו |
| 103 עד 111 | `build` מקודד מקטעים, משמיט params ריקים, ותמיד מתחיל ב `#/` | |
| 113 עד 126 | `useRoute` עם `useSyncExternalStore` על `hashchange`, ומרנדר רק כשמחרוזת ה hash משתנה | `parse` מחזיר אובייקט חדש בכל render, מה שמבטל memoization של הפונקציות מ `useNavigation` |
| 133 עד 150 | `navigate` יוצא אם ה hash זהה, כותב את הסקשן ל `localStorage` בתוך `try`. עם `replace` קורא ל `history.replaceState` ומשגר `hashchange` ידנית | בלי השיגור ידני הפניה עם `replace` תשנה URL בלי רינדור |
| 153 עד 167 | `lastVisitedSection` ו `clearLastVisitedSection`, עטופים ב `try` | |
| 174 עד 231 | `useNavigation`. `goSection`, `goTab` שמנקה params, `openRecord` שדוחף רשומת history כך ש Back סוגר מגירה, `setParams` עם `replace` כברירת מחדל, ו `closeRecord` | `closeRecord` דוחף רשומה, ולכן Back אחרי סגירה פותח את המגירה שוב. מסנני השוק חיים כאן כדי שקישור לחיפוש ישותף |

**שים לב.** מעבר ל History API ישבור את כל הקישורים שכבר נשלחו במיילים. hash גם לא נשלח לשרת ולא נכנס ל Referer, מה שמגן על טוקנים.

**איך מוסיפים לשונית או מגירה.** לשונית היא `route.tab` שהדף קורא עם ברירת מחדל לערך לא מוכר, ומחליפים אותה ב `goTab`. רשומה פתוחה היא param, נפתחת ב `openRecord` ונסגרת ב `closeRecord`. מסננים שצריך לשתף עוברים ב `setParams`. שם לשונית שמשתנה מקבל שורה ב `LEGACY_TABS`, כדי שקישורים ישנים לא ישברו.

#### `apps/web/src/shared/i18n.tsx`
כל מחרוזת שמשתמש רואה עוברת כאן. 4719 שורות, מתוכן כ 4600 שני קטלוגים וכמאה שורות מנגנון. עברית היא ברירת המחדל ומקור האמת.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 22 | `Locale` של `he` או `en`, `DEFAULT_LOCALE`, `LOCALES`, המפתח `bault.locale`, ו `MessageVars` | |
| 24 עד 2323 | הקטלוג `he`, אובייקט literal אחד עם `as const`. כ 2100 מפתחות בסגנון נקודות, למשל `wallet.request.status.pending`, מחולקים בערך בהערות כותרת | הסדר לא אלפביתי וכותרות חוזרות. מוצאים מפתח בחיפוש טקסט. `error.unreachable` בשורה 1198 מורה להריץ `pnpm dev` גם ב production. כ 91 הערות כותרת מחלקות אותו, והקטלוג האנגלי שומר על אותו סדר בלי אכיפה |
| 2325 עד 4624 | `MessageKey` נגזר מ `he`, ו `en` מוקלד `Record<MessageKey, string>` | מפתח חסר, עודף או כפול באנגלית נכשל בקומפילציה. ערך שנשאר בעברית או placeholder שנשמט נתפסים רק בבדיקה |
| 4626 עד 4633 | `messages` ו `MESSAGES` המיוצא לבדיקות | הצרכן היחיד `tests/ux/audit-screens.test.tsx` |
| 4635 עד 4641 | `format` מחליף `{name}` במעבר אחד. placeholder שלא סופק נשאר מילולי | הפלט טקסט ש React עושה לו escape, וערך מהשרת לא יכול להזריק placeholder או HTML. `name in vars` בודק גם את ה prototype |
| 4643 עד 4664 | `hasMessage`, type guard עם `hasOwnProperty`, ו `MESSAGE_KEYS` | `App.tsx` משתמש ב `hasMessage` ל breadcrumb דינמי |
| 4666 עד 4670 | `t` מחפש בשפה המבוקשת, אחר כך בעברית, ובסוף מחזיר את המפתח עצמו | בכ 48 מקומות מפתח נבנה בזמן ריצה עם `as MessageKey`. ערך enum חדש בשרת יוצג שם כמפתח גולמי ושום בדיקה לא תתפוס |
| 4672 עד 4681 | `TranslateFn`, `I18nValue` ו `I18nContext` | |
| 4683 עד 4686 | `initialLocale` קורא את השפה השמורה ומקבל רק שני ערכים | `localStorage` בלי `try`, בניגוד ל `theme.tsx`. אחסון חסום נותן דף לבן |
| 4688 עד 4708 | `I18nProvider`. effect כותב ל `localStorage` ומציב `lang` ו `dir` על `<html>`. `translate` ב `useCallback` לפי שפה | זה כל מנגנון ה RTL, כי ה CSS לוגי. שפה שלישית דורשת לשנות גם את לוגיקת `dir` |
| 4710 עד 4719 | `useI18n` שזורק בלי provider, ו `useT` | |

**איך מוסיפים מחרוזת.** מוסיפים מפתח ל `he` ליד מפתחות של אותו אזור. typecheck ייכשל ב `en`. מוסיפים תרגום עם אותם placeholders בדיוק. משתמשים ב `t('the.key', { var })`. מריצים `pnpm test:web`, ו `tests/web/i18n-catalogue.test.ts` בודק placeholders זהים, שלא נשארה עברית באנגלית ושאין אזכור ShipMyCards. אין plurals, ניסוח ליחיד מקבל מפתח נפרד עם `_one`. מפתח שנבנה מ enum צריך ערך לכל ערך enum, ושום דבר לא יבדוק זאת.

#### `apps/web/src/shared/theme.tsx`
ערכת צבעים, בהיר, כהה או לפי מערכת. `main.tsx` עוטף בו, והצרכן היחיד של `useTheme` הוא `ThemeToggle` ב `PageHeader.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 19 עד 33 | `ThemeChoice`, המפתח `bault.theme`, `ThemeValue` עם `choice`, `resolved`, `setChoice` ו `cycle` | |
| 35 עד 50 | `storedChoice` קורא בתוך `try` ומקבל רק שלושה ערכים. `systemPrefersDark` בודק `matchMedia` | ערך רביעי ב `ThemeChoice` דורש עדכון כאן, אחרת הוא נזרק ל `system` |
| 52 עד 74 | effect אחד עוקב אחרי `prefers-color-scheme`. השני מוחק `data-theme` ב `system` ומציב אותו אחרת, וכותב ל `localStorage` | התכונה נקבעת אחרי הצביעה הראשונה, ולכן מי שבחר כהה על מערכת בהירה רואה הבהוב. תיקון דורש inline script שה CSP אוסר |
| 76 עד 100 | `cycle` עם updater, ערך context ב `useMemo`, ו `useTheme` שזורק בלי provider | |

#### `apps/web/src/shared/hooks.ts`
שלושה hooks. `useNotificationFeed` נקרא פעם אחת ב `Workspace` ומשרת גם את הפעמון וגם את `NotificationsPage`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 4 עד 24 | `useMediaQuery` עם אתחול עצל ומאזין `change`, ו `usePrefersReducedMotion` | |
| 26 עד 33 | `AppNotification`, עם `content` מסוג `unknown` | רק `renderContent` ב `notifications.ts` מצמצם אותו |
| 35 עד 43 | `SEEN_KEY` הוא `bault.notificationsSeenAt`, וקריאה בתוך `try` | בלי מזהה משתמש. שני חשבונות באותו דפדפן חולקים מצב נקרא |
| 52 עד 73 | `reload` טוען `GET /notifications` וממיין מהחדש לישן בהשוואת מחרוזות ISO. טעינה אחת ב mount | אין polling. השגיאה נשמרת כמחרוזת ומאבדת את ה `kind`. השרת מחזיר בלי `limit`, ושורות ערוץ email מופיעות גם הן ונספרות פעמיים |
| 75 עד 88 | `markSeen` כותב את שעת הדפדפן, ו `unseen` סופר רשומות חדשות ממנה | משווה שעון דפדפן לשעון שרת. אין בשרת שדה נקרא |


**איפה חי ה state בצד הלקוח.** אין ספריית state. נתוני שרת נשמרים ב `useState` של הרכיב שטען אותם ונטענים מחדש ב `reload` מפורש. מה שחי בלקוח בלבד מפורט כאן. ב `localStorage` אין סוד, אסימון, מזהה משתמש או סכום, וכך צריך להישאר.

| מקום | מה נשמר | קובץ |
|---|---|---|
| עוגיית `httpOnly` | אסימון ה session, לא נגיש ל JavaScript | `auth.controller.ts` בשרת |
| ה hash | section, tab, רשומה פתוחה ומסננים | `routing.ts` |
| `bault.tab` | הסקשן האחרון, נמחק ביציאה | `routing.ts` |
| `bault.locale` ו `bault.theme` | שפה וערכה | `i18n.tsx` ו `theme.tsx` |
| `bault.notificationsSeenAt` | מתי נראו ההתראות לאחרונה | `hooks.ts` |
| React context | שפה וערכה, לכל הצרכנים | `i18n.tsx` ו `theme.tsx` |
| `useState` ב `App.tsx` | הפרופיל של המשתמש המחובר ומצב ה boot | `App.tsx` |
#### `apps/web/src/shared/ui/primitives.tsx`
ספריית הרכיבים הבסיסית, דפוס P9, ו 57 קבצים מייבאים ממנה. אין בה לוגיקה עסקית, רק שמות מחלקות מול `index.css` ודפוסי נגישות. הבדיקות ב `tests/ux/design-system.test.tsx` וב `tests/ux/custody-grade.test.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 69 | `Button` עם `variant` מחמישה, `size`, `block`, `loading` ו `icon`. `type` ברירת מחדל `button`, `disabled={disabled \|\| loading}`, `aria-busy` רק כשעסוק, וה spinner מחליף את האייקון | זו ההגנה של הלקוח מלחיצה כפולה בטפסי כסף, לא תחליף לאידמפוטנטיות בשרת. שינוי ברירת המחדל ל `submit` ישלח טפסים מכל כפתור ביטול |
| 71 עד 157 | `Field` עוטף פקד עם תווית, רמז ושגיאה עם `role="alert"`. בלי `htmlFor` הוא יוצר מזהה ב `useId` ומשכפל ילד יחיד עם `cloneElement` כדי להצמיד `id` ו `aria-describedby` | כש `htmlFor` מועבר הילד לא נוגע, והרמז לא מוצמד. `Field` לעולם לא מציב `aria-invalid` למרות ההערה. ילד עם `id` משלו בלי `htmlFor` משאיר תווית שמצביעה על כלום |
| 159 עד 235 | `MoneyField`. הערך מחרוזת, `onChange` מקבל מחרוזת, `inputMode="decimal"`, `dir="ltr"`, ו `aria-invalid` רק כשיש שגיאה | ההמרה לסנטים אצל הקורא, דרך `dollarsToCents`. `...rest` ראשון, כך שהקורא לא דורס את `dir` או `inputMode` |
| 237 עד 256 | `IconButton` עם `label` חובה שהופך ל `aria-label` ול `title` | |
| 262 עד 297 | `Panel`, `section` עם `h2` אופציונלי, `tools`, `flush` ו `footer` | היררכיית הכותרות היא `h1` מ `PageHeader` ואז `h2` לכל פאנל |
| 303 עד 323 | `StatusTone` של שבעה ערכים ו `StatusBadge` עם `pill--<tone>` | tone `undefined` מקטלוג חסר נותן תג בלי צבע |
| 329 עד 403 | `EmptyState`, `ErrorState` עם `role="alert"` וכפתור retry רק כשגם `onRetry` וגם `retryLabel` הועברו, ו `SuccessNote` עם `role="status"` | ההודעות מוצגות כטקסט, ולכן הודעת שרת לא מזריקה HTML |
| 405 עד 431 | `SkeletonTable` ו `SkeletonBlock`, הכל `aria-hidden` | קורא מסך לא שומע הודעת טעינה |
| 437 עד 460 | `MetricCard` עם `icon` חובה | `.metric-icon` מוסתר ב CSS, האייקון לעולם לא מוצג. הצרכן היחיד `WalletPage.tsx` |
| 466 עד 532 | `ContextTabs`, `role="tablist"` עם roving tabindex. חצים קוראים את `dir` בזמן הלחיצה ומתהפכים ב RTL, ו Home ו End לקצוות | החצים לא מעבירים פוקוס, הטבעת נשארת על לשונית עם `tabIndex={-1}`. המזהים `tab-<key>` גלובליים |
| 534 עד 576 | `TabPanel` עם `aria-labelledby`, `ViewAllLink` שהחץ שלו מתהפך ב CSS, ו `DetailRow` כזוג `dt` ו `dd` | `DetailRow` חייב לשבת בתוך `dl` |

**איך בונים טופס נגיש מהפרימיטיבים.** עוטפים כל פקד ב `Field` בלי `htmlFor`, ונותנים ל `Field` ליצור מזהה ולהצמיד רמז ושגיאה. מציבים `aria-invalid` על הפקד בעצמכם. בתוך `form` כפתור השליחה מקבל `type="submit"` במפורש ו `loading` בזמן הבקשה, וכל כפתור אחר נשאר `button`. סכום כסף נכנס ב `MoneyField` ומומר ב `dollarsToCents` רק בשליחה.

#### `apps/web/src/shared/ui/DetailDrawer.tsx`
שני overlays מודאליים, דפוס P9. `DetailDrawer` היא מגירת רשומה ו `ConfirmationModal` הוא אישור לפעולה בלתי הפיכה. 12 קבצים משתמשים בהם.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 6 עד 33 | `FOCUSABLE`, ומחסנית `overlays` של `symbol` ברמת המודול עם `pushOverlay` ו `isTopOverlay` | המחסנית נולדה מבאג שבו Escape בדיאלוג תרומה סגר את כל המגירה |
| 43 עד 61 | `trapTab` לוכד Tab בין הראשון לאחרון ומסנן מוסתרים לפי `offsetParent` | Shift Tab כשהפוקוס על הפאנל עצמו יוצא מהמגירה, וזה המצב מיד בפתיחה |
| 84 עד 143 | `DetailDrawer`. ה effect שומר את מי שפתח, דוחף אסימון, מעביר פוקוס לפאנל, מאזין ל `keydown` ב capture על `document`, Escape סוגר רק אם עליון ועוצר propagation, ונועל גלילה. ה cleanup מחזיר הכל | ה effect תלוי ב `onClose`, ורוב הקוראים מעבירים פונקציה inline. כל רינדור של ההורה מקפיץ פוקוס, ומעביר את המגירה לראש המחסנית מעל דיאלוג פתוח. תיקון, `onClose` ב ref ו effect עם תלויות ריקות. `stopPropagation` ב capture על `document` מסתיר את Escape מכל מאזין אחר, ופופאובר בתוך מגירה ייסגר רק יחד איתה |
| 145 עד 180 | רקע שלחיצה עליו סוגרת אלא אם `dirty`, ו `aside` עם `role="dialog"`, `aria-modal` ו `h2`. כשיש `lead` הכותרת המלאה נוספת כ `sr-only` | `dirty` נבדק רק ברקע. Escape וכפתור הסגירה סוגרים טופס חצי מלא. מגירה נפתחת מ param ב URL דרך `openRecord`, ו `onClose` צריך להיות יציב, למשל `useCallback`. הסרת `aria-modal` או שינוי ה role ישברו את בדיקות ה axe ב `tests/ux` |
| 188 עד 232 | `ConfirmationModal`, props עם `tone` ו `busy`, ו effect באותו מבנה בלי נעילת גלילה | Escape קורא ל `onCancel` גם כש `busy`, והבקשה ממשיכה בשרת |
| 234 עד 270 | הדיאלוג. רקע וכפתור ביטול מושבתים כש `busy`, אישור עם `loading={busy}` | הכותרת `h4`, שוברת את היררכיית הכותרות |

#### `apps/web/src/shared/ui/PageHeader.tsx`
רכיבי הכותרת של ה shell, דפוס P9. `LanguageSwitcher` משמש גם בדף הכניסה ובדף הנחיתה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 70 | `Crumb` ו `PageHeader` עם ה `h1` היחיד בעמוד ו breadcrumb. האחרון מקבל `aria-current="page"` | המפריד `›` מתהפך ב RTL בעצמו, כי הוא bidi mirrored |
| 72 עד 140 | `AccountPill`. מושעה מקבל pill אזהרה, אחרת `@username` ב LTR ותווית role, ובלי שם משתמש רק ה role | המצב בלי שם משתמש הוא הפריים שבין login לטעינת הפרופיל |
| 146 עד 170 | `usePopover` משותף. סוגר ב `mousedown` מחוץ לעטיפה וב Escape, ומחזיר פוקוס לכפתור | הפוקוס לא נכנס לתפריט בפתיחה ואין ניווט בחצים. `close` inline רושם מחדש בכל רינדור |
| 176 עד 265 | `NotificationBell`, חמש אחרונות, `label` שכולל את המונה ותג `9+`. `onOpen` נקרא רק בפתיחה ומסמן נקרא | התאריך בשורה 240 הוא `createdAt.slice(0, 10)`, תאריך UTC ולא מקומי. `renderTitle` ו `renderText` מוזרקים מ `App.tsx`, כדי שהרכיב לא יכיר את קטלוג ההתראות |
| 271 עד 326 | `ThemeToggle` קורא ל `useTheme` ומחליף אייקון לפי מצב | הערת JSDoc של `LanguageSwitcher` יושבת מעליו |
| 328 עד 388 | `LanguageSwitcher`, `role="menu"` עם `menuitemradio`, ו `dir` לכל פריט לפי שפתו | |
| 403 עד 491 | `UserMenu` עם ראשי תיבות, פרופיל, הגדרות, שורת role ויציאה. כל פריט סוגר לפני שהוא פועל | פרופיל והגדרות מובילים שניהם ל `profile` |

#### `apps/web/src/shared/ui/NavigationRail.tsx`
הניווט הראשי. בדסקטופ פס צר שמתרחב בריחוף או בפוקוס, ומתחת ל 767 פיקסלים מגירה שה shell פותח. הרכיב רק מתרגם אירועי DOM לאירועים של `navRailState.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 50 | `NavDestination` עם `count` אופציונלי, והערה | ההערה אומרת 76px, ב CSS `--rail-w` הוא 72px |
| 51 עד 81 | `useReducer`. במובייל `expanded` הוא `open` שה shell העביר, בדסקטופ `isExpanded`. `go` מודיע ל shell, שולח `navigate` וסוגר מגירה | |
| 83 עד 112 | scrim במובייל, `pointerEnter` ו `pointerLeave`, `onMouseMove` שמוסר כשאין מה לשנות, ו `onBlur` שבודק `relatedTarget` | בלי בדיקת `relatedTarget` הרייל יתכווץ בכל Tab בין פריטים |
| 113 עד 138 | קישור מותג שמנווט לסקשן המורשה הראשון, ושתי קבוצות עם קו מפריד | |
| 148 עד 187 | `RailGroup`, כפתור לכל יעד עם `aria-current`, נקודה ומונה `99+` שהם `aria-hidden` | `.rail-label` מוסתר ב `opacity` ולא ב `display: none`, כדי שלכפתור המכווץ יישאר שם נגיש |

**שים לב.** במובייל המגירה הסגורה רק מוזזת מחוץ למסך, בלי `inert`. הכפתורים שלה בסדר ה Tab, ואין Escape או לכידת פוקוס.

#### `apps/web/src/shared/ui/navRailState.ts`
מכונת המצבים של הרייל כ reducer טהור בלי React, כדי ש `tests/web/nav-rail.test.ts` יבדוק אותה ב Node.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 26 עד 50 | שלושה דגלים, `hovering`, `focusWithin` ו `dismissed`, ושישה אירועים | |
| 58 עד 61 | `isExpanded`, מכווץ אם `dismissed`, אחרת מורחב בריחוף או בפוקוס | |
| 63 עד 127 | `navRailReducer`. `pointerEnter` מציב ריחוף בלבד, `pointerMove` ו `focusEnter` מנקים `dismissed`, `navigate` מציב אותו. כשאין שינוי מוחזר אותו אובייקט | ההבחנה בין enter ל move היא הטריק. אחרי בחירה הדפדפן יורה leave ו enter, והרייל חייב להישאר מכווץ. מצב נעיצה יכשיל את הבדיקה `exposes no pin field at all`. לחיצה יוצרת `focusin` ואז `click`, ולכן `focusEnter` מנקה את `dismissed` ו `navigate` מציב אותו שוב |

#### `apps/web/src/shared/ui/ErrorBoundary.tsx`
גבול שגיאה של React. הצרכן היחיד `main.tsx`, סביב כל `App`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 39 | props `area` ו `onError`, ו `getDerivedStateFromError` ששומר את השגיאה | אף קורא לא מעביר `area` או `onError`, ולכן אין דיווח מחוץ לדפדפן |
| 41 עד 49 | `componentDidCatch` מדפיס ל console, ו `reset` מאפס | ההערה אומרת שהשגיאה נזרקת מחדש, הקוד רק מדפיס |
| 51 עד 90 | מסך עם `role="alert"`, `error.message` ושני כפתורים | הטקסט באנגלית בלבד. המחלקות `btn-gold` ו `btn-secondary` עם מקף אחד לא קיימות ב CSS, הנכון `btn--gold`. ההודעה מבטיחה שדבר לא אבד, אבל כל קלט שלא נשמר נעלם. גבול לכל סקשן ב `App.tsx` עם `key={section}` ישאיר את הרייל והכותרת חיים. `error.message` מוצג למשתמש כמו שהוא |

#### `apps/web/src/shared/ui/PhotoInput.tsx`
פקד צילום בעמדות המחסן. כל קובץ מועלה מיד ל `POST /media/uploads`, והטופס שמסביב מקבל רק מפתחות. ארבעה קבצי מחסן משתמשים בו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 29 עד 58 | `PhotoRef` עם `objectKey`, blob URL ושם, ו props עם `purpose`, `value`, `onChange` ו `max` של 6. `busy` הוא מונה העלאות | `purpose` חייב להתאים ל `@IsIn` בשרת |
| 60 עד 66 | `read` הופך קובץ ל data URL ב base64 | ניפוח של שליש, וכל הקובץ בזיכרון כמחרוזת |
| 68 עד 101 | `add` חותך עד `max`, מעלה קובץ אחרי קובץ עם `api.post`, יוצר blob URL בהצלחה, ובסוף קורא ל `onChange([...value, ...added])` | אין בדיקת גודל בלקוח. `add` סוגר על `value` ישן, ותמונה שנמחקה בזמן העלאה חוזרת שבורה. `busy` לא מדווח להורה, ואפשר לשמור רשומה לפני שההעלאה הסתיימה ולאבד ראיות. בשרת קובץ גדול נעצר ב `@MaxLength` של ה DTO או ב 413 של גבול ה JSON, עם הודעה גנרית, לפני ש `MAX_IMAGE_BYTES` של 10MB נותן הודעה ידידותית |
| 103 עד 109 | `remove` משחרר blob URL ומסנן | בשליחה או ב unmount ה blob URLs לא משוחררים |
| 111 עד 190 | רצועת תמונות, משבצות טעינה, כפתור הוספה, input נסתר עם `accept` של חמישה סוגים ו `capture="environment"`, ושגיאה או רמז | ה input מאופס מיד אחרי `add`, וזה בטוח כי `Array.from(files)` רץ לפני ה `await` הראשון. `error` לעולם לא מתאפס |
| 196 | `photoKeys` ממפה לרשימת מפתחות | |

**שים לב.** העלאות שלא צורפו נשארות באחסון בלי ניקוי, וכל משתמש מחובר יכול להעלות, ראה E9.

#### `apps/web/src/shared/ui/Serial.tsx`
חמישה רכיבים לרצפים לטיניים בעמוד עברי. בלי בידוד, אלגוריתם ה bidi מסדר מחדש ספרות וסימנים. 11 קבצים מייבאים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 38 עד 78 | `Serial` ו `Code` עם `dir="ltr"` ו `translate="no"`. `Code` מותר לשבירה, למספר מעקב ארוך | `translate="no"` מונע מתרגום אוטומטי לשנות מזהים שמשתמשים מעתיקים |
| 92 עד 129 | `Amount` מקבל סכום מעוצב כבר ב `formatUsd`, עם `size`, `tone` ו `what` שמופיע אחרי הסכום | הכלל שהסכום בא לפני מה הוא מקודד במבנה. אין `translate="no"`, בניגוד ל `Serial` |
| 143 עד 159 | `Seal`, חותם למה ש Bault טיפל בו פיזית | הרכיב לא אוכף את הכלל |
| 168 עד 170 | `LtrRun` בלי `dir` ב HTML, רק CSS | שינוי שם מחלקה דורש שינוי ב `index.css` ובבדיקות `tests/ux` |

#### `apps/web/src/shared/ui/icons.tsx`
מערכת אייקונים אחת כרכיבי React שמחזירים SVG inline, דפוס P9. אין קבצי SVG, אין sprite ואין ספרייה. 38 קבצים מייבאים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 29 | העטיפה `Svg` עם `viewBox` של 24, `stroke="currentColor"`, עובי 1.6, `aria-hidden` ו `focusable="false"`, ו `rest` אחרון | `currentColor` הוא מה שצובע אייקון לפי ערכה ומצב בלי קוד. אייקון בעל משמעות צריך `aria-hidden={false}` ו `aria-label`, וכפתור עם אייקון בלבד עובר דרך `IconButton` |
| 31 עד 545 | כחמישים אייקונים בקבוצות לפי הערות, ו `VaultDoorArt` לכרטיס היתרה עם 12 ברגים בלולאה | ה gradient `bault-vault-sheen` גלובלי במסמך, ושני מופעים יחלקו אותו. ההערה של `IconLegal` מתארת סימן שאלה שלא קיים |
| 555 עד 582 | `IconSun`, `IconMoon` ו `IconMonitor` כותבים `svg` ישירות בלי `aria-hidden` | חורגים מהחוזה של הקובץ. הם בתוך `ThemeToggle` עם `aria-label`, ולכן השם נקבע מהכפתור |

#### `apps/web/src/shared/Barcode.tsx`
שכבת React מעל `barcode128.ts`, ברקוד, הדפסת תוויות וכפתורים. נבדק ב `tests/ux/barcode-printing.test.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 23 עד 42 | `Barcode` מחשב SVG ב `useMemo`, מציג `code` טקסטואלי אם הקידוד זורק, ואחרת `dangerouslySetInnerHTML` | השימוש היחיד באפליקציה. בטוח כי כל תו עבר בדיקת ASCII ו `escapeXml` |
| 45 עד 59 | `PrintableLabel` ו `printBarcode` לתווית אחת | |
| 74 עד 149 | `printBarcodes` מקודד ברוחב מודול 3, כותב מסמך שלם ל iframe מוסתר עם `document.write`, וקורא ל `print()`. ניקוי ב `onafterprint` או בטיימר של 60 שניות | ההדפסה מבודדת מ `index.css`. הטיימר עלול למחוק iframe בדפדפן שבו `print()` לא חוסם. רוחב מודול 3 וגובה 90 נבחרו כדי שהפס הצר יעבור את סף סורקי הלייזר |
| 157 עד 220 | `BarcodePrintAllButton`, `BarcodePrintButton` ו `BarcodeLabel`, כפתורי HTML רגילים | |
| 222 עד 228 | `escapeHtml` של ארבעה תווים לכיתוב | הסרתו פותחת XSS בתוך iframe מאותו origin |

#### `apps/web/src/shared/barcode128.ts`
מקודד Code 128 קבוצה B בלי תלויות, שמחזיר SVG. הצרכן היחיד `Barcode.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 31 עד 58 | `PATTERNS` של 107 סמלים, `START_B` 104, `STOP` 106, עשרה מודולי שוליים, ו `BarcodeOptions` | אין בדיקה שמפענחת חזרה. ספרה שגויה בטבלה תייצר תוויות שנראות תקינות ולא נסרקות |
| 65 עד 93 | `encode` דוחה כל תו מחוץ ל ASCII 32 עד 126, ומחשב checksum מודולו 103. `runs` משטח לרוחבי פסים | דוגמה לבדיקה, `SN-1` נותן ערכים 51, 46, 13 ו 17 ו checksum של 45 |
| 102 עד 138 | `barcodeSvg` מצייר `rect` לכל פס, רקע לבן קבוע וכיתוב אופציונלי | הרקע הלבן מבטיח סריקה גם בערכה כהה |
| 141 עד 153 | `escapeXml`, ו `barcodeDataUrl` שאינו בשימוש | |

#### `apps/web/src/shared/CardPhoto.tsx`
תמונות קטלוג סטטיות מ `/images/<SERIAL>.png` או `.jpg` דרך `publicDir`, בלי API.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 39 | סדר סיומות png ואז jpg, `cardPhotoUrl` עם `encodeURIComponent`, ו `useCardPhotoSource` שמקדם ניסיון ב `onError` | `attempt` לא מתאפס כש `serialNumber` משתנה, ומופע ממוחזר מציג שאין תמונה. ב production `location /images/` מחזיר 404 אמיתי, ולכן `onError` נורה כמצופה |
| 45 עד 107 | `CardPhotoButton` עם סמל המצלמה 📷, ו `CardPhotoThumb` עם `loading="lazy"` | |
| 109 עד 163 | `CardPhotoModal`, lightbox עם Escape ב bubble ונעילת גלילה | לא במחסנית ה overlays. בתוך מגירת פריט Escape סוגר את כל המגירה, והגלילה עלולה להישאר נעולה |

**קטלוגי הדומיין, איך לחשוב עליהם.** רוב הקבצים הבאים בנויים משלוש לבנים. ממשקים שמעתיקים ביד את צורת תשובות השרת, כי ה SPA לא מייבא מ `apps/api`, ולכן שם שדה ששונה בשרת יהיה `undefined` בלי שגיאה. מילון מערך enum למפתח תרגום עם פונקציית `...Label` שנופלת לערך הגולמי. ומילון מערך enum ל `StatusTone`. המילונים מוקלדים `Record<string, ...>`, ולכן אף אחד לא בודק שכל ערכי השרת מכוסים. רק לקטלוג ההתראות יש בדיקה דו כיוונית מול השרת.

#### `apps/web/src/shared/money.ts`
פורמט אחיד לכסף ולתאריכים, והמרה של סכום מוקלד לסנטים. כל הכסף בדולר ועובר ברשת כמספר שלם של סנטים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 33 | `Intl.NumberFormat` אחד ל USD. `formatUsd` מחלק ב 100, `formatUsdSigned` עם סימן מינוס טיפוגרפי, `formatLedgerAmount` מוסיף סימן לפי `direction` | קוד המטבע שהשרת שולח מתעלמים ממנו בכוונה. מטבע שני יוצג עם סימן דולר. כל כיוון שאינו `credit` מוצג כמינוס |
| 40 עד 46 | `dollarsToCents` מנקה פסיקים, רווחים וסימן דולר, דוחה יותר משתי ספרות אחרי הנקודה, ומחזיר `Math.round(value * 100)`. אפס ושלילי מחזירים `null` | כל סכום שנשלח לשרת עובר כאן. בלי `Math.round` הערך `0.29` נשלח כ 28 סנט. אין תקרה עליונה, השרת אוכף |
| 49 עד 72 | `centsToDollars`, ו `formatDateTime` ו `formatDate` לפי `he-IL` או `en-US` ואזור הזמן של הדפדפן | תאריך יכול להיות שונה ביום ממה שמופיע במייל של השרת. ערך ריק מוצג כקו, ומחרוזת לא תקינה מוצגת כמו שהיא |

#### `apps/web/src/shared/names.ts`
עותק לקוח של כללי שם משתמש, שם אדם וסיסמה מ `apps/api/src/shared/names.ts`, כדי שטופס ידחה מראש מה שהשרת ידחה. שכבת חוויה, לא אבטחה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 28 | `USERNAME_PATTERN` עם אורך 3 עד 32, `NAME_PART_MAX` של 80, ו `PASSWORD_MIN` של 8 | הערכים זהים היום לשרת ול `@MinLength(8)` ב DTO |
| 30 עד 68 | `normalizeUsername`, `isValidUsername`, `normalizeNamePart` שמכווץ רווחים, ו `isValidNamePart` שדוחה ריק, ארוך מ 80, `<`, `>` ותווי בקרה | הלקוח עובר על code points בלולאה במקום regex, כדי שהמקור לא יכיל תווי בקרה |
| 76 עד 107 | `fullName` מחבר חלקים, ו `initialsFrom` גוזר עד שתי אותיות או `BA` | |

**שים לב.** ההערה טוענת ש `tests/web/names.test.ts` מכסה את שני העותקים. הבדיקה מייבאת רק את הלקוח, ושינוי בשרת בלבד לא יכשיל כלום.

#### `apps/web/src/shared/walletRequests.ts`
עותק הלקוח של כללי בקשות הארנק, הפקדה ידנית `cash_in` ומשיכה `cash_out` שמנהל מאשר. משקף לפי ערך את `apps/api/src/modules/pay/wallet-request.rules.ts`, כדי שטופס יסרב לפני שליחה. השרת הוא הסמכות. הצרכנים `WalletRequestForms.tsx`, `WalletPage.tsx` ו `WalletRequestsSection.tsx` של המנהל.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 37 | `WalletRequestType`, `WalletRequestStatus` ו `WALLET_REQUEST_STATUSES` בסדר תצוגה | מצב חדש דורש מיגרציה, `rules.ts`, שני ה unions כאן, הרשימות, ה tone, `reviewerActions` של המנהל ושני הקטלוגים, ושום בדיקה לא מזכירה זאת |
| 40 עד 54 | `OPEN_WALLET_REQUEST_STATUSES`, `isOpenRequest`, ו `canCancel` שמחזיר אמת ל `submitted` ול `pending_review` | `canCancel` הוא תוצאה מחושבת של טבלת המעברים בשרת ולא הטבלה. אם השרת ירחיב ביטול, הכפתור לא יופיע |
| 56 עד 65 | `WALLET_REQUEST_LIMITS` של 10 עד 20,000 דולר להפקדה ו 20 עד 20,000 למשיכה בסנטים, חמישה `FUNDING_SOURCES`, `MAX_NOTE_LENGTH` 500 ו `MAX_REFERENCE_LENGTH` 120 | המגבלה של 140 תווים על `destinationAccount` ו `beneficiaryName` מה DTO חסרה כאן |
| 68 עד 109 | `WalletRequest`, `WalletRequestEvent` ו `WalletRequestDetail` עם `history` | `amount` בסנטים למרות השם |
| 111 עד 122 | `statusLabel`, `typeLabel` ו `fundingSourceLabel` בונים מפתח בזמן ריצה עם `as MessageKey` | ערך חדש בשרת יוצג כמפתח גולמי |
| 129 עד 137 | `WALLET_REQUEST_TONE`, רק `completed` ירוק | רק שם כסף זז. `approved` הוא `gold` |
| 140 עד 214 | `DraftProblem` מחזיר מפתח תרגום. `validateDraft` מקביל ל `validateWalletRequestDraft` בשרת, ובודק סכום, תחום, יתרה במשיכה לפי `availableMinor`, מקור מימון, חשבון יעד של 4 תווים, מוטב של 2, ואורכי הערות | בדיקת היתרה בלקוח לפי יתרה מזמן הטעינה, והשרת בודק שוב גם בהשלמה. אורך ההערות נבדק לפני trim והטופס שולח אחרי trim. הערכים בהודעות מפורמטים ב `toFixed(2)` בלי סימן דולר, והתבנית בקטלוג מוסיפה אותו |
| 227 עד 249 | `findOpenDuplicate` מחפש בקשה פתוחה זהה בסוג, סכום, מטבע ואסמכתא ברשימה שכבר נטענה | נימוס בלבד. בשרת הבדיקה רצה מחוץ לטרנזקציה בלי אינדקס ייחודי, ושתי בקשות מקבילות זהות נכנסות שתיהן |
| 255 עד 272 | `matchesRequestSearch` על תשעה שדות, כולל סכום בשתי ספרות | |

**`validateDraft` מול השרת.** כל בדיקה כאן קיימת גם ב `validateWalletRequestDraft` בשורות 125 עד 194 של `rules.ts`, עם שלושה הבדלים מכוונים או כמעט מכוונים.

| בדיקה | לקוח | שרת |
|---|---|---|
| יתרה במשיכה | לפי `availableMinor` מזמן הטעינה, רק כשידוע | לא בכללים. נבדק ב `wallet-request.service.ts` בהגשה, ושוב בזמן `complete` |
| מטבע | אין, הטופס שולח `USD` קבוע | נבדק מול `SUPPORTED_CURRENCIES` |
| אורך הערות ואסמכתא | על הערך לפני trim | על מה שהגיע, אחרי שהטופס עשה trim. הערה של 501 תווים שהאחרון רווח נחסמת רק בלקוח |

**שים לב.** ההערה בשורה 10 טוענת ש `tests/web/wallet-requests.test.ts` שומר על ההתאמה, אבל הבדיקה לא מייבאת את קובץ השרת. טבלת המעברים קיימת בשלושה מקומות, בשרת, ב `canCancel` כאן וב `reviewerActions` ב `WalletRequestsSection.tsx`, ושני האחרונים הם קידוד ידני של הראשון.

#### `apps/web/src/shared/membership.ts`
צורות קטלוג המנויים, סדר טבלת ההשוואה, ופונקציה אחת עם לוגיקה, `tierAction`. הצרכן `MembershipPage.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 57 | `UNLIMITED` של מינוס אחת, `MembershipTier`, `TierCatalogue` ו `MyMembership` עם `perCycle`, `currentFeeMinor` ו `cycleLive` | השרת הוסיף את שני השדות האחרונים בדיוק בשביל החישוב כאן |
| 65 עד 83 | `COMPARISON_ROWS`, חמש עשרה שורות בסדר הצגה | שורה חדשה דורשת מקרה ב `allowanceCell` ומפתח `membership.row.*` |
| 91 עד 119 | `allowanceCell` מחזיר טקסט או `null` לשורה שלא כלולה, ואינסוף ל `UNLIMITED`. `usedFraction` לפס ההתקדמות | שם מפתח ששונה ב `perCycle` בשרת יציג שירות בתשלום כלא כלול. `toLocaleString` של מספר הפריטים לפי הדפדפן ולא לפי שפת האפליקציה |
| 138 עד 162 | `tierAction` מחזיר `join`, `keep`, `downgrade` או `upgrade`. הנמכה לפי סדר `tierOrder`. בשדרוג זיכוי `Math.floor(currentFeeMinor * left / cycle)` וחיוב `max(0, priceMinor - credit)` | אותה נוסחה כמו ב `membership.service.ts`, אבל עם `Date.now()` של הדפדפן ומחיר מהקטלוג שנטען. המשפט באישור יכול לסטות מהחיוב. השרת לא מקבל סכום מהלקוח, לכן פער תצוגה בלבד |

#### `apps/web/src/shared/servicePrices.ts`
מביא את מחיר השירות אל הכפתור שמפעיל אותו במגירת הפריט ב `VaultPage.tsx`, מרשימת המחירים הציבורית `GET /pricing/list`. הלקוח מציג כלל ולא מחשב מחיר.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 35 | `PriceEntry` עם `model` של `fixed` או `percentage`, ו `value` בסנטים או ב basis points | |
| 37 עד 57 | `cached` לכל הטאב. `load` בונה `Map` לפי `actionType`, ובכישלון מאפס cache ומחזיר מפה ריקה | השרת מחזיר כלל לכל זוג פעולה וסוג פריט, והרשומה האחרונה דורסת. כלל שירות לסוג פריט יציג מחיר לא נכון לכל הפריטים |
| 60 עד 72 | `useServicePrices`, טעינה אחת עם דגל `live` | מחיר שעוד לא הגיע ומחיר שלא קיים נראים אותו דבר, בכוונה |
| 81 עד 85 | `priceLabel` מציג אחוז כאחוז, ושירות בחינם בלי מחיר | |
| 95 עד 104 | `SERVICE_FEE_ACTION` ממפה מפתח פעולה במגירה לכלל שהשרת יחייב | שמות הפעולות כאן שונים משמות ה enum ב `serviceLabels.ts`. `feeActionType` חדש בשרת בלי עדכון כאן יציג מחיר `service` |

**שים לב.** הסכום על הכפתור הוא הערכה. השרת לא מחייב מנוי שיש לו מכסה, ונופל לכלל `service` כשאין כלל ספציפי, ואז הכפתור לא מציג מחיר בכלל.

**המיפוי היום.** `photography`, `donation`, `buyout`, `consignment` ו `lot-split` מחויבים לפי `service`. `video` לפי `service_fee:video_review`, `inspection` לפי `service_fee:condition_inspection`, ו `deslab` לפי `service_fee:deslab`. דירוג חסר בכוונה, כי המחיר תלוי בדרגה שנבחרת בטופס שלו. כל שמונה השורות תואמות היום למה שהשירותים בשרת מעבירים ל `requests.create`.

#### `apps/web/src/shared/notifications.ts`
הצד של ה SPA במערכת ההתראות. גוף ההתראה נכתב בשרת באנגלית על ידי ה worker בשדה `message`, וה SPA מתרגם רק את סוג האירוע. נבדק דו כיוונית ב `tests/web/notification-catalogue.test.ts`, התבנית שחסרה בשאר הקטלוגים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 4 עד 59 | `EVENT_LABEL_KEY`, 42 סוגי אירועים למפתחות תרגום, ו `EVENT_TYPES` | אירוע חדש בשרת בלי שורה כאן ומפתח ב `i18n.tsx` מכשיל את הבדיקה. המספרים בהערה מיושנים. `NotificationsPage.tsx` משתמש ב `EVENT_TYPES` כדי להחליט בין תווית מתורגמת לתווית האנגלית מהשרת |
| 68 עד 82 | `channelLabel` לשני ערוצים, ו `eventLabel` | יש `channelLabel` נוסף ב `market.ts` במשמעות אחרת, ו import אוטומטי עלול לבחור את הלא נכון |
| 91 עד 115 | `renderContent` מחזיר מחרוזת. `message` אם קיים, אחרת זוגות שם וערך תוך דילוג על שדות מזהים כמו `recipientIds` | הסתרת המזהים היא רק על המסך, הם מגיעים ברשת. שינוי שם `message` ב worker יציג סנטים גולמיים |

**הזרימה.** שירותים בשרת כותבים אירוע ל `outbox_message`. ה worker מחשב משפט באנגלית ב `notification-message.ts` ושומר ב `content` את ה payload יחד עם `message`. ה SPA מציג את המשפט ומתרגם רק את הכותרת, ולכן משתמש עברי רואה כותרת בעברית וגוף באנגלית.

#### `apps/web/src/shared/parcels.ts`
אוצר המילים של חבילות נכנסות. מצבים, גוונים, מצבי תקינות, צורות תשובה ושלוש פונקציות עזר. משרת את `InboundPage.tsx` ואת מסכי המחסן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 44 | `ParcelStatus` של שישה מצבים, `PARCEL_TONE` שבו `unclaimed` הוא `error`, ו `parcelStatusLabel` שנופל לערך עם רווחים | ה union לא בשימוש, `ParcelSummary.status` מוקלד `string` |
| 46 עד 62 | תוויות תקינות, ו `PARCEL_CONDITIONS` שהמפעיל בוחר ממנו | עותק ערכים ולא רק תוויות. ערך שנוסף רק בלקוח יחזיר 400. בשרת הרשימה קיימת בשלושה מקומות, enum במסד, `@IsIn` ב DTO וטיפוס בשירות |
| 65 עד 124 | `ParcelSummary`, `ParcelQueueRow` עם `itemCount`, `InboundAddress` עם `salesTaxBps`, ו `ParcelWorkflow` | |
| 133 עד 140 | `addressLines` מחזיר מערך שורות, כך שההעתקה זהה לתצוגה | |
| 143 עד 154 | `taxRateLabel` מחלק ב 100, ו `estimatedTaxMinor` מחשב `amountMinor * bps / 10000`, להדרכה בלבד | ה seed שומר 6625 עבור 6.625 אחוז. התווית מציגה 66.25 אחוז והחיסכון גדול פי עשרה. ההערה מעל הפונקציה שגויה |

#### `apps/web/src/shared/carriers.ts`
אוצר המילים של משלוחים יוצאים. הקטלוג עצמו, שירותים, תוספות וקופסאות, לא משוכפל ונטען מ `GET /shipping/services`. כאן רק צורות ותוויות. הצרכנים `ShipmentComposer.tsx`, `SharedParcelsTab.tsx` ו `WarehouseConsole.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 107 | `CarrierServiceInfo`, `AddOnInfo`, `BoxInfo`, `ServiceCatalogue`, `RateProblem`, `QuotedRate` ו `Quote`. כל הסכומים בסנטים | `QuotedRate.totalMinor` כבר נטו אחרי כיסוי מנוי, מחושב בשרת. שינוי שם שדה בשרת ישבור את `ShipmentComposer.tsx` בשקט |
| 109 עד 130 | `SERVICE_KEY` לשבעה שירותים, ו `serviceLabel` שמקבל `key` או `serviceKey` ונופל ל carrier ורמת שירות | שתי הצורות, קטלוג והצעה, קוראות לאותו שדה בשמות שונים |
| 132 עד 150 | `BOX_KEY` לחמש קופסאות, `boxLabel` שנופל לתווית השרת, ו `formatBoxDimensions` בסנטימטרים | |
| 152 עד 173 | `RULE_KEY` לשמונה חוקי דחייה, ו `ruleLabel` שמזריק `limit` מפורמט מהשרת | `box_weight`, `box_contents` ו `dimensions` חסרים, ומוצגים בטקסט האנגלי של השרת גם בעברית |
| 175 עד 179 | `formatWeight`, גרמים מתחת לקילוגרם, אחרת קילוגרמים | |

#### `apps/web/src/shared/countries.ts`
רשימת המדינות שכתובת יכולה לציין, מהשרת. נוצר אחרי באג שבו טופס הכתובת מילא Israel כטקסט, בזמן שכל כללי השילוח קוראים קוד ISO, וכל כתובת נדחתה כבינלאומית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 24 | `ShippingCountry` עם קוד, שם ו `domestic`, ו `cached`, promise ברמת המודול | cache אמיתי לכל חיי הטאב, בניגוד ל `session.ts`. שינוי בשרת נראה רק אחרי רענון |
| 26 עד 44 | `useShippingCountries`. `??=` שולח בקשה רק פעם אחת, בכישלון מאפס את `cached` ומחזיר מערך ריק, ודגל `live` מונע setState אחרי unmount | בלי מצב טעינה ובלי שגיאה, כישלון נראה כרשימה ריקה. הסרת האיפוס תנעל כישלון רגעי לכל ה session |
| 54 עד 56 | `countryName` מחפש שם לפי קוד ונופל לקוד | שורות ישנות עדיין מחזיקות שם מדינה ולא קוד |

#### `apps/web/src/shared/escrow.ts`
אוצר המילים של עסקאות נאמנות ושל שיטות מסירה שאינן חברת שילוח. התנאים המספריים נטענים מ `GET /escrow/terms` ומ `GET /shipping/white-glove/terms`. הצרכנים `EscrowTab.tsx` ו `HumanFulfilmentPanels.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 14 עד 53 | `EscrowDeal` עם שני הצדדים, סכום ועמלה בסנטים, מצב וחותמות שחרור, ו `EscrowEvent` | `inspectionMatches` הוא `'yes'` או `'no'` כמחרוזת. העמלה מגיעה ב `feeMinor` ולא מחושבת כאן |
| 55 עד 87 | `ESCROW_TONE` לשמונה מצבים, `inspecting` ו `awaiting_release` כאזהרה, ו `escrowStatusLabel` | מצב חדש בשרת יוצג גולמי ובלי tone |
| 95 עד 112 | `nextStep` מנסח את הצעד הבא מנקודת המבט של הצופה, לפי `buyerReleasedAt` ו `sellerReleasedAt` | משכפל את מכונת המצבים של `escrow.service.ts` לטקסט בלבד. שינוי תנאי מעבר בשרת יטעה את המשתמש בלי לשנות החלטה |
| 118 עד 154 | `FULFILMENT_METHODS` כ `as const` עם תוויות, `PickupShow` ו `WhiteGloveTerms` | `remaining` הוא `null` כשאין מגבלה |

#### `apps/web/src/shared/grading.ts`
תוויות לדירוג ולבדיקת מצב של פריט במדף. הדרגות ואזורי הבדיקה נטענים מ `/services/grading/tiers` ומ `/services/inspection/areas`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 15 עד 60 | `GradingTier` עם `feeMinor` שהשרת פותר מכללי התמחור, וחמש דרגות וחמישה אזורים עם תוויות | `feeMinor` של `null` פירושו שאין כלל, והטופס אומר זאת במקום להציג עמלה כללית |
| 62 עד 75 | `INSPECTION_SEVERITIES` של שלוש רמות, ו `severityLabel` | עותק ערכים ש `ServiceQueue.tsx` בונה ממנו בורר. ערך שנוסף רק כאן יחזיר 400 |
| 77 עד 93 | `SUBMISSION_TONE` ותוויות לשלושה מצבי שליחה | |

#### `apps/web/src/shared/itemClasses.ts`
מראה של טקסונומיית הפריטים מ `apps/api/src/modules/inv/item-classes.ts`, כדי שהמפעיל יבחר מרשימה. השרת הוא האוכף, וסוג לא מוכר נדחה בקליטה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 18 עד 48 | `ItemClassOption` עם `oversized`, `lotEligible` ו `lotMinSize`, `LOT_MIN_SIZE` של 6, ושנים עשר סוגים ב `ITEM_CLASSES` | העותק הרחב ביותר של כלל שרת באזור, ואין בדיקה שמשווה. שינוי בשרת בלבד יציג פקדי lot או אזהרות שגויים |
| 50 עד 64 | מפה לחיפוש, `itemClassOption` ו `itemClassLabel` שנופל למפתח הגולמי | פריטים היסטוריים מחזיקים טקסט חופשי מלפני הטקסונומיה |
| 70 עד 113 | קטגוריות סילוק ותוצאות סילוק עם תוויות, ו `ArrivalDisposal` | דגל `prohibited` של השרת לא הועתק |

#### `apps/web/src/shared/market.ts`
אוצר המילים של צד המוכר בשוק, מודעות, הצעות, החלפות וערוצי consignment. הצרכנים `SellerPanels.tsx` ו `ConsignmentForm.tsx`. נקי מלוגיקה עסקית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 66 | tone ותווית לשלושה מצבי מודעה, ארבעה של הצעה וארבעה של החלפה, תואמים ל enums ב `mkt.schema.ts` | |
| 68 עד 135 | `MyListing` עם `askingPrice` בסנטים, `MyOffer` עם `yourTurn`, ו `MySwap` עם `awaitingMe` | התור מחושב בשרת אחרי באג שבו הלקוח קבע כפתורים לפי `direction` וקונה שקיבל הצעה נגדית לא יכול היה להגיב |
| 141 עד 171 | `ConsignmentChannel` עם `minAskingMinor` ו `gradedOnly`, אירוע, ו `channelLabel` | שם זהה ל `channelLabel` ב `notifications.ts` |

#### `apps/web/src/shared/shipments.ts`
צורת משלוח יוצא, tone ותווית למצב, וכלל החיפוש ברשימת המשלוחים. נבדק ב `tests/web/shipment-tracking.test.ts`, וההערה מפנה לקובץ בדיקה שלא קיים.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 13 עד 66 | `ShipmentSummary`. `id` הוא UUID שלעולם לא מוצג, `code` הוא המזהה המוצג, סכומי ביטוח ומכס בסנטים, ו `paymentDueAt` שה worker אוכף | `status` מוקלד `string` |
| 69 עד 85 | `SHIPMENT_TONE` לאחד עשר המצבים של `shp.schema.ts`, ו `shipmentStatusLabel` שבונה `ss.shipmentStatus.${status}` | מצב חדש יוצג כמפתח הגולמי. רשימת המצבים בבדיקה כתובה ביד וחסרים בה שניים |
| 98 עד 114 | `matchesShipmentSearch` מחבר שמונה שדות, כולל עשרת התווים הראשונים של `createdAt`, ומחפש `includes` | חיפוש לפי תאריך הוא UTC, בזמן ש `formatDate` מציג תאריך מקומי |
| 117 עד 128 | `PREPARING_STATUSES` ו `isInTransit` | בלי צרכנים, קוד מת ועוד עותק של מכונת המצבים |

#### `apps/web/src/shared/signIns.ts`
מתרגם את יומן הכניסות לשפה של מנהל. השרת שומר את מה שהגיע, IP ו `User-Agent` גולמי, והפענוח רק בתצוגה. הצרכן `SignInsSection.tsx`, ונבדק ב `tests/web/sign-ins.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 14 עד 34 | `SignInOutcome` של ארבעה ערכים, `SignInAttempt` ו `SignInLog` עם רשימת `suspicious` שהשרת מחשב | תוצאה חמישית בשרת תציג תג ריק |
| 43 עד 52 | `displayIp` מסיר `::ffff:`, ו `isLocalAddress` מזהה כניסה מהמכונה עצמה | הכתובת תלויה ב `TRUST_PROXY`, ראה E14. השרת סופר כתובות על הערך הגולמי, עם ובלי הקידומת |
| 63 עד 91 | `describeDevice` מזהה דפדפן לפי סדר `Edg/`, `OPR/`, `Firefox/`, `Chrome/` ו Safari, ומערכת לפי סדר iOS לפני macOS ו Android לפני Linux. אחרת 40 תווים ראשונים | הסדר הוא הלוגיקה, כי כל דפדפן מתחזה לקודמיו. המחרוזת בשליטת התוקף ומוצגת כטקסט |

#### `apps/web/src/shared/support.ts`
תוויות, גוונים וטיפוסים לפניות תמיכה. הרעיון המרכזי, סטטוס עונה של מי התור, ולכן אותו סטטוס מנוסח אחרת ללקוח ולצוות. הצרכנים `SupportPage.tsx` ו `SupportQueue.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 31 | `TicketStatus` ו `TICKET_TONE`. `open` הוא `info`, `awaiting_customer` אזהרה, `resolved` הצלחה | ה union לא בשימוש, המפות `Record<string, ...>`. שינוי צבע משפיע גם על תור הצוות |
| 33 עד 56 | `STATUS_KEY` ללקוח, `STAFF_STATUS_KEY` לצוות, ו `ticketStatusLabel` עם דגל `staff` | |
| 58 עד 73 | `TICKET_CATEGORIES`, שבע קטגוריות בסדר זהה לשרת, ו `ticketCategoryLabel` | קטגוריה שנוספה רק בשרת לא תופיע בטופס. שנוספה רק כאן תחזיר 400 |
| 75 עד 105 | `SupportTicket`, `SupportQueueRow` עם סטטוס החשבון של הלקוח, `SupportMessage` ו `SupportThread` | כתובים ביד, ושינוי ב `support.service.ts` לא ייתפס ב typecheck |

#### קבצים קטנים ב `shared`

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/shared/useVaultItems.ts` | טוען `GET /vault/items` ומסנן ל `stored` בצד הלקוח, כדי שטפסי שוק ומשלוח יבחרו פריט ולא יקלידו UUID שגורם ל 500. אין לו מצב `loading`, ורשימה ריקה נראית כמו טעינה |
| `apps/web/src/shared/serviceLabels.ts` | שני מילונים לסוג ולמצב של בקשת שירות, משותפים ללקוח ולמפעיל. המפתחות הם שמות ה enum ב `dis.schema.ts`, שונים ממפתחות הפעולה ב `servicePrices.ts`, ואין בדיקת שלמות |

**מה משותף למסכי הלקוח.** כולם דפוס P8, וחוזרים בהם חמישה פערים שכדאי להכיר פעם אחת. ההודעה שמוצגת בשגיאה היא `(e as Error).message`, כלומר אנגלית של השרת או של הדפדפן, ורק `ProfilePage.tsx` מתרגם דרך `apiErrorKey`. כישלון טעינה מציב לרוב מערך ריק, והמסך מציג מצב ריק כאילו אין נתונים. הודעת `status` אחרי פעולה לא מתאפסת לעולם. `ErrorState` אחד לדף קורא בכפתור הניסיון החוזר לטוען קבוע, ולא למה שנכשל. ו `onClose` שמועבר inline ל `DetailDrawer` מקפיץ פוקוס בכל רינדור של ההורה. אף אחד מהם לא כספי, כי השרת לא מקבל מהלקוח סכום, מחיר או זכאות, אבל כל אחד מטעה משתמש.

#### `apps/web/src/areas/customer/marketing/LandingPage.tsx`
דף הנחיתה הציבורי ב `#/` וב `#/welcome`, דפוס P8. מסביר את המוצר, מציג מחירים מהשרת ומוביל להרשמה או לכניסה. `App.tsx` מציג אותו גם לפני שבדיקת ה session הסתיימה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 47 עד 55 | `FEATURED`, חמש פעולות לטבלת המחירים, קליטה, אחסון, משלוח, עמלת שוק ועמלת משיכה | |
| 57 עד 89 | `PriceEntry`, `PriceList`, `priceOf` שמפריד בין כלל קבוע לאחוזי, ו `param` ששולף מספר מ `parameters` | בלי ההפרדה חמישה אחוז היו מוצגים כחמישה דולר |
| 91 עד 128 | effect אחד עם דגל `live` טוען `GET /pricing/list`, שמסומן `@Public()`. כלל עם `itemClass` נזרק חוץ מקליטה של `trading_card`. בכישלון `pricesFailed` ומשפט שהמחירים לא זמינים | אין מספר ממלא מקום. שינוי שם `groups` בתשובה יפיל לטבלה ריקה בלי שגיאה |
| 130 עד 151 | `storageTerms` משלושה פרמטרים של כלל האחסון, ולא מ `value` | פרמטר חסר מעלים את המשפט |
| 153 עד 364 | כותרת עם `LanguageSwitcher`, במה עם `LANDING_SERIAL` מ `AuthPage.tsx`, הבטחות, טבלת מחירים, שלבים ו footer. כל סעיף עם `aria-labelledby` | שורת `cash_out_fee` מציגה 1 אחוז מכלל ה seed, והעמלה בפועל ב `money-terms.ts` מדורגת, 6 אחוז עם מינימום 0.99 עד 100 דולר, ומעל זה 5 דולר ועוד אחוז. בדיוק הכשל שההערה בראש הקובץ מבטיחה למנוע. תיקון דורש לוח עמלות ציבורי, כי `cash-out-quote` דורש התחברות |

#### `apps/web/src/areas/customer/auth/AuthPage.tsx`
`AuthShell`, המסגרת של כל דף שמקבל סיסמה, ו `AuthPage`, מתג בין כניסה, הרשמה ושכחתי סיסמה. מגדיר גם את `SessionUser`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 28 | `SessionUser` דורש רק `id` ו `role`, כי זה כל מה ש `POST /auth/login` מחזיר | שדה חובה נוסף ישבור את `SignInPage.tsx` ואת `App.tsx` |
| 30 עד 41 | `LANDING_SERIAL` ו `LANDING_TITLE`, פריט seed שהתמונה שלו היא שם הקובץ ב `assets` | גם דף הנחיתה משתמש בהם |
| 43 עד 153 | `AuthShell` עם במה של קלף, `dl` של מצב ומיקום מתורגמים וקבועים, ו `auth-box` עם `LanguageSwitcher`. עם `bare` הבמה נעלמת | המצב והמיקום הם תצוגה שיווקית, לא רשומת משמורת. `data-density="marketing"` מחליף את משתני הצפיפות בתת העץ |
| 155 עד 192 | `AuthMode` ו `AuthPage`. `mode` מאותחל מ `initialMode` פעם אחת, וכל טופס מקבל callbacks שמחליפים אותו | המעבר לא כותב ל hash. הכתובת יכולה לומר `#/signin` כשמוצגת הרשמה, ו Back יוצא מהמסך. ערכי `AuthMode` קשורים ל `AUTH_ROUTES` ב `App.tsx` |

#### `apps/web/src/areas/customer/auth/SignInPage.tsx`
טופס הכניסה, דפוס P8. שדה אחד לאימייל או לשם משתמש, סיסמה, ומסלול חילוץ למי שהאימייל שלו לא אומת.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 24 עד 51 | state. `identifier` ו `password` ממולאים ב `red@bault.dev` ובסיסמת ה seed רק תחת `import.meta.env.DEV`, ועוד `error`, `busy`, `unverified` ו `resent` | ב production Vite מחליף את הדגל ב `false` והמחרוזות נופלות מהבאנדל, בתנאי שהבנייה באמת production, ראה `vite.config.ts` |
| 53 עד 68 | `login` שולח `POST /auth/login`, ובהצלחה `onSignedIn` עם `id` ו `role`. קוד `email_unverified` מדליק את `unverified` | השרת מחזיר את הקוד רק אחרי אימות הסיסמה, ולכן אין דליפת קיום חשבון. ההודעה היא `err.message` באנגלית, ו `apiErrorKey` לא בשימוש |
| 70 עד 86 | `resendVerification` שולח `{ email: identifier.trim() }` | מי שנכנס עם שם משתמש מקבל 400 של `@IsEmail` ולא מייל. ההערה טוענת אחרת |
| 88 עד 157 | `form` עם `onSubmit`, `Field` עם `htmlFor` ו `aria-describedby` ידני לרמז, `autoComplete` נכון, `Button` עם `loading`, ושורת `DEMO_USERS` בשורה 154 רק בפיתוח | `loading` משבית גם שליחה ב Enter. שינוי הקוד `email_unverified` בשרת יעלים את כפתור השליחה החוזרת בשקט |

**שים לב.** שדה אחד לאימייל או לשם משתמש נוח, והשרת מחפש בשניהם אחרי נרמול. המחיר הוא שכל פעולה שצריכה כתובת אימייל, כמו שליחה חוזרת, לא יכולה להניח שהשדה הוא אימייל.

#### `apps/web/src/areas/customer/auth/SignUpPage.tsx`
טופס ההרשמה, דפוס P8. ההרשמה לא פותחת session. השרת יוצר חשבון `pending` ושולח קישור, והדף נגמר בפאנל של בדוק את הדואר.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 35 עד 77 | חמישה שדות ונגזרות. שם משתמש ושמות דרך `names.ts` על ערך מנורמל, regex רופף לאימייל, ו `PASSWORD_MIN`. דגלי שגיאה רק לשדה לא ריק | `a@b.c` מדליק את הכפתור ונדחה בשרת ב `@IsEmail`. אין מגבלה עליונה לסיסמה בשני הצדדים |
| 79 עד 102 | `register` שולח ערכים מנורמלים ל `POST /auth/register`, ובהצלחה שם משפט עם שם המשתמש ב `registered` | `busy` נוסף אחרי באג של שליחה כפולה. השרת מחזיר `pending_verification` ולא פותח session |
| 104 עד 123 | `resendVerification` לאימייל שהוקלד | כאן זה תמיד אימייל אמיתי |
| 125 עד 147 | פאנל הצלחה עם `SuccessNote`, שליחה חוזרת וכפתור לכניסה | |
| 149 עד 264 | הטופס. כל שדה ב `Field` עם `htmlFor`, `error` ו `aria-invalid`, ו `maxLength` לחלקי השם. הכפתור מושבת עד שחמשת התנאים מתקיימים | בגלל `htmlFor` הרמזים לא מוצמדים לשדות, בניגוד להערה. אין הסכמה לתנאי שימוש, ראה E21. שם המשתמש נקלט רק כאן ואין דרך לשנות אותו אחר כך |

#### `apps/web/src/areas/customer/auth/VerifyEmailPage.tsx`
הדף שקישור האימות פותח, `#/verify-email?token=...`, ו `App.tsx` מרנדר אותו לפני כל בדיקת session.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 29 | union של `working`, `verified` ו `failed`. בלי טוקן מתחילים ב `failed` | |
| 31 עד 41 | effect שולח `POST /auth/verify-email` בטעינה | אין דגל ביטול. ב `StrictMode` יוצאות שתי בקשות, והשרת לא מעדכן באופן אטומי, כך שבפיתוח אפשר לראות כישלון אחרי אימות שהצליח. תיקון מלא, עדכון אטומי בשרת עם `WHERE consumed_at IS NULL` ודגל `live` בלקוח |
| 43 עד 45 | `goToSignIn` מנווט עם `replace` ל `section: ''` | זה דף הנחיתה ולא טופס הכניסה. `signin` היה מביא ישר לטופס |
| 47 עד 81 | שלושה מצבי רינדור, ובכישלון הודעת השרת, `ResendForm` וקישור | |
| 83 עד 128 | `ResendForm` עם תשובה אחידה לכל כתובת | אין `form`, ולכן Enter לא שולח |

**שים לב.** הטוקן ב hash, כך שסורק דואר שלא מריץ JavaScript לא יצרוך אותו, והטוקן לא נשלח לשרת בבקשת הדף.

#### `apps/web/src/areas/customer/auth/ForgotPasswordPage.tsx`
השלב הראשון של שחזור סיסמה, דפוס P8. אותו אישור לכל כתובת, כדי לא לשמש אורקל לגילוי חשבונות.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 19 עד 40 | `email`, `sent`, `error` ו `busy`. `submit` שולח `POST /auth/password/reset-request` עם `email.trim()` ומדליק `sent` | השרת מחזיר 202 גם לכתובת לא מוכרת. כישלון מגיע רק מרשת, מולידציה או מהגבלת קצב של 5 בדקה |
| 42 עד 53 | מצב הצלחה עם הכתובת בתוך משפט מתורגם, שמנוסח כמה יקרה אם הכתובת רשומה | הצגת הודעה שונה לפי תשובת השרת תפתח גילוי חשבונות. שינוי כזה שייך ל `verification.service.ts` |
| 55 עד 85 | `form` עם `autoFocus`, `autoComplete="email"`, וכפתור `disabled={busy \|\| !email.trim()}` | בלי `loading`, ולכן בלי spinner. אין בדיקת פורמט, ושגיאת `@IsEmail` מוצגת באנגלית |

#### `apps/web/src/areas/customer/auth/ResetPasswordPage.tsx`
הדף שקישור האיפוס פותח, `#/reset-password?token=...`, בתוך `AuthShell bare`. אוסף סיסמה חדשה ואישור.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 35 | `password`, `confirm`, `done`, `error`, `busy`. `tooShort` לפי `PASSWORD_MIN` ו `mismatch` רק לשדה לא ריק. `goToSignIn` מנווט ל `section: ''` | `ready` בשורה 31 בודק `>= 8` כמספר קשיח, ושינוי `PASSWORD_MIN` לא ישפיע עליו. `goToSignIn` מוביל לדף הנחיתה |
| 37 עד 50 | `submit` עם שומר כפול, `POST /auth/password/reset` עם `token` ו `newPassword`, ו `done` | הטוקן עובר ישר מה URL ולא נשמר ב state, אבל נשאר ב history. אחרי כישלון הוא עדיין תקף עד שעה |
| 52 עד 124 | בלי טוקן שגיאה מתורגמת, אחרי הצלחה הודעה, ואחרת שני `Field` בלי `htmlFor` | הטופס היחיד בתיקייה שמקבל את הצמדת הרמז והשגיאה האוטומטית של `Field` |

#### קבצים פשוטים ב `areas/customer/auth`

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/customer/auth/demoUsers.ts` | מחרוזת חשבונות ה seed והסיסמה המשותפת, מחוץ לקטלוג התרגום כדי שתיפול מהבאנדל. מיובא רק תחת `import.meta.env.DEV`, ו import מכל מקום אחר יכניס אותו לבאנדל |

#### `apps/web/src/areas/customer/finance/WalletPage.tsx`
מסך הארנק, דפוס P8. בראשו היתרה, שהשרת גוזר מסכום רשומות ה ledger, ומתחתיה חמישה טאבים, סקירה, תנועות, הפקדה, משיכה ובקשות. אין בדף שום פקד שמזיז כסף ישירות. הפקדה מיידית עוברת דרך ספק תשלום ב `TopUpPanel`, וכל השאר הן בקשות שמנהל מאשר. מה שונה מ P8, טאב, תנועה פתוחה ובקשה פתוחה חיים ב hash, והמסננים לא.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 53 עד 78 | `Money` בסנטים, `LedgerRow` עם `amount` חיובי ו `direction` של `credit` או `debit`, ו `PendingTotals` של בקשות פתוחות | בקשות פתוחות לא נכנסות ליתרה, כי שום כסף לא זז |
| 80 עד 89 | `TABS` כ tuple ו `WalletTab` נגזר | ההערה מפנה ל `LEGACY_WALLET_TABS`, שלא קיים. הנכון `LEGACY_TABS.wallet` ב `routing.ts`. שינוי שם טאב שובר קישורים ומפתחות `wallet.tab.*` |
| 91 עד 130 | `TYPE_META` ו `REF_LABEL` לתוויות ואייקונים, נפילה לערך עם רווחים, ו `RANGES` של הכל, 7, 30 ו 90 ימים | `escrow_hold`, `escrow_release`, `escrow_refund` ו `chargeback` חסרים, ומוצגים באנגלית בממשק עברי |
| 140 עד 158 | state של `balance`, `ledger`, `requests`, `pending`, `error` ו `status`, כש `null` מסמן טעינה. `typeFilter` ו `rangeFilter` ברמת הדף | המסננים לא ב URL, ורענון מאפס אותם |
| 160 עד 182 | `load` עם ארבע בקשות במקביל, `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet/pending` ו `/finance/wallet-requests`. בכישלון `ledger` ו `requests` מקבלים מערך ריק | כישלון של אחת מארבע מציג טבלה ריקה כאילו אין תנועות, ושלד במקום היתרה |
| 184 עד 238 | `selected` לפי `route.params.transaction`, היתרה ב `dir="ltr"`, `SuccessNote` ו `ErrorState`, ו `ContextTabs` עם כפתורי הפקדה ומשיכה | `status` נקבע רק על ידי `TopUpPanel` ולא מתאפס, והודעת התשלום נשארת בכל הטאבים |
| 240 עד 316 | גוף הטאבים. בהפקדה `TopUpPanel` ואחריו `WalletRequestForm` של `cash_in`, במשיכה רק `cash_out`. שניהם מקבלים `availableMinor={balance?.amount ?? 0}`, ו `onSubmitted` טוען ועובר לטאב הבקשות | לפני שהיתרה נטענה טופס המשיכה חושב שהיא אפס ומסמן כל סכום כחריגה |
| 318 עד 338 | `TransactionDrawer` כש `selected` נמצא, ו `RequestDrawer` לכל `route.params.request`, עם `onChanged={load}` | `onClose` inline מפעיל את בעיית הפוקוס של `DetailDrawer` |
| 341 עד 446 | `OverviewTab`. `flows` מסכם כניסות, יציאות ונטו בסנטים שלמים, ארבעה `MetricCard`, שורת בקשות פתוחות, וטבלה של שש האחרונות | |
| 448 עד 547 | `TransactionsTab`. מסנן סוג מתוך הסוגים שקיימים בפועל, וטווח של `Date.now() - days * 86_400_000` | ימים מתגלגלים ולא קלנדריים |
| 549 עד 683 | `TransactionTable`. `balanceAfter` בשורות 578 עד 588 הולך מהשורה הישנה לחדשה ומצבר זיכויים וחיובים. שורה עם `tabIndex={0}` ו Enter פותחת רשומה | באג. `rows` הם שש האחרונות בסקירה או הרשימה המסוננת, לא ה ledger המלא, ולכן העמודה מתחילה מאפס. לקוח עם יותר משש תנועות רואה יתרה שלא תואמת לראש הדף, וסינון לפי סוג נותן מספרים שליליים. תיקון, לחשב פעם אחת על ה ledger המלא ולהעביר לפי `row.id`. לשורה אין `role="button"`. השרת ממיין `occurredAt desc`, ולשתי שורות עם אותו זמן הסדר לא מוגדר |
| 685 עד 777 | `TransactionDrawer` מציג את השורה, ו `downloadReceipt` בונה קובץ טקסט ב Blob ומבטל את ה URL מיד אחרי `click()` | |
| 779 עד 895 | `RequestsTab` עם חיפוש מקומי ב `matchesRequestSearch` וטבלה באותה תבנית | הסכומים הם מה שהתבקש, ורק לבקשה `completed` יש רשומת ledger מאחוריה |
| 897 עד 1070 | `RequestDrawer`. `load` לפי `requestId`, `cancel` שולח `POST /finance/wallet-requests/:id/cancel` דרך `ConfirmationModal` עם `busy`, ואז טוען ומחכה ל `onChanged`. כפתור הביטול רק כש `canCancel`, והיסטוריה כ `ul.timeline` | `detail` לא מתאפס בהחלפת בקשה ואין דגל ביטול, ותשובה ישנה יכולה להישאר. ביטול שנכשל מציג הודעה מאחורי חלון האישור הפתוח |
| 1072 עד 1074 | הערה על רכיב שהוסר | |

**מה מזיז כסף מהמסך הזה.** רק שני דברים. תשלום מיידי ב `TopUpPanel`, שאחריו השרת מזכה את הארנק לפי מה שהספק דיווח שנסלק. והשלמה של בקשה על ידי מנהל במסך הניהול, שיוצרת רשומת ledger. הגשת בקשה, ביטול בקשה וכל חישוב בדף הם תצוגה או תור, והיתרה בראש הדף היא תמיד מה שהשרת גזר.

**שים לב.** הוספת limit ל `GET /finance/ledger` תשבור את `flows`, את מסנן הסוגים ואת עמודת היתרה. כל שינוי כזה מחייב להעביר את החישובים לשרת.

#### `apps/web/src/areas/customer/finance/MoneyPanels.tsx`
שני רכיבים שמחברים את הארנק לכסף אמיתי. `TopUpPanel` מציג מסלולי הפקדה ומבצע תשלום מיידי, ו `CashOutQuotePanel` מציג את עמלת המשיכה ואת הנטו. זה האתר של E3.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 8 עד 45 | `BankInstructions`, `FundingRoute` עם `instant`, `feeBps`, `available` ו `instructions`, ו `RouteCatalogue` עם `limits` | `label` ו `description` מהשרת לא בשימוש, הדף מתרגם לפי `key` |
| 46 עד 69 | `TopUpPanel`, state של `catalogue`, `route` עם ברירת מחדל `card`, `amount` ו `busy`. effect טוען `GET /finance/funding-routes` עם תלות `[onError]` | `WalletPage` מעביר `setError` יציב. פונקציית חץ תיצור לולאת טעינות. כישלון משאיר את הפאנל במצב טעינה לתמיד |
| 71 עד 77 | `cents` מ `dollarsToCents`, ו `withinLimits` מול `catalogue.limits` | |
| 79 עד 106 | `pay` שולח `POST /finance/checkout` עם `amountMinor`, `route` ו `idempotencyKey` שנבנה מ `Date.now()` ומחרוזת אקראית. בהצלחה `onStatus`, ניקוי ו `onChanged` | אין `paymentMethodToken` ואין בריפו קוד שיוצר הזמנת PayPal, ולכן ב production המסלול המיידי נכשל תמיד עם 500, ראה E3. המפתח מתחדש בכל לחיצה, ותשובה שאבדה ולחיצה חוזרת יוצרות תשלום שני. המפתח צריך להיווצר פעם אחת לכל טיוטה ב `useRef` ולהתאפס רק אחרי הצלחה או שינוי סכום |
| 108 עד 192 | `select` של מסלולים, תג מיידי או נבדק. במסלול מיידי `MoneyField` וכפתור `disabled={busy \|\| !withinLimits}`. במסלול ידני פרטי חשבון ב `dir="ltr"` עם מפתחות `money.bank.${k}` | `MoneyField` לא מקבל `error`, וכפתור מושבת לא מסביר את עצמו. שדה בנק חדש בשרת יוצג עם מפתח חסר. ברירת המחדל `card` נבחרת גם כשהיא לא זמינה, ואז מוצג מצב ריק |
| 194 עד 260 | `CashOutQuotePanel`. אחרי debounce של 250 מילישניות שולח `GET /finance/cash-out-quote`, ומציג לוח עמלות וברוטו, עמלה ונטו | השרת משתמש באותה פונקציה לציטוט ולחיוב. ה cleanup מבטל את הטיימר ולא את הבקשה, ותשובה ישנה יכולה לנצח |

**שים לב.** בתיקון E3 אסור להוסיף fallback שמחייב בלי הזמנה מאושרת. `capture` שמסרב בלי order id הוא בקרה נכונה. בצד השרת `checkout.service.ts` מאמת מסלול, סכום שלם בגבולות ומפתח לא ריק, בודק replay לפי `userId` ו `providerRef`, ואינדקס ייחודי על `provider_ref` מגבה זאת במסד. מפתח יציב לכל טיוטה הוא מה שיאפשר להגנה הזו לעבוד.

#### `apps/web/src/areas/customer/finance/WalletRequestForms.tsx`
טופס אחד לבקשת הפקדה ולבקשת משיכה, ל `POST /finance/wallet-requests`. אומר בבירור שהגשה לא מזיזה כסף, ורק השלמה של מנהל יוצרת רשומת ledger.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 36 עד 61 | props `type`, `availableMinor`, `existingRequests` ו `onSubmitted`. שבעה שדות, `busy`, `error`, `done` ו `submitted` | |
| 63 עד 89 | `cents`, `validateDraft` ו `findOpenDuplicate` ב `useMemo` בכל הקשה. `showProblem` מציג שגיאת שדה רק אחרי ניסיון הגשה, חוץ מסכום | אין `maxLength` על חשבון יעד ומוטב, 140 בשרת, ועל מפתח מסמך, 400 בשרת. קלט ארוך חוזר כ 400 באנגלית. מינימום 4 ו 2 תווים לחשבון ולמוטב לא נמצא ב DTO, אבל `rules.ts` בשרת בודק אותו |
| 91 עד 120 | `submit` יוצא על בעיה או כפילות, שולח עם `currency: 'USD'` קבוע ושדות אופציונליים רק אם לא ריקים, מאפס חלק מהשדות ומחכה ל `onSubmitted` | `onSubmitted` עובר לטאב הבקשות ומסיר את הטופס, ולכן הודעת ההצלחה עם הקוד כמעט לא נראית |
| 124 עד 249 | `infobox`, שדה סכום ידני עם `aria-describedby`, `CashOutQuotePanel` במשיכה, מקור מימון או חשבון ומוטב, אסמכתא, מפתח מסמך והערות, וכפתור `disabled={busy \|\| Boolean(duplicate)}` | לשגיאת הסכום אין `role="alert"`. שדה מפתח המסמך מבקש קובץ שאין דרך להעלות. זה `div` ולא `form`, ו Enter לא מגיש |

#### `apps/web/src/areas/customer/inbound/InboundPage.tsx`
המסך שבו לקוח רואה לאן לשלוח קניות, רושם חבילה שבדרך ועוקב אחרי החבילות, דפוס P8. שלושה טאבים, כתובות, חבילות ועיבוד. הנתיבים ב `parcel.controller.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 53 עד 121 | `InboundPage`. `loadParcels` טוען `GET /me/parcels` ובכישלון מציב מערך ריק. `ErrorState` אחד לכל הטאבים | כפתור הניסיון החוזר טוען תמיד חבילות, גם כשהכתובות נכשלו, ומנקה את השגיאה. `status` לא מתאפס |
| 123 עד 269 | `EXAMPLE_PURCHASE_MINOR` של 500 דולר ו `AddressesTab`. טוען `GET /me/inbound-addresses`, מציג כל כתובת ב `pre` עם `dir="ltr"`, `copy` עם `navigator.clipboard`, שורת מס עם `taxRateLabel`, ופאנל חיסכון במס בין הכתובת הראשית לכתובת ההעברה | החיסכון והאחוז שגויים פי עשרה בגלל היחידות שתוארו ב `parcels.ts`. ההעתקה עובדת רק ב HTTPS או localhost. `careOf` בשורה הראשונה, שהשרת מייצר משם המשתמש, הוא מה שמשייך חבילה אנונימית ללקוח |
| 271 עד 396 | `ParcelsTab`, `selected` מה URL, `RegisterParcelForm` וטבלה עם כפתור פרטים שעוצר propagation | עמודת העדכון האחרון מתעלמת מ `forwardedAt` |
| 398 עד 504 | `RegisterParcelForm` טוען שוב את הכתובות, שולח `POST /me/parcels` עם שדות אחרי trim ו `undefined` לריקים. `busy` מונע כפילות | אין `maxLength`, והשרת מגביל ל 60, 120 ו 500. השרת מקבל גם `expectedAt` שהטופס לא שולח |
| 506 עד 606 | `ParcelDrawer`. ביטול רק ב `expected` ב `POST /me/parcels/:id/cancel`, ואז רענון וסגירה | לחיצה אחת בלי אישור, בניגוד לביטול בקשה בארנק. השרת אוכף בטרנזקציה עם `FOR UPDATE` ו 404 לחבילה של אחר |
| 608 עד 678 | `ProcessingTab` מציג עומס כללי של המחסן מ `GET /parcels/workflow/status` | הנתיב בלי `@Roles`. הוספת `@Roles` תשבור את הטאב ללקוחות |

#### `apps/web/src/areas/customer/profile/ProfilePage.tsx`
מסך הפרופיל, דפוס P8, שמגיעים אליו מתפריט המשתמש ולא מהרייל. שלושה טאבים, פרטים, כתובות ואבטחה. זה המקום היחיד שבו מנהלים כתובות משלוח, ו `ShipmentComposer.tsx` מפנה לכאן. מה שונה מ P8, זה הדף היחיד בפרק שמתרגם שגיאות עם `apiErrorKey`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 66 | `Profile`, `Address` עם `country` כקוד ISO, `ROLE_LABEL` ו `TABS` | |
| 81 עד 96 | state. `profile` עם `null` לטעינה, עותקי עריכה `firstName` ו `lastName`, `addresses` שמתחיל כמערך ריק, `status`, `error` ו `deleting` לאישור מחיקה | מערך ריק בהתחלה לא מבדיל בין טעינה לאין כתובות |
| 98 עד 107 | `describe` מחזיר משפט מתורגם אם `apiErrorKey` נותן מפתח, ואחרת את הודעת השרת | רכיבי המשנה `PasswordPanel`, `AddressCard` ו `AddressForm` לא משתמשים בו ומציגים `message` גולמי |
| 109 עד 127 | `load` מביא `GET /me/profile` ו `GET /me/addresses` במקביל, וממלא גם את עותקי העריכה | כל `load`, גם אחרי שמירת כתובת, דורס שם שהוקלד ולא נשמר. החלפת שפה מריצה טעינה מחדש דרך `t`. כישלון של אחת משתי הבקשות מכשיל את שתיהן |
| 129 עד 143 | `saveName` שולח `PATCH /me/profile` עם `normalizeNamePart`, ומעדכן מהתשובה | בלי `busy`, אבל הפעולה אידמפוטנטית. השרת מריץ שוב את אותם כללים מ `apps/api/src/shared/names.ts` |
| 145 עד 156 | `removeAddress` שולח `DELETE /me/addresses/:id`, טוען, וסוגר את חלון האישור | `ConfirmationModal` לא מקבל `busy`, ולחיצה כפולה מחזירה 404 על מחיקה שהצליחה. מחיקת ברירת המחדל לא מקדמת כתובת אחרת |
| 158 עד 174 | `nameDirty` משבית שמירה בלי שינוי, ו `ContextTabs` עם הודעות | חשבון עם `nameReviewRequired` שהשם שלו נכון לא יכול לאשר אותו, כי הכפתור מושבת והשרת היה מקבל. retry טוען מחדש גם אחרי שמירה שנכשלה ומנקה את השגיאה |
| 176 עד 267 | טאב הפרטים. אימייל ב LTR, שם משתמש כ `code` קבוע, שם מלא מ `fullName`, ושני `Field` בלי `htmlFor` עם תצוגה מקדימה | שם המשתמש לא בשום DTO של עדכון, ולכן קבוע גם מול קריאה ישירה |
| 269 עד 338 | טאב הכתובות עם `AddressCard` לכל כתובת ו `AddressForm`, טאב האבטחה, חלון אישור מחיקה, ופאנל טעינה | פאנל הטעינה מופיע מתחת לתוכן הטאב ולא במקומו |
| 340 עד 448 | `PasswordPanel`. `unchanged` חוסם סיסמה זהה, `ready` לפי `PASSWORD_MIN`, ו `save` שולח `POST /auth/password/change` | ההערה בשורות 340 עד 352 שגויה. השרת כן מנתק את כל שאר ה sessions ומחזיר `otherSessionsEnded`, והדף מתעלם ממנו. זה `div` ולא `form`. הנתיב מוגבל בקצב ב `CREDENTIAL_ROUTE`, כך שניחוש הסיסמה הנוכחית מתוך session גנוב מוגבל |
| 450 עד 539 | `AddressCard` במצב קריאה או עריכה. `valid` דורש שישה שדות לא ריקים, ו `save` שולח `PATCH /me/addresses/:id` | `valid` בלי trim, רווח בודד נחשב תקין. בלי `busy` |
| 541 עד 637 | `AddressFields` עם `useId`, `select` של מדינה מ `useShippingCountries` עם אפשרות ריקה, ו `autoComplete` לכל שדה | בגלל `htmlFor` רמז המדינה לא מוצמד, בניגוד להערה. המדינה היא החוק היחיד שנאכף בשני הצדדים, ב DTO אין `MinLength` ו `MaxLength` |
| 639 עד 685 | `AddressForm` שולח `POST /me/addresses` ומאפס | בלי `busy`. לחיצה כפולה יוצרת שתי כתובות, ועם `isDefault` שתיהן עלולות להיות ברירת מחדל, כי אין אינדקס ייחודי חלקי |

#### `apps/web/src/areas/customer/notifications/NotificationsPage.tsx`
מסך ההתראות, דפוס P8, בשני טאבים. מה שונה, הזרם לא נטען כאן. `App.tsx` מחזיק אותו דרך `useNotificationFeed` ומעביר כ prop, כך שהפעמון והדף רואים אותה רשימה. ההעדפות נטענות כאן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 42 | `ChannelPreference` עם `enabled` ו `mandatory`, `PreferenceRow` ו `PreferenceMatrix` | |
| 44 עד 51 | `putJson` עוטף `api.put` | פעם היה `fetch` ידני שזרק `Error` רגיל ואיבד את הסיווג |
| 64 עד 80 | props `feed` ו `onSeen`, state של `prefs`, `error` ו `saving`, ו `tab` מה URL | |
| 82 עד 94 | `loadPrefs` טוען `GET /notifications/preferences`, ובכישלון מאפס `prefs` ל `null` | `null` הוא גם סימן הטעינה, ולכן אחרי כישלון הטאב מציג שלד לנצח. כפתור ה retry בשורה 133 קורא ל `feed.reload` ולא ל `loadPrefs` |
| 96 עד 99 | effect שקורא ל `onSeen` בכל כניסה לדף | מסמן הכל כנקרא גם בכניסה לטאב ההעדפות, לפי שעון הדפדפן. `onSeen` inline ב `App.tsx` יגרום ללולאת רינדורים |
| 101 עד 124 | `toggle` ו `toggleChannel` שולחים `PUT /notifications/preferences` ו `PUT /notifications/preferences/channel`, ואז טוענים את המטריצה מחדש | אין עדכון אופטימי. `saving` גלובלי מונע race. `setChannel` בשרת מעדכן כל סוג בטרנזקציה נפרדת, וכישלון באמצע משאיר עדכון חלקי |
| 126 עד 173 | `ErrorState` משותף, וטאב הזרם עם `eventLabel`, `renderContent` ו `formatDateTime` | השורות לא לחיצות. השרת מחזיר את כל ההתראות בלי limit. ה worker כותב שורה נוספת לכל מייל, ו `listMine` לא מסנן ערוץ, כך שאירוע עם מייל מופיע ונספר פעמיים |
| 175 עד 249 | טאב ההעדפות. כפתורי הדלק וכבה לכל ערוץ, טבלה לכל קטגוריה, תווית מתורגמת אם הסוג ב `EVENT_TYPES` ואחרת התווית האנגלית מהשרת, ותיבות מושבתות לצירופי חובה | לתיבות הסימון אין שם נגיש. הלקוח מניח שסדר הערוצים בשורה זהה לסדר הכותרות |

#### `apps/web/src/areas/customer/support/SupportPage.tsx`
מערכת הפניות של הלקוח, דפוס P8, והמסך היחיד שחשבון מושעה רואה. כל נתיבי הלקוח ב `sup.controller.ts` מסומנים `@AllowSuspended()`. הקובץ מייצא גם את `ThreadDrawer`, שמשמש את תור הצוות ב `SupportQueue.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 37 עד 113 | `SupportPage`. `load` טוען `GET /support/tickets` ובכישלון מציב מערך ריק. הודעת השעיה לפני כל תוכן, `TicketList`, `NewTicketForm`, ומגירה לכל `route.params.ticket` | כישלון נראה כאין פניות, ומשתמש מושעה עלול לפתוח פנייה כפולה |
| 115 עד 207 | `TicketList`, טבלה עם שורה לחיצה וכפתור פתיחה אמיתי שעוצר propagation, וסטטוס לפי `TICKET_TONE` | הכפתור פותר את פער הנגישות של שורות הארנק |
| 209 עד 278 | `NewTicketForm` עם קטגוריה, נושא וגוף, `maxLength` של 200 ו 5000 תואמים לשרת, ו `POST /support/tickets` | הטופס לא שולח `relatedType` ו `relatedId`, ואין דרך לקשר פנייה לבקשת משיכה. רק ה throttler הגלובלי חל |
| 280 עד 349 | `ThreadDrawer` עם `staff`. `load` לפי `ticketId`, `send` שולח `POST /support/tickets/:id/messages`, ו `resolve` לצוות בלבד | `thread` ו `reply` לא מתאפסים בהחלפת פנייה, וטיוטה עלולה להישלח לפנייה הלא נכונה. תיקון, `key={ticketId}` או איפוס ב effect. `reply` בשרת בודק בעלות, מוסיף הודעה ומעדכן סטטוס בטרנזקציה אחת |
| 351 עד 421 | רינדור עם `DetailDrawer`, `ul.timeline` של הודעות ב `pre-wrap`, ותיבת תשובה רק אחרי טעינה | שורות 397 ו 398 קובעות תווית לפי `authorRole` בלבד, ובתור הצוות הודעות הלקוח מסומנות אתם |
| 423 עד 424 | ייצוא מחדש של הטיפוס `TranslateFn` | |

**שים לב.** פנייה של אחר מחזירה 404 ולא 403, כדי לא לאשר שמזהה קיים. תשובת לקוח מחזירה פנייה סגורה ל `open`. שינוי props של `ThreadDrawer` שובר את תור הצוות.

#### `apps/web/src/areas/customer/membership/MembershipPage.tsx`
מסך המנוי, דפוס P8. המסלול הנוכחי ומה נשאר במחזור, טבלת השוואה, ומה אף מסלול לא כולל. כאן לקוח מצטרף, משדרג, משנמך או מבטל. מה שונה מ P8, יש `loading` נפרד, כי `mine === null` הוא תשובה אמיתית של לקוח בלי מנוי.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 40 עד 69 | state של `catalogue`, `mine`, `loading`, `busy` כמפתח מסלול, `notice` ו `confirming`. `load` מביא `GET /membership/tiers`, שמסומן `@Public()`, ו `GET /membership/me` | |
| 71 עד 105 | `subscribe` שולח רק `{ tier }` ל `POST /membership/subscribe`. התשובה בשלושה ענפים, הנמכה מתוזמנת עם תאריך, חיוב עם `chargedMinor` מהשרת, או שמירה בלי חיוב | הלקוח לא שולח סכום, והשרת מחשב בטרנזקציה עם `FOR UPDATE`. אין מפתח אידמפוטנטיות, אבל בקשה חוזרת לאותו מסלול נדחית ב 409 |
| 107 עד 120 | `cancel` שולח `POST /membership/cancel` ומציג `endsAt` | לחיצה אחת בלי אישור, בניגוד לעיקרון בראש הקובץ. הפעולה הפיכה. בשרת `cancel` בלי `FOR UPDATE` |
| 122 עד 150 | `tierOrder` מסדר הקטלוג, ו `confirmSentence` הופך את `tierAction` למשפט עם סכום, זיכוי וימים | שינוי סדר ב `catalogue()` בשרת בלי `tierRank` יגרום למשפט לומר בלי חיוב בזמן שהשרת מחייב. הסכום במשפט לפי שעון הדפדפן. `tests/web/membership-tiers.test.ts` מגן רק על הסדר של `MEMBERSHIP_TIERS`, לא על מיון או סינון בתוך `catalogue()` |
| 152 עד 157 | שלד בזמן טעינה, ו `ErrorState` עם retry ל `load` | כל רענון, גם אחרי הרשמה, מחליף את כל הדף בשלד. הפוקוס אובד והודעת ההצלחה לא מוכרזת |
| 159 עד 228 | פאנל המנוי הנוכחי. משפט חידוש או סיום, מכסות מ `perCycle` עם פס `role="img"`, פריטים מאוחסנים וקרדיט דואר, וכפתור ביטול רק ב `active` | `toLocaleString()` לפי הדפדפן ולא לפי שפת האפליקציה. `insuredShipments` ו `commission` קיימים ב `MyMembership` ולא מוצגים כאן |
| 230 עד 284 | טבלת ההשוואה עם `scope` נכון, ו `allowanceCell` שמציג קו ארוך ללא כלול | `aria-label` על `span` בלי role לא נקרא באמינות |
| 286 עד 338 | פקדי הרכישה. `isCurrent` מציג תג במקום כפתור, `offer-note` מתחלף למשפט האישור, ואישור עם `loading={busy === tier.key}` | הסתרת הכפתור למסלול הנוכחי מונעת את הבקשה היחידה שהשרת דוחה ב 409 |
| 340 עד 374 | פאנל מה לא כלול, וחמש פונקציות שבונות מפתחות עם `as MessageKey` | מזהה חדש בשרת יוצג כמפתח גולמי |

## פרק 9. שאר מסכי הלקוח, המחסן והמנהל

### סקירה

שאר מסכי ה SPA. ארבעה אזורי לקוח, כספת, עזרה, שוק ומשלוחים, ושתי קונסולות צוות, מחסן ומנהל. כל קובץ עליון הוא דפוס P8, `App.tsx` בוחר אותו לפי המדור, הלשונית נקראת מה hash דרך `useRoute`, וכל פעולה היא קריאה לשרת דרך `api`. הבדיקות בדפדפן הן נוחות בלבד. הסיכון כאן הוא סטייה, כפתור שהשרת ידחה, או טקסט שמבטיח מה שהקוד לא עושה.

סדר קריאה. `VaultPage.tsx` והטפסים שלו, אחר כך העזרה, אחר כך השוק שבו זז כסף, המשלוחים, ובסוף `WarehouseConsole.tsx` ו `AdminConsole.tsx` עם תתי הפאנלים השכנים.

מודולים משותפים שכל הקבצים כאן נשענים עליהם. `shared/routing.ts` עם `useRoute`, `useNavigation`, `goTab` שמנווט בלי params, `setParams` שממזג ומשתמש ב `replace`, ו `openRecord` ו `closeRecord` למגירה בכתובת. `shared/money.ts` עם `dollarsToCents` שמחזיר `null` לריק, לאפס ומטה ולקלט עם יותר משתי ספרות עשרוניות. `shared/ui/DetailDrawer.tsx` עם `DetailDrawer` ו `ConfirmationModal`. `shared/ui/primitives.tsx` עם `Button` שמנטרל את עצמו ב `loading`, `Field`, `MoneyField` ו `ContextTabs`. `shared/Barcode.tsx` למסמכי הדפסה, ו `shared/servicePrices.ts` למחירי כפתורים.

ארבע מלכודות חוזרות בכל הקבצים, וכל אזכור בהמשך מפנה לכאן.
- **מלכודת onError.** פאנלים שמים את `onError` במערך התלויות של `load`. ההורה מעביר `setError`, שהוא יציב. פונקציית חץ במקומו יוצרת טעינה בכל רינדור ולולאת בקשות בכשל.
- **מרוץ debounce.** ה cleanup מבטל טיימר ולא בקשה שכבר יצאה. אין `AbortController`, ותשובה ישנה יכולה לדרוס חדשה.
- **קפיצת פוקוס.** `ConfirmationModal` ב `shared/ui/DetailDrawer.tsx` שם את `onCancel` בתלויות ה effect שמנהל פוקוס. `onCancel` inline גורם לפוקוס לקפוץ לדיאלוג בכל רינדור.
- **מצב ישן בלי key.** מגירה או טופס שמרונדרים בלי `key` שומרים state של הרשומה הקודמת כשהרשומה מתחלפת בלי unmount.

כל לשונית מרונדרת רק כשהיא פעילה, ולכן מעבר לשונית מוחק טופס חצי מלא. טיפוסי התגובה בכל הקבצים הם העתקים ידניים של השרת, ושינוי שם שדה בשרת שובר בזמן ריצה ולא בקומפילציה.

בדיקות. בדיקות ה web יושבות ב `tests` בשורש ולא תחת `apps/web`. `tests/ux/customer-screens.test.tsx` מכסה רינדור של הכספת, `tests/web/faq-legal.test.ts` את תוכן העזרה, `tests/ux/receiving-bench.test.tsx` ו `tests/ux/warehouse-bench.test.tsx` את הקבלה והספסל, ו `tests/web/wallet-requests.test.ts` את `reviewerActions`. לשוק, למשלוחים ולרוב קונסולת המנהל אין בדיקות רכיב. בדיקות האינטגרציה קוראות לנתיבים ישירות, ולכן פער בין לקוח לשרת לא נתפס בשום מקום.

#### `apps/web/src/areas/customer/vault/VaultPage.tsx`

המסך שאליו נוחת הלקוח, `section === 'vault'`. רשימת פריטים בשלוש לשוניות, ומגירת פריט עם פעולות שירות, תמונות, אחסון וציר זמן. דפוס P8. שלושה עותקים ידניים של אותו רעיון צריכים להסכים, מכונת המצבים ב `cst/lifecycle.ts`, תנאי הלשוניות `LIVE` ו `TERMINAL` ב `vlt/vault.service.ts`, ו `states` של כל פעולה כאן.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 133 | imports וחמשת טיפוסי התגובה, `BreakEvenRow`, `VaultItem`, `ItemMedia`, `TimelineEvent`, `StorageStatus`, `VaultCounts`. סכומים בסנטים | `VaultItem` כאן רחב מהטיפוס בעל אותו שם ב `shared/useVaultItems.ts`. עדכון אחד לא מעדכן את השני |
| 135 עד 157 | `STATE_META` ממפה מצב לגוון ולמפתח תרגום. `stateLabel` מחזיר מחרוזת גולמית למצב לא מוכר | כולל `at_grader` ו `discarded`, אבל השרת לא מחזיר אותם באף לשונית. פריט אצל מדרג או שנזרק נעלם מהכספת |
| 159 עד 225 | `SCOPES` ו `Scope`, `SCOPE_ICON`, הטיפוסים `OpenServiceRequest`, `CardAction`, `FormKind`, ו `timelineKindLabel` שמתרגם `timeline.<kind>` או מחליף קווים תחתונים ברווחים | `SCOPES` משוכפל ב `vlt.controller.ts` שורה 8. ההערה בשורה 191 על typed confirmation לא נכונה, המודאל הוא כפתור בלבד |
| 236 עד 395 | `CARD_ACTIONS`, עשר פעולות הצהרתיות. כל אחת עם `key`, `states`, מסננים `lotOnly` ו `gradedOnly`, `form` אופציונלי, `serviceType`, ו `run` שקורא ל `/services/*`. photography, grading, video, inspection, lot-split, consignment, buyout, custom, deslab, donation | `key` הוא גם המפתח ב `SERVICE_FEE_ACTION`, שינוי שם מעלים את המחיר מהכפתור. photography בשרת בודק רק בעלות, הרחבת `states` שלו תחייב גם פריט שנשלח. buyout גובה את דמי `service` כבר בבקשת ההצעה. ל custom אין `serviceType` בכוונה, השרת מתיר כמה במקביל. deslab ו donation שולחים בקשה שמחזירה `confirmationToken` ומיד אישור, ולכן המודאל הוא ההגנה מפני טעות אנוש |
| 405 עד 428 | `VaultPage`. לשונית מ `route.tab` עם ברירת מחדל `active`. state של `items` שמתחיל `null`, `counts`, `q`, `error`, `status`, `culling`, `cullWindowDays`, ו `watch` כ `Map` | הלשונית ב URL והחיפוש ב state, ולכן אין קישור לחיפוש |
| 430 עד 453 | `load` שולח במקביל `GET /vault/items?scope&q` ו `GET /vault/counts?q` עם אותו `q`. effect עם debounce של 250 מילישניות | מרוץ debounce. השרת מחזיר עד 50 פריטים בלי עימוד, והמונה סופר עד 200 |
| 455 עד 481 | שני effects חד פעמיים. `GET /vault/break-even` לתוך `watch`, ו `GET /services/remove-commons/window`. שניהם בולעים שגיאות | ה watch לא מתרענן אחרי פעולה עד טעינת הדף |
| 483 עד 553 | `selected` נגזר מהרשימה לפי `route.params.item`. שורת חיפוש, כפתורי לשונית עם `aria-pressed` ומונה עד `99+`, מונה נכסים, וכפתור Remove commons רק ב `active` | קישור לפריט שאינו ברשימה הנוכחית לא פותח כלום. `vault.assetsCount` מציג `items.length`, לא את הספירה האמיתית |
| 555 עד 651 | הודעות, `RemoveCommonsPanel` עם `items` המסוננים, שלדי טעינה, `EmptyState` שמפנה ל `inbound/addresses`, `RegisterHead` ו `CardTile`, ו `ItemDrawer` כש `selected` קיים | `status` ו `error` לא מתנקים במעבר לשונית. `items` לא חוזר ל `null` בהחלפת לשונית ולכן רשימה ישנה מוצגת לרגע. `ItemDrawer` בלי `key`, מצב ישן בלי key. התיקון הוא `key={selected.id}` |
| 670 עד 806 | `CardTile` שורת register עם `card-hit` שנמתח על כל השורה, serial ב LTR, badge מצב או הקפאה, מיקום, ו `Watch`. `RegisterHead` שורת כותרת `aria-hidden` | `frozen` מוגדר רק כש `holdFlag` דלוק והפריט לא היסטורי |
| 815 עד 856 | `Watch` פס של כמה מהערך המשוער נאכל באחסון. `role="img"` עם תיאור מילולי, רוחב ב `inlineSize` לעבודה ב RTL | ערך ידוע רק כש `estimatedValueMinor` חיובי |
| 866 עד 922 | `ItemMediaGallery` ממיין לפי גרסה יורדת, `Set` חדש של כשלונות בכל כשל, וידאו עם `preload="metadata"` | |
| 937 עד 1019 | `StoragePanel` מציג אחסון כלול עד תאריך, או כמה חויב והחיוב הבא | האחוז מוצג עם `toFixed(0)`, 250 נקודות בסיס יוצגו 3. רק הטקסט שגוי, הסכום מהשרת |
| 1026 עד 1101 | `ItemDrawer`. state של אירועים, אחסון, מדיה, בקשות פתוחות, `confirming`, `formOpen`, `busy`, ו `useServicePrices`. שלושה effects לפי `item.id`, ציר זמן, `GET /vault/items/:id` למדיה ובקשות פתוחות, ו `/storage` | אין דגל `live` כמו ב `servicePrices.ts`. בלי key תשובה של פריט קודם דורסת. `itemCard` דורש בעלות נוכחית ולכן בפריט היסטורי הגלריה נעלמת בשקט |
| 1103 עד 1131 | `graded` הוא grade שאינו raw. `actions` ריק לפריט היסטורי או מוקפא, אחרת מסונן לפי מצב, lot ו grade. `run` מריץ, קורא ל `onActed` וסוגר | `conditionGrade` משמש גם למצב פיזי, ולכן כרטיס NM נחשב graded גם בשרת. בשרת `assertNotAlreadyOpen` הוא בדיקה ואז הכנסה בלי אינדקס ייחודי, ו photography ו video לא נועלים `FOR UPDATE` |
| 1133 עד 1148 | סיבת ההקפאה מהאירוע `hold_placed` האחרון, regex שמסיר את הקידומת | תלוי בפורמט הסיכום ב `inventory.service.ts` שורה 126 |
| 1150 עד 1386 | `DetailDrawer` עם במה, רשימת פרטים, שגיאה, אחסון וגלריה. רשימת הפעולות בשורות 1269 עד 1327 עם מחיר מ `SERVICE_FEE_ACTION` ו `priceLabel`, או סטטוס בקשה פתוחה. ארבעת הטפסים בשורות 1329 עד 1379 עם `onCancel`, `onDone`, `onError={setError}`. ברקוד בסוף | מלכודת onError בכל ארבעת הטפסים. `busy` של טופס נפרד, ולכן כפתורי הפעולות לא ננעלים בזמן שליחת טופס |
| 1398 עד 1431 | ציר הזמן. מפתח `event.at` ועוד אינדקס, סיכום ב `ltr-run` | בשרת `hasHeld` נותן לבעלים קודם לראות אירועים שקרו אחרי שעזב, כולל קודי משלוח ומחירים של הבעלים הבא |
| 1435 עד 1460 | מודאל אישור לפעולה עם `confirm`, עם עמלה ו `busy` | קפיצת פוקוס. Escape מבטל גם בזמן ריצה, בלי נזק לנתונים |

**שים לב.** הוספת מצב חדש בשרת דורשת עדכון של `STATE_META`, של `LIVE` או `TERMINAL`, ושל `states` בפעולות. אין בדיקה שמשווה את `states` ל services, והבדיקה `tests/ux/customer-screens.test.tsx` מכסה רק רינדור, ריק ושגיאה.

**איך מוסיפים פעולת כרטיס.** רשומה חדשה ב `CARD_ACTIONS` עם `states` שזהים למה שה service בשרת בודק, `serviceType` אם אסור שתי בקשות פתוחות, מפתח תואם ב `SERVICE_FEE_ACTION` ב `shared/servicePrices.ts` כדי שהמחיר יוצג, ומפתחות תווית, תיאור והצלחה בשני האזורים של `i18n.tsx`. פעולה בלתי הפיכה מקבלת `confirm`, ואם השרת משתמש ב `ConfirmationService` ה `run` שולח שתי קריאות כמו deslab. פעולה עם טופס מקבלת `form` ו `run` ריק, וטופס שכן מקבל את החוזה `onCancel`, `onDone`, `onError`.

#### `apps/web/src/areas/customer/vault/ConsignmentForm.tsx`

טופס במגירה לבחירת ערוץ מכירה, מחיר ותערוכה. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 21 עד 53 | props עם `id` ו `conditionGrade` בלבד, state, ו effect שמביא `GET /services/consignment/channels` ובוחר ערוץ ראשון | מלכודת onError |
| 55 עד 74 | `channel`, `cents` מ `dollarsToCents`, ו `problems`, שלושה כללים שמועתקים מ `checkEligibility` ב `dis/consignment-channels.ts`, graded only, מחיר מינימום, תערוכה חובה | כלל חדש בשרת לא יופיע כאן. מחיר לא חוקי משבית את הכפתור בלי הסבר. תערוכה מלאה לפי `capacity` מופיעה ותידחה רק בשליחה |
| 76 עד 92 | `submit` שולח `POST /services/consignment` עם `eventId` רק לערוץ שדורש | השרת נועל את הפריט ו `assertNotAlreadyOpen` חוסם בקשה שנייה |
| 94 עד 162 | שני `select`, `MoneyField`, בעיות כ badges ושני כפתורים | ערוץ חדש צריך גם תווית ב `channelLabel` ב `shared/market.ts` |

#### `apps/web/src/areas/customer/vault/GradingForm.tsx`

בחירת tier לדירוג חיצוני והצהרת ערך. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 22 עד 53 | state ו effect שמביא `GET /services/grading/tiers` עם מחיר לכל tier ו `walkthroughThresholdMinor` | מלכודת onError. tier בלי חוק מחיר מוצג כמחיר לא ידוע, אבל השרת גובה את חוק `service` השטוח |
| 55 עד 70 | שני כללים, תקרת ערך ל tier וסף מינימום ל tier שדורש walkthrough, העתק של `checkTier` ב `grading-tiers.ts` | שינוי הסף בשרת מגיע אוטומטית. כלל שלישי בשרת לא |
| 72 עד 141 | `submit` שולח `itemId`, `tier`, `declaredMinor`. רמז מחיר, זמן, תקרה, והערה שהכרטיס לא זמין בזמן הדירוג | הטקסט לא אומר שהכרטיס ייעלם מהכספת במצב `at_grader` |

#### `apps/web/src/areas/customer/vault/RemoveCommonsPanel.tsx`

ניקוי מרוכז של כרטיסים זולים שהגיעו בחלון של 30 יום, תרומה או זריקה באישור אחד. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 9 עד 43 | `CullItem`, תת קבוצה מבנית של פריט הכספת, ו props | |
| 44 עד 74 | `chosen`, `outcome` שמתחיל donate, `cutoff` מ `Date.now()`, ו `rows` עם סיבת חסימה לפי סדר השרת, hold, מצב שאינו `stored`, חלון שעבר. `toggle` | שעון הדפדפן מול שעון השרת, פריט בגבול החלון יידחה. ה `useMemo` מחושב כמעט תמיד כי `cutoff` משתנה |
| 75 עד 93 | `submit` שולח `POST /services/remove-commons` ואז `/confirm` עם הטוקן, ומנקה | `chosen` לא מסונן מחדש כשהחיפוש מסתיר כרטיסים. כרטיסים שהמשתמש לא רואה נתרמים או נזרקים. לתקן בסינון לפי המוצגים |
| 95 עד 186 | checkboxes עם פריט חסום מוצג ומנוטרל, `fieldset` לתוצאה, מודאל עם משפט לפי התוצאה | `assertNotBlocked` בשרת רץ לפני `free`, ולקוח ביתרה שלילית לא יכול לנקות. כרטיס שנזרק עובר ל `discarded` ונעלם מההיסטוריה |

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/customer/vault/CustomRequestForm.tsx` | בקשה חופשית וחינמית לפריט, `POST /services/custom`. אורכים 3 עד 120 ו 10 עד 2000 כמו ה DTO. `loading={busy}` חיוני כי בשרת `allowDuplicate` ולחיצה כפולה תיצור שתי בקשות. השגיאה מוצגת פעמיים, מקומית ואצל ההורה. |
| `apps/web/src/areas/customer/vault/InspectionForm.tsx` | בחירת אזורים מרשימה סגורה מ `GET /services/inspection/areas`, כולם מסומנים כברירת מחדל, `toggle` פונקציונלי ושליחה ל `POST /services/inspection`. אזור חדש בשרת צריך מפתח ב `AREA_KEY` ב `shared/grading.ts`. |

#### `apps/web/src/areas/customer/help/FaqLegalPage.tsx`

מדור העזרה, `section === 'faq'`, שמונה לשוניות. Ask, FAQ ו Legal ממומשות כאן, והשאר מיובאות מהקבצים השכנים. הקובץ לא קורא ל API. שום תוכן לא מרונדר כ HTML.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 49 | imports, `HAS_UNAVAILABLE` שמחושב בטעינת המודול, ושלוש מפות זמינות לגוון, badge וכותרת הערה | היום אין ערך `unavailable`, ולכן תיבת הצגת הכול לא מוצגת |
| 51 עד 123 | `TABS`, ו `FaqLegalPage` שקורא לשונית מה route עם ברירת מחדל `ask`, `ContextTabs` ו `TabPanel` לכל לשונית | `IntakePolicyPanel` בשורה 99 בלי `TabPanel`, ולכן `aria-controls="panel-policy"` מצביע על כלום. ההערה מדברת על שש לשוניות. לשונית חדשה צריכה מפתח `faq.tab.<key>` בשני האזורים של `i18n.tsx`, ה cast ל `MessageKey` לא יתריע |
| 129 עד 143 | `answerQuestion` מחזירה מחרוזת קבועה בלי רשת. זה המקום לחבר עוזר אמיתי | ברירת המחדל של כל המדור היא עוזר שלא עובד |
| 145 עד 237 | `AskPanel`. תורות, `nextId` ב `useRef`, גלילה לסוף, `submit` שמעדכן תור לפי `id` | אין `catch`. כשל עתידי ישאיר תור עם `answer: null` ו unhandled rejection |
| 243 עד 259 | `searchableText` ו `SEARCH_INDEX`, אינדקס באותיות קטנות של שאלה, קטגוריה ובלוקים, נבנה פעם אחת | כולל את סימוני `**` ו `[[..]]` הגולמיים. `baultNote` לא באינדקס |
| 261 עד 388 | `FaqPanel`. חיפוש, קטגוריה ו `showAll`. הערך הפתוח מ `route.params.q`, כך שכל תשובה היא קישור. effect בשורות 287 עד 293 מציג הכול אם הקישור מצביע על ערך מוסתר. הודעת מקור עם קישור לאתר המקור | שינוי `id` בתוכן שובר קישורים שמורים בלי redirect |
| 395 עד 464 | `FaqItem`, disclosure נגיש עם כפתור בתוך `h3`, `aria-expanded` ואזור `role="region"`. ההערה של Bault לפני הציטוט, הציטוט עם `lang="en" dir="ltr"` | |
| 466 עד 521 | `FaqBlockView` מרנדר `p`, `h` שמקובע ל `h4` או `h5`, ו `ul` ברמת קינון אחת. `renderInline` הופך `**bold**` ו `[[label\|url]]` לאלמנטים בעזרת regex גלובלי שנוצר בכל קריאה | `href` הוא ה sink היחיד. React 18 לא חוסם `javascript:`, אם התוכן יגיע ממקור חיצוני צריך לסנן סכמה. החלפה ב parser של Markdown דורשת sanitizer |
| 527 עד 644 | `LegalPanel`. מסמכים שלא פורסמו עם badge, מסמך נבחר, חיפוש סעיפים, הדפסה, הורדה, תוכן עניינים, וגוף ב `<pre>` | תוכן העניינים בשורות 617 עד 626 משתמש ב `href="#legal-<id>"`, וה hash router מפרש אותו כמדור לא מוכר ומעביר לכספת. לתקן ב `scrollIntoView`. ההורדה מצביעה על `/fonts/OFL.txt` שלא קיים ב `assets/fonts`, ו nginx מחזיר את האפליקציה |

**שים לב.** התוכן בקבצי TS ולא ב API, ולכן כל תיקון טקסט משפטי או FAQ דורש build ו deploy של ה web. שינוי מבנה ה hash router ישבור את תוכן העניינים, את הקישורים ב `HelpPanels.tsx` ואת כל `route` ב `guideContent.ts`.

#### `apps/web/src/areas/customer/help/HelpPanels.tsx`

שלושה פאנלים קטנים ללשוניות Guides, Show calendar ו Contact. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 35 | imports, כולל `GUIDES`, `guide`, `GUIDE_CATEGORIES`, `matchesGuideSearch` | |
| 36 עד 109 | `GuidesPanel`. חיפוש וקטגוריה, מדריך פתוח מ `route.params.g`, ואם יש מדריך מוחזר `GuideDetail` במקום הרשימה | כפתורי הקטגוריה בלי `aria-pressed`, המצב מסומן רק בצבע |
| 111 עד 162 | `GuideDetail`. מדריכים קשורים, הודעת אין וידאו, צעדים ב `<ol>` עם קישור `href` ל route | המדריכים באנגלית בלי `lang` ו `dir`, ובממשק עברית הפיסוק מתהפך. קישור קשור בנוי ידנית כ `#/faq/guides?g=<id>` |
| 168 עד 267 | `Show` ו `ShowsPanel`. `GET /content/shows`, חלוקה לעתיד ועבר לפי `past` מהשרת, badge פתוח או סגור וקיבולת | הקיבולת מוצגת כסך ולא כמה נשאר |
| 273 עד 415 | `Contact`, `Location` ו `ContactPanel`. `GET /content/contact` ו `/content/locations` במקביל. `mailto` ו `tel` רק אם הוגדרו, מיקומים עם badge פטור ממס | כשל של אחד מפיל את שניהם. התוכן מגיע ממשתני `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS`, `SUPPORT_TEAM` של ה API. ה `key` של איש צוות הוא השם, שמות כפולים יתריעו |

#### `apps/web/src/areas/customer/help/PriceListPanel.tsx`

מחירון ציבורי מ `GET /pricing/list`, מקובץ לפי פעולה. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 38 | `PriceEntry` עם `parameters`, ו `PriceList` | `parameters` לא נקרא בשום מקום |
| 39 עד 60 | state וטעינה חד פעמית | בשגיאה `list` נשאר `null` וטקסט הטעינה ממשיך מתחת לשגיאה |
| 61 עד 65 | `priceOf`, אחוז לחוק `percentage` ודולרים לחוק `fixed` | מתנהג שונה מ `priceLabel` ב `servicePrices.ts` |
| 67 עד 121 | טבלה לכל קבוצה עם `scope="col"` | שורת האחסון מוצגת כ 1 דולר יומי, כי המודל האמיתי יושב ב `parameters`. רינדור מיוחד לחוק אחסון יתקן בלי שינוי בשרת |

#### `apps/web/src/areas/customer/help/faqContent.ts`

קטלוג 31 השאלות של לשונית FAQ. זה E20. הטקסט הוא ציטוט מילולי של ה FAQ של ShipMyCards, עם כתובות, טלפון, כתובת PayPal וקישור הפניה של חברה אחרת, ו Bault מוסיף לכל ערך הערה משלו. אין imports. הצרכנים הם `FaqLegalPage.tsx` ו `tests/web/faq-legal.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 47 | הערת חוזה. הציטוט לא משתנה, `category` ו `id` הם תוספות, `availability` אומר אם Bault מממש, `baultNote` הוא הצהרה עובדתית על Bault. מגדירה את שני הסימונים `**bold**` ו `[[label\|url]]` | ההערה אומרת GENERATED, אבל אין במאגר מחולל. העריכה בפועל ידנית. ההערה מודה ששבעה עשר ערכים כבר נרקבו פעם |
| 49 עד 78 | הטיפוסים. `FaqAvailability` עם `adapted`, `partial`, `unavailable`. `FaqBlock` הוא union לפי `kind` של `p`, `h` עם `level` מספרי, ו `ul` עם רמת קינון אחת. `FaqEntry` ו `FaqDocument` | `level` הוא `number`, ו `FaqBlockView` מקבע את הכותרת. `category` היא מחרוזת חופשית ולא union |
| 80 עד 93 | `FAQ.source` עם כתובת, תאריך ומספר ערכים, ו `categoryOrder` עם שש קטגוריות שקובעות את סדר הכפתורים | קטגוריה חדשה צריכה מפתח `faq.category.<key>` בשני האזורים של `i18n.tsx` |
| 94 עד 2097 | `FAQ.entries`. כל ערך הוא `id`, `sourceIndex`, `question`, `category`, `availability`, `baultNote`, `blocks` | 29 `adapted` ו 2 `partial`. ההערה בשורה 997 שאומרת ש PayPal אינו מסלול של Bault שגויה, `FUNDING_ROUTES` כולל שני מסלולי PayPal. הקישור בשורה 1788 הוא כתובת עריכה של blogger שבורה ללקוח |

**איך עורכים.** ערך חדש צריך `id` ייחודי באותיות קטנות ומקפים, `sourceIndex` שממשיך את הרצף, קטגוריה מתוך `categoryOrder`, `availability`, `baultNote` מעל 60 תווים שמכיל את המילה Bault, ולפחות בלוק אחד. הבדיקות נועלות את התוכן למספרים מדויקים, 31 ערכים בשורה 52, ו 48 רשימות, 174 פריטים ו 12 מקוננים בשורות 163 עד 174, ולכן כל הוספה מחייבת עדכון מכוון של הבדיקה. הבדיקה בשורות 102 עד 113 תופסת רק שמונה ביטויי שלילה קבועים. המודל לא מאפשר ערך ש Bault כתב בעצמו, כל ערך מניח מקור מצוטט. ההמלצה של הספר המלא היא להחליף את הקובץ ב FAQ שכתוב על ידי Bault, שבו כל תשובה היא `baultNote` מורחב.

#### `apps/web/src/areas/customer/help/guideContent.ts`

שנים עשר מדריכים ש Bault כתב על עצמו. אין imports, הצרכן היחיד הוא `HelpPanels.tsx`, ואין לו בדיקה אוטומטית.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 25 | הערת כותרת. כל משפט הוא הצהרה עובדתית, ו `video: null` במקום קישור מומצא | |
| 27 עד 59 | `GuideCategory` כ union סגור, `GuideStep` עם `text`, `route` מלא כמו `#/inbound/parcels` ו `note`, ו `Guide` עם `minutes`, `steps`, `video`, `related` | `related` הוא מחרוזות, מזהה שגוי מסונן בשקט |
| 61 עד 387 | `GUIDES`. כל מדריך הוא אובייקט עם `id`, כותרת, תקציר וצעדים. המזהים `first-week`, `send-us-a-parcel`, `what-it-costs`, `cull-the-commons`, `grading`, `sell-it`, `trade-with-somebody`, `ship-it-home`, `insurance-and-customs`, `share-a-parcel`, `wallet`, `ask-a-person` | כל המספרים קשיחים בטקסט, אחסון, גבול משלוח ישיר, restocking, חלון ניקוי. `cull-the-commons` מנמק את 30 הימים בכך שהאחסון כבר חויב, וזה שגוי. `wallet` לא מזכיר כרטיס ו PayPal |
| 389 עד 393 | `BY_ID` כ `Map` ו `guide` לפי מזהה | |
| 395 עד 402 | `GUIDE_CATEGORIES`, סדר הכפתורים | קטגוריה שנוספה רק ל union לא תקבל כפתור. קטגוריה חדשה צריכה גם `guide.cat.<key>` ב `i18n.tsx` |
| 405 עד 412 | `matchesGuideSearch`, substring פשוט על כותרת, תקציר, צעדים והערות | שתי מילים לא צמודות לא יימצאו |

**שים לב.** שינוי שם של מדור או לשונית בכל מסך ישבור את ה `route` המתאים כאן בשקט. כל ה routes תקינים היום. בדיקה שמריצה `parse` מ `shared/routing.ts` על כל route ומשווה ל `TABS` הייתה שומרת על זה.

#### `apps/web/src/areas/customer/help/legalContent.ts`

כל הטקסט המשפטי. זה E21. אין תנאי שימוש, מדיניות פרטיות או עוגיות, וההרשמה לא מבקשת הסכמה. אין imports. הצרכנים הם `FaqLegalPage.tsx` והבדיקה `faq-legal.test.ts`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 33 | הערת ההחלטה לא לכתוב טקסט מחייב שאיש לא אישר, וגוף באנגלית בלבד | |
| 35 עד 53 | `LegalSection` עם `id`, `heading`, `body` שמרונדר ב `<pre>`. `LegalDocument` עם `provenance` כמפתח i18n, `lastUpdated`, `downloadPath` | שבירות שורה בגוף משמעותיות |
| 59 עד 63 | `PENDING_DOCUMENTS`, שלושה מפתחות `legal.pending.*` | מפתח חדש צריך תרגום בשני האזורים. הבדיקה בשורות 204 עד 210 מוודאת שהם מפתחות |
| 65 עד 134 | מדיניות שימוש בחשבון ויתרה, שנים עשר סעיפים | סעיף 7 מבטיח שמירה של 12 חודשים לחבילה לא מזוהה, ו `ParcelService.dispose` לא בודק זמן. סעיף 10 מבטיח שפריט שעזב נשאר בהיסטוריה, ו `discarded` לא נכלל. סעיף 11 מבטיח שקונה יכול להזמין בדיקה, ו `assertOwnedAndPresent` חוסם. סעיפים 5 ו 6 קשיחים מול משתני `WALLET_DEBT_*` |
| 135 עד 173 | רישיון SIL OFL 1.1 של Libertinus עם `downloadPath` `/fonts/OFL.txt` | הגופן לא נשלח והקובץ לא קיים. הרישיונות של IBM Plex ו Frank Ruhl Libre לא מוצגים. הבדיקה בשורות 212 עד 219 תיכשל אם מסירים, ויש לעדכן אותה יחד |

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/customer/help/IntakePolicyPanel.tsx` | מציג מה מתקבל, מה נדחה ומה קורה לנדחים, מ `GET /content/intake-policy`. השרת בונה את התשובה מ `ITEM_CLASSES` ו `DISPOSAL_CATEGORIES`, ולכן אינו יכול לסטות מהקליטה. רק `RULES` הם טקסט ידני. מרונדר בלי `TabPanel`. |

#### `apps/web/src/areas/customer/marketplace/MarketplacePage.tsx`

המעטפת של השוק, `section === 'marketplace'`, שמונה לשוניות תחת `ContextTabs`. מחזיקה רק את המשותף, רשימת המודעות, הודעה ושגיאה אחת לדף, זהות המשתמש, ופריטי כספת למכירה. דפוס P8. שאר הלשוניות בקבצים השכנים ומקבלות `onChanged`, `onError`, `onStatus`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 30 עד 43 | `Listing` כהעתק של `BrowseService.list`, ו `TABS` עם `MarketTab` | `imageUrl` לא נקרא, התמונה נבנית מהסידורי |
| 51 עד 89 | המסננים `q`, `type`, `condition`, `min`, `max`, `sort` נקראים מ `route.params` ולא מ state, כדי שקישור ו Back יעבדו. `setParams` משתמש ב `replace`. `buying`, `offering`, ו `useVaultItems(true)` | ה `error` של `useVaultItems` לא מוצג, כשל נראה כמו כספת ריקה |
| 90 עד 112 | `loadProfile` חד פעמי שמספק `myUsername` ו `meId`, ובחירת לשונית עם נפילה ל `browse` | כשל נבלע. בלי `meId` לשונית escrow מציגה כל עסקה מצד המוכר |
| 114 עד 150 | `query` בונה `URLSearchParams` עם מחירים בסנטים. `loadListings` מקבל את המחרוזת כפרמטר. effect עם debounce של 250 מילישניות | מרוץ debounce. ה effect רץ בכל לשונית, לא רק במדף. הסינון בשרת כי התוצאה חתוכה ל 200 |
| 152 עד 168 | `buy` שולח `POST /marketplace/listings/:id/purchase` בלי גוף ובלי `Idempotency-Key`. השרת משלים `purchase-<buyer>-<listing>`, ו replay מוצג כ `market.alreadyBought`. אחרי הצלחה טוען מדף וכספת | E1. המפתח מגן על מודעה אחת. קניות מקבילות של אותו קונה למודעות שונות עוברות את בדיקת היתרה, כי `balanceOf` לא נועל את הקונה. התיקון בשרת |
| 170 עד 358 | תרגום לשוניות, הודעה ושגיאה משותפות, ולשונית `browse` עם סרגל מסננים, שלדים, ריק ורשת כרטיסים. כפתורי קנייה והצעה רק פותחים מצב | ההודעות לא מתאפסות במעבר לשונית |
| 360 עד 386 | לשוניות `house` ו `sell`. `onListed` מציג הודעה, טוען ועובר ל `browse` | בשורות 379 ו 417 `loadListings(q)` מקבל את טקסט החיפוש במקום `query`. עובד רק כי `goTab` מוחק params |
| 388 עד 404 | `ConfirmationModal` של הקנייה | לא מקבל `busy`, ואפשר ללחוץ אישור שוב בזמן טיסה. קפיצת פוקוס. הוספת `busy` דורשת state חדש בדף |
| 406 עד 462 | לשוניות `listings`, `offers`, `trade`, `escrow`, `store`, ומגירת ההצעה | ב `trade`, `onProposed` לא מרענן את `SwapsPanel`. כדאי `reloadToken` כמו במשלוחים |
| 469 עד 548 | `SellPanel`. בחירה אוטומטית של הפריט הראשון, מחיר ברירת מחדל 500.00, `POST /marketplace/listings` עם `askingPrice` בסנטים, רמז חי | השרת נועל את הפריט, דורש `stored` ומעביר ל `listed`. האופציה הריקה מתה. בזמן טעינה מוצג שאין פריטים |
| 554 עד 631 | `OfferDrawer`. סכום התחלתי לפי המחיר, `POST .../offers` עם `amount`, `dirty` כדי שסגירה תבקש אישור | אין בדיקה שההצעה נמוכה מהמחיר, השרת קובע |

**שים לב.** הקנייה מהמדף בלי `Idempotency-Key` כי מודעה נמכרת פעם אחת, וחנות הבית עם מפתח לכל אישור כי למוצר יש עותקים. אם השרת יפסיק להשלים מפתח בשורה 149 של `mkt.controller.ts`, לחיצה כפולה תוצג כשגיאה, וצריך להוסיף מפתח כמו ב `HouseStorePanel.tsx`. לשונית חדשה דורשת עדכון `TABS`, מפתח `market.tab.<key>` ו `TabPanel`.

#### `apps/web/src/areas/customer/marketplace/SellerPanels.tsx`

שלושה פאנלים של צד המוכר והמשא ומתן. דפוס P8. כל `load` תלוי ב `onError`, מלכודת onError.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 36 עד 61 | `MyListingsPanel`, state ו `load` של `GET /marketplace/listings/mine` | `busy` אחד לכל הפאנל |
| 63 עד 77 | `reprice` שולח `PATCH /marketplace/listings/:id` עם `askingPrice` | השרת דוחה מודעה שאינה `active` |
| 79 עד 99 | `remove` מריץ `/remove` שמחזיר `confirmationToken` ומיד `/remove/confirm` | שני השלבים בלחיצה אחת, ההגנה היא המודאל. בכשל לא ברור מאיזה שלב |
| 101 עד 239 | טבלה עם `dt-wrap--stack`, עריכת מחיר בתא, כפתורים רק ל `active`, מודאל הסרה עם `busy` | שדה המחיר בעריכה בלי תווית נגישה |
| 259 עד 318 | `OffersPanel` ו `respond`. accept, reject או counter עם `amount` בסנטים, `POST /marketplace/offers/:id/respond` | השרת משלים `offer-<id>` וגובה את הסכום השמור בהצעה, לא מה שהלקוח שולח. דחייה כשלא תורך היא משיכה |
| 320 עד 423 | שורות עם צד ותור. פעולות רק ל `pending` על מודעה `active`. שדה נגדי אחד משותף | אחרי הצעה נגדית יש שתי שורות לאותה מודעה, `countered` ו `pending` |
| 425 עד 533 | `OfferActions`, שלושה מצבים, נגדית, לא תורך, תורך. קבלה לא מוצגת למי שהציע | `yourTurn` מחושב בשרת, `assertNotProposer` הוא ההגנה. קבלה היא קנייה מלאה בלי חלון אישור |
| 547 עד 657 | `SwapsPanel`. `GET /marketplace/swaps`, ו approve או reject. `theyGet` ו `youGet` מנקודת מבט הקורא, כפתורים לפי `awaitingMe` | אישור הוא העברת בעלות עם חיוב בלי חלון אישור. הביטוי בשורה 627 מיותר אבל נכון |

#### `apps/web/src/areas/customer/marketplace/ProposeTradePanel.tsx`

טופס הצעת החלפה או מתנה בראש לשונית `trade`. דפוס P8 עם מופע `useVaultItems` משלו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 44 עד 67 | state, `offeredIds` לפי סדר הכנסה, ו effect שמאפס צד שני ופריטים מבוקשים בכל שינוי שם | |
| 69 עד 79 | `lookup` של `GET /marketplace/collectors/:username` | תשובה מאוחרת אחרי שינוי שם מציבה צד ישן. לבדוק שהשם שחזר שווה לנוכחי |
| 87 עד 98 | `addWanted` מבקש פריט של הצד השני לפי סידורי בלבד | זו בקרת הפרטיות, אין עיון בכספת של אחר |
| 100 עד 136 | `propose`. במתנה `POST /marketplace/transfers` עם `offeredIds[0]` ומיד `/transfers/confirm`. בהחלפה `POST /marketplace/swaps` עם שני מערכים | מעבר ממצב החלפה למתנה לא מאפס `offered`, ונשלח רק הפריט הראשון שסומן. תיקון ב `useEffect` שמאפס על `gift`. המקבל עדיין צריך לאשר |
| 138 עד 251 | שדה שם עם `aria-invalid`, checkboxes של פריטים, שדה סידורי רק בהחלפה | מציג `typeClass` גולמי. כפתור ההסרה מתויג `ui.cancel` |

#### `apps/web/src/areas/customer/marketplace/EscrowTab.tsx`

לשונית escrow. עסקה פרטית שבה Bault מחזיקה את הכסף ובודקת את הכרטיס. המצבים `proposed`, `agreed`, `funded`, `inspecting`, `awaiting_release`, `settled`, ויציאה ל `returned` או `cancelled`. צעדי המחסן לא כאן. דפוס P8 עם הודעות משלו.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 16 עד 60 | `Terms`, `Detail` עם `buyerId` ו `sellerId` מהשרת, ו state של הלשונית ושמונת שדות הטופס | |
| 62 עד 81 | `load` של `GET /escrow/mine`, `/escrow/terms`, `/escrow/held` ב `Promise.all` | כשל של אחת מסתיר את כולן |
| 83 עד 95 | `feePreview` באותה נוסחה של `escrowFeeMinor`, מפרמטרים מהשרת. `belowFloor` ו `ready` | העמלה לא נשלחת. שינוי נוסחה בשרת יסיט רק את התצוגה. אימייל של צד חיצוני לא מאומת בשום צד |
| 97 עד 119 | `raise` שולח `POST /escrow` עם צד נגדי, תיאור, `valueMinor` ו `settlement` | |
| 121 עד 257 | פאנל תנאים, טופס, ורשימת עסקאות. `viewerIsBuyer` מחושב מ `meId` | בלי `meId` כל עסקה מוצגת מצד המוכר. שורה עם `tabIndex` בלי `onKeyDown`, לא נפתחת במקלדת. הטבלה בלי `--stack` |
| 274 עד 340 | `DealDrawer`, `load`, `act` אחיד עם `busy`, `iAmBuyer` ו `iAmSeller` מהשרת | מחזיר `null` בזמן טעינה, אין משוב ללחיצה |
| 341 עד 401 | פרטים, ממצא הבדיקה לפני כל שחרור, וכפתור agree לצד שלא פתח ב `proposed` | אין כפתור ביטול למרות ש `POST /escrow/:id/cancel` קיים |
| 403 עד 415 | fund, `POST /escrow/:id/fund` לקונה ב `agreed` | E18. בלי אישור ובלי מפתח. בשרת `assertStatus` על עותק לפני הטרנזקציה בלי `FOR UPDATE`, ושתי בקשות רושמות שני חיובי `escrow_hold` |
| 417 עד 478 | release לשני הצדדים ב `awaiting_release`, טופס return עם סיבה עד 500, והיסטוריה | `eventType` מוצג באנגלית גולמית |

**שים לב.** התיקון של fund הוא בשרת בלבד, `FOR UPDATE` על העסקה או עדכון מותנה `where status = 'agreed'` ב `EscrowService.fund`, בלי שינוי בלקוח. כפתור ביטול דורש רק קריאה ל `POST /escrow/:id/cancel` עם `reason`, השרת כבר אוכף מצבים. `viewerIsBuyer` ברשימה ו `iAmBuyer` במגירה מחושבים בשתי דרכים ויכולים לסטות.

#### `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx`

לשונית `house`, החנות של Bault. מוצר עם מלאי, והקונה מקבל עותק חדש שיתויג ויאוחסן. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 63 | `HouseProduct`, `HousePurchase` עם `orderCode` ו `serialNumber`, state עם `buying` שמחזיק מוצר ומפתח, ו `load` של `GET /marketplace/house/listings` | |
| 65 עד 90 | `buy` שולח `POST .../purchase` עם `Idempotency-Key` מ `buying.key`. הודעה עם סידורי וקוד הזמנה, רענון מלאי | המקום היחיד בשוק עם מפתח. המפתח נוצר בשורה 136 בלחיצה על Buy, כך שאישור כפול הוא replay וקנייה שנייה מכוונת מקבלת מפתח חדש. הזזת היצירה לתוך `buy` מבטלת את ההגנה |
| 92 עד 167 | שלדים, ריק, רשת עם `CardPhotoThumb` מ `photoRef`, ו `ConfirmationModal` | `crypto.randomUUID` עובד רק ב HTTPS או localhost. המודאל לא מקבל `busy`, ההגנה היא המפתח |

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/customer/marketplace/StorefrontPanel.tsx` | לשונית `store`, מודעות פעילות של מוכר לפי שם מ `GET /marketplace/sellers/:username` הציבורי. `username` מאותחל פעם אחת מ `myUsername`. קישור השיתוף `?seller=` לא נקרא בשום מקום ולכן לא עובד, ובכשל `viewing` הישן נשאר. |

#### `apps/web/src/areas/customer/shipping/ShippingServicesPage.tsx`

המעטפת של מדור המשלוחים והשירותים, `section === 'shipping-services'`. שמונה לשוניות, `overview`, `shipping`, `in-person`, `tracking`, `shared`, `requests`, `history`, `not-accepted`, ושש קומפוננטות פנימיות. דפוס P8. שלוש לשוניות מאצילות ל `ShipmentComposer.tsx`, `HumanFulfilmentPanels.tsx` ו `SharedParcelsTab.tsx`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 60 עד 105 | `TABS`, `STATUS_TONE` לבקשות שירות, `OPEN_STATUSES` של `requested` ו `in_progress`, `MyRequest` עם `typeFields` חופשי, `Address` ו `formatAddress` | `formatAddress` מיוצא ולא נקרא בשום מקום, אפשר למחוק עם `Address`. גווני המשלוח ב `shared/shipments.ts` |
| 107 עד 150 | `ShippingServicesPage`. `useVaultItems(true)` עם שגיאה מוצגת, `shipmentsVersion` בשורה 121 שעובר כ `reloadToken`, ו `loadRequests` של `GET /services/mine` | כל יצירה מגדילה את המונה, ו `tracking`, `shared` ו `WhiteGloveQuotes` שמים אותו בתלויות. צרכן חדש חייב לזכור את זה |
| 152 עד 332 | לשוניות. `overview` עם מדדים וניווט. `shipping` מעביר `onCreated`. `in-person` מרכיב שלושה פאנלים. `tracking` מקבל את `route.params.shipment` ואת `openRecord` ו `closeRecord`, כך ש Back סוגר מגירה. `requests` ו `history` הן `RequestTable` עם ובלי callbacks | |
| 353 עד 428 | `NotAcceptedTable`, `GET /me/disposals` עם שגיאה מקומית ו Retry, והערות המפעיל כטקסט | |
| 455 עד 638 | `TrackingTab`. `GET /shipping/shipments`, סינון בלקוח עם `matchesShipmentSearch`, `selected` לפי `openId`. שורות עם `tabIndex` ו `onKeyDown` ל Enter ורווח, וכפתור Details | זו התבנית הנכונה שחסרה ב `EscrowTab`. מזהה שאינו ברשימה לא פותח מגירה |
| 641 עד 712 | `ShipmentDrawer`. מציג את שורת הרשימה בלי טעינה. effect שמביא `restockingFeeMinor` מכל `GET /shipping/services`. `cancellable` ב `requested`, `awaiting_payment`, `rates_selected`, ו `payable` ב `awaiting_payment`. `act` אחיד בשורה 688 | המצבים משקפים את `ShipmentEditService.cancel` ו `ShipmentService.pay` ידנית |
| 715 עד 809 | פרטים, תוויות תוספות `ship.addon.<key>`, והערת מכס עם `CustomsReadiness` כשהמדינה אינה `US` | ההשוואה ל `'US'` משוכפלת מ `DOMESTIC_COUNTRY` ב `carriers.ts`. עדיף שהשרת יחזיר `international` |
| 813 עד 872 | כפתור pay, `POST /shipping/shipments/:id/pay` בלי גוף, וטופס ביטול עם אזהרת restocking ב `rates_selected` | E18. בלי אישור ובלי מפתח. השרת בודק סטטוס ויתרה על עותק לפני הטרנזקציה ומעדכן לפי id בלבד, ולכן חיוב כפול אפשרי משתי לשוניות |
| 878 עד 1048 | `RequestTable`. `answerQuote` מקבל או דוחה buyout ומציג `creditedMinor`. `answerCustomQuote` שולח `accept-quote` או `decline-quote`. סכומים מ `typeFields.priceMinor` ו `offerMinor` | אין אישור ואין מפתח. ה cast ידני, שינוי שם בשרת יציג 0 דולר ועדיין יאפשר קבלה. אחרי buyout הכספת לא נטענת מחדש |
| 1072 עד 1128 | `CustomRequestRow`, שלושה שלבים עם `aria-current="step"` | |
| 1134 עד 1249 | `CustomsReadiness`, `GET /shipping/shipments/:id/customs/readiness`, אזהרות והנחיות למדינה. קישור הרשות בשורה 1237 | ה URL מגיע מקטלוג סטטי ב `shp/destinations.ts`. אם יעבור למסד, לאמת סכמה |

**שים לב.** עדכון מותנה בסטטוס ב `ShipmentService.pay` סוגר את החיוב הכפול בלי שינוי בלקוח. שדה חדש ב `toTrackingView` צריך להיכנס גם ל `ShipmentSummary` ב `shared/shipments.ts`, אחרת הוא לא נקרא, וזה בדיוק הבאג של `HumanFulfilmentPanels.tsx`.

#### `apps/web/src/areas/customer/shipping/ShipmentComposer.tsx`

לשונית `shipping`. בונה משלוח, מציג הצעת מחיר חיה, ורק אז יוצר ובוחר תעריף. שום מחיר לא נשלח מהלקוח. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 35 | `Address` ו `VaultItem` מקומיים | העתק שלישי של `Address` |
| 64 עד 97 | state של קטלוג, כתובות, פריטים ואפשרויות. `international` בשורה 88, `insuredMinor` ו `declaredMinor`, ו `signatureForced` מעל `signatureRequiredAboveMinor` שהשרת מפרסם | קלט לא תקין בביטוח הופך ל 0 בשקט. `toUpperCase` כאן אבל לא בשרת, כתובת ישנה עם `us` תסטה |
| 99 עד 114 | effect שמביא `GET /shipping/services` ו `GET /me/addresses` ובוחר ברירת מחדל | מלכודת onError |
| 116 עד 129 | `body` אחד להצעה וליצירה, עם הצהרות ביטוח ומכס, חתימה, תוספות, rush וקופסה | זה ה control, המחיר המוצג והנגבה מחושבים על אותו קלט |
| 131 עד 157 | הצעה חיה, `POST /shipping/quote` עם debounce של 350 מילישניות | מרוץ debounce. אין נזק כספי כי `selectRate` מתמחר מחדש, אבל המשתמש עלול לבחור לפי מחיר ישן. כל הצלחה מנקה גם שגיאה לא קשורה |
| 159 עד 165 | `toggleItem` ו `toggleAddOn` פונקציונליים | |
| 167 עד 200 | `commit`. `POST /shipping/shipments` שיוצר `requested` ותופס פריטים, ואז `select-rate` עם מוביל ורמה, או `choose-for-me`. תוצאה `awaiting_payment` מציגה `shortfallMinor` | כשל בבקשה השנייה משאיר משלוח יתום שתופס את הפריטים, ולחיצה חוזרת נכשלת ב `assertItemsFree`. תיקון בשמירת `created.id` וניסיון חוזר של `select-rate` |
| 202 עד 476 | `eligible`, `refused`, `blocked`, ופאנלים של פריטים, יעד, הגנה, תוספות והצעה | בשורה 338 התווית קבועה ל `ship.addon.gps_tracker`, תוספת שנייה תוצג בשם שגוי. `addOnsMinor` לא בפירוק המחיר |

**שים לב.** `POST /shipping/quote` ו `POST /shipping/shipments` מקבלים אותו `CreateShipmentDto`. שדה חובה חדש ב DTO שובר גם את ההצעה החיה. `shared/carriers.ts` הוא העתק ידני של `QuotedRate`, ושינוי שם בשרת שובר את התצוגה בשקט. תוספת חדשה בשרת דורשת תיקון שורה 338 ל `ship.addon.<key>` ומפתח תרגום.

#### `apps/web/src/areas/customer/shipping/SharedParcelsTab.tsx`

לשונית `shared`. קבוצה של משלוחים של כמה אספנים לאותה כתובת עם משלם אחד. כל אספן שומר משלוח משלו. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 33 | `GroupMember` ו `Group` | |
| 60 עד 102 | `load` של `GET /shipping/groups` ו `GET /shipping/shipments`, מועמדים רק `requested` בלי `groupId`. effect על `reloadToken`. `act` אחיד | |
| 104 עד 188 | פתיחה `POST /shipping/groups` עם `shipmentId` והערות, הצטרפות `POST /shipping/groups/join` עם `groupCode` | ה `select` לא מתאפס אחרי הצלחה ומחזיק id שכבר בקבוצה. אין בדיקת פורמט `GRP-` |
| 190 עד 272 | רשימת קבוצות עם חברים ותג משלם. lock ו cancel | הכפתורים מוצגים לכל חבר ולא רק למשלם, והשרת דוחה. הקוד לא יודע מי הצופה. `t(... as never)` עוקף בדיקת מפתח. אין כפתור leave למרות שהנתיב קיים |

**שים לב.** בשרת `GET /shipping/groups/:id` מחזיר שמות, כתובת ומשקלים של כל החברים לכל משתמש מחובר בלי בדיקת חברות. המסך לא משתמש בנתיב.

#### `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx`

שלושה רכיבים ללשונית `in-person`. איסוף בתערוכה, בקשת הצעה למסירה ביד, וקבלת הצעה. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 10 עד 14 | `VaultItem` מצומצם | הטפסים מציגים `typeClass` גולמי |
| 24 עד 149 | `ShowPickupPanel`. `GET /shipping/pickup/shows`, בחירת תערוכה פתוחה ראשונה, ו `book` ששולח `POST /shipping/pickup` עם פריטים, תערוכה והערות. העמלה מוצגת ונגבית בשרת | בשרת היתרה נבדקת בתוך הטרנזקציה. אין חלון אישור ואין מפתח. כשכל התערוכות סגורות הכפתור מושבת בלי הסבר |
| 159 עד 324 | `WhiteGlovePanel`. תשעה שדות, `useShippingCountries`, ו `request` שממיר כל `datetime-local` ל ISO ושולח `POST /shipping/white-glove`. שום דבר לא נגבה | `HandDeliveryDto` מקבל `destinationCountry` עם `MaxLength(2)` בלבד ולא `IsShippableCountry`. אם רשימת המדינות נכשלת נשלח `US` בשקט. אחרי הצלחה רק הפריטים מתאפסים. הודעת ההצלחה נופלת ל 48 שעות קבועות כש `terms` לא נטען. בדיקת חלון האיסוף והמסירה נעשית רק בשרת ב `shp/fulfilment.ts` |
| 333 עד 405 | `WhiteGloveQuotes`. מסנן `GET /shipping/shipments` לפי `fulfilmentMethod` ו `requested`, מציג `quoteMinor` וכפתור accept | `toTrackingView` בשרת לא מחזיר את השדות האלה, ולכן הפאנל לעולם לא מוצג וההצעה לא ניתנת לקבלה. התיקון הוא להוסיף את השדות ל `toTrackingView` ול `ShipmentSummary`. גם אז accept הוא E18, בדיקה ויתרה מחוץ לטרנזקציה |

#### `apps/web/src/areas/warehouse/WarehouseConsole.tsx`

המעטפת של מסך המחסן, שבע לשוניות, ושבעה רכיבים פנימיים. דפוס P8. ההרשאה נאכפת בשרת, כמעט כל נתיב מסומן `warehouse_operator` או `admin`. שני נתיבים פתוחים בכוונה, `GET /parcels/workflow/status` שמחזיר ספירות, ו `GET /shipping/shipments/:id` שבודק בעלות בשירות. שלושה סוגי מצב, מצב המעטפת, שני חוטים בין פאנלים, ומצב פנימי לכל טופס.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 1 עד 82 | imports, `Bin` עם `serialNumber`, `barcode`, `zone`, `oversized`, `active`, `itemCount`, ו `ReportRow` | ההערה בשורה 77 מיושנת, `ReportRow` הוא שורת דוח המלאי |
| 84 עד 111 | `TABS`, `overview`, `receiving`, `inventory`, `shipments`, `locations`, `services`, `support`, ו `CUT_LABEL` לארבעת חתכי הדוח | חתך חדש בשרת ב `CUTS` לא יופיע עד שיתווסף כאן ובתרגום |
| 128 עד 163 | state. `log` של עשרים שורות ו `append` ב `useCallback` יציב. `focusParcelId` מעביר חבילה מהתור לספסל. `queueVersion` משמש `key` של `ParcelQueue` | `LotsPanel` תלוי בזהות של `append`. כל הגדלה של `queueVersion` מוחקת גם טפסים פתוחים בשורות התור |
| 165 עד 188 | `loadBins` של `GET /custody/bins`. `loadSummary` של `/custody/report?cut=shelf`, `/services/queue`, `/parcels/workflow/status` במקביל | מוריד את כל תור השירותים רק כדי לספור. כשל של אחד מפיל את שלושתם |
| 190 עד 209 | `receiveParcels`, ה `onReceived` של `ReceiveParcels`. מריץ, רושם ביומן, מגדיל `queueVersion`, מרענן סיכום | בולע שגיאות ותמיד מצליח, ולכן טופס הקבלה מתנקה גם בכשל |
| 211 עד 263 | טעינה ראשונית, `stats`, `ContextTabs`, `data-density="warehouse"`, ו `ErrorState` משותף | Retry מריץ רק `loadSummary`, גם כשהשגיאה מ `loadBins` |
| 265 עד 337 | `overview`. ארבעה `MetricCard`, שש שורות דוח, יומן | חבילות `unclaimed` לא בסכום הממתינות. ליומן אין `aria-live` |
| 339 עד 405 | `receiving`. `ReceiveParcels`, `ParcelQueue` עם `key={queueVersion}` ו `onBookContents` שמציב פוקוס וגולל ל `intake-bench`, `IntakeBench`, `HouseOrdersPanel`, ויומן בתחתית | שגיאות קליטה מופיעות ביומן בתחתית העמוד, רחוק מהכפתור |
| 407 עד 461 | שאר הלשוניות. `inventory` עם ארבעה פאנלים ו `InventoryTab`, `shipments` עם `FulfillmentPanel`, `locations` עם `BinsPanel`, `services` עם `ServiceQueue` ו `GradingSubmissions`, `support` עם `SupportQueue` | מעבר לשונית מוחק גם יחידות שהוקלדו ב `IntakeBench` |
| 470 עד 611 | `InventoryTab` עם בורר חתך, `GET /custody/report?cut=` וקישור PDF. `InventoryRows` טהור עם סטטוס מדף ו `dt-wrap--stack` | אין ביטול בקשה, שינוי חתך מהיר יכול להציג שורות של חתך קודם |
| 626 עד 674 | `RelocatePanel`, `POST /custody/items/:itemId/relocate` עם `encodeURIComponent`. השרת מפענח ברקוד, סידורי או id | אין `busy`. שגיאה רק ביומן |
| 688 עד 753 | `HoldPanel`, `POST` או `DELETE /custody/items/:itemId/hold`, עם `busy` וארבע הודעות לפי `changed` | מזמין סריקת ברקוד, אבל `CustodyService.setHold` מחפש לפי `item.id` שהוא uuid. ברקוד מחזיר 400. התיקון כמו ב `RelocatePanel`, דרך `stow.resolveItem` |
| 755 עד 840 | `OpenLot` ו `LotsPanel`. `GET /intake/lots` ו `POST /intake/items/:id/break-lot` עם `busy` לשורה | אין אישור. בשרת `breakLot` בודק `lotBroken` בלי נעילה ויוצר כל פריט בטרנזקציה נפרדת עם חיוב, ולכן הרצה מקבילה מכפילה פריטים וחיובים |
| 862 עד 949 | `DisposalPanel`. פריט שהגיע ולא התקבל, `POST /intake/disposals` עם בעלים, קטגוריה, תוצאה, תיאור והערות | אין `maxLength` מול 200 ו 1000 בשרת. אין אישור, והבעלים מקבל הודעה מיד |
| 955 עד 1097 | `ShipmentDetail` ו `FulfillmentPanel`. `GET /shipping/shipments/:id`, checkboxes לפריטים, מוביל `DHL` ומשקל `500` כברירת מחדל, ו `POST .../dispatch` | בשורה 999 `scannedItemIds: detail.itemIds` שולח את מה שהשרת החזיר ולא את מה שנסרק, ולכן בדיקת ההתאמה ב `dispatch.service.ts` תמיד עוברת. השדה מקבל uuid ולא את הקוד `SHP-` המודפס |
| 1122 עד 1301 | `BinsPanel`. טופס יצירת מדף עם מתקני `primary` מ `GET /me/inbound-addresses`, `POST /custody/bins`, טבלת מדפים עם `Barcode` ו `BarcodePrintButton`, והחלפת `active` ב `PATCH /custody/bins/:binId` | הכיתוב נכנס למסמך הדפסה ב iframe באותו מקור, ו `escapeHtml` ב `shared/Barcode.tsx` הוא ה control שחייב לשרוד. אזור של רווחים בלבד יתקבל. `options` חדש בכל רינדור מקודד מחדש את כל הברקודים |

**שים לב.** הסרת `useCallback` מ `append` תגרום ל `LotsPanel` לטעון בכל רינדור. הסרת `key={queueVersion}` תשאיר את התור ישן אחרי קבלה וקליטה, וצריך במקומה פונקציית רענון. כל שינוי ב `escapeHtml` או ב `doc.write` של `printBarcodes` משפיע על כל כפתורי ההדפסה בקונסולה, בספסל, בהזמנות החנות ובניהול. שלושה טפסים מזמינים סריקה, וההחלטה לקבל כל מה שהסורק מפיק יושמה רק ב `RelocatePanel`.

#### `apps/web/src/areas/warehouse/ReceiveParcels.tsx`

טופס רישום קרטון שהגיע לדלת. מתקן, השם שעל התווית, מוביל, מעקב, הערות ותמונות. דפוס P8. השרת מחליט אם החבילה נולדת `received` או `unclaimed`, ומאמץ חבילה `expected` לפי מספר מעקב.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 56 | prop `onReceived`, `precisePointer` מ `useMediaQuery('(pointer: fine)')`, state, וטעינת `GET /me/inbound-addresses` עם בחירת primary | בכשל הטעינה ה `select` ריק והטופס חסום בלי הודעה |
| 58 עד 62 | `labelOk`, `said` שדורש מידע כלשהו, ו `ready` | אין `maxLength` מול מגבלות `ReceiveParcelDto` |
| 64 עד 92 | `receive` שולח רשומה אחת ל `POST /parcels/receive/batch` דרך `onReceived`, ומנקה הכול חוץ ממתקן ומוביל | הטופס מתנקה גם בכשל כי `receiveParcels` בולע. אם המעטפת תזרוק, צריך להוסיף כאן `catch` |
| 94 עד 184 | שדה תווית עם `autoFocus` רק כשיש עכבר, `PhotoInput` עם `purpose="parcel"`, וכפתור עם `loading` | |

#### `apps/web/src/areas/warehouse/ParcelQueue.tsx`

תור החבילות על הספסל. כל שורה מציגה רק פעולות חוקיות למצב שלה. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 43 עד 67 | props `onChanged` ו `onBookContents`, ו `load` של `GET /parcels` | בשרת `listQueue` בלי `limit` |
| 69 עד 82 | `act` מריץ, מציג הצלחה, טוען ומודיע. בשגיאה מציב `error` ולא זורק | כל `.then` אחריו רץ גם בכשל |
| 84 עד 181 | טבלה. `unclaimed` מסומן `is-alert`, בעלים או התווית הגולמית, מיקום, יחידות ומצב | |
| 187 עד 214 | `ParcelActions`, state פנימי לשורה ו `needsForwarding` | |
| 216 עד 267 | `unclaimed`. שיוך לשם משתמש ב `POST /parcels/:id/claim`, והעברה ב `POST /parcels/:id/forward` | הטופס נסגר גם כשהשיוך נכשל |
| 269 עד 349 | `expected` מציג רמז בלבד. `received` מציג העברה באתר העברה, או פתיחה עם מצב, הערות חובה ותמונות ב `POST /parcels/:id/open` | גם כאן הטופס נסגר בכשל |
| 351 עד 372 | הענף האחרון מניח `opened` ומציג Book contents | אין בדיקה מפורשת של המצב. אין כפתור ל `POST /parcels/:id/dispose`, וחבילה שאיש לא דורש נשארת בתור. כפתור כזה צריך `reason` וחלון אישור |

מכונת המצבים של החבילה מול הממשק.

| מצב בשרת | מעברים בשרת | מה הממשק מציע |
|---|---|---|
| `expected` | `received`, `disposed` | רמז בלבד, המעבר דרך טופס הקבלה |
| `received` | `opened`, `unclaimed`, `disposed` | פתיחה, או העברה באתר העברה |
| `unclaimed` | `received`, `disposed` | שיוך, והעברה באתר העברה |
| `opened` | `processed`, `disposed` | Book contents, והסגירה ב `IntakeBench` |

אין מצב `busy` בכפתורים. השרת נועל את החבילה ובודק מעבר, ולכן לחיצה כפולה מחזירה 409 בלי נזק.

#### `apps/web/src/areas/warehouse/IntakeBench.tsx`

ספסל הקליטה. קרטון פתוח הופך לפריטים בכספת. בוחרים חבילה, הבעלים ננעל, שורה לכל יחידה, מדף מוצע או סרוק, קליטה, תוויות, וסגירת החבילה. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 58 | `StowSuggestion`, `UnitDraft` עם `key` מקומי, ו `blankUnit` עם מונה `seq` ברמת המודול | ה `key` מונע שיוך שגוי של state אחרי מחיקת שורה |
| 78 עד 124 | props `initialParcelId`, `onLog`, `onDone`, `onParcelClosed`, שלוש קבוצות state, ו `loadParcels` שמשאיר `opened` עם בעלים | אותה רשימה נטענת גם בתור, פעמיים בכל כניסה |
| 126 עד 148 | effect שמציב את החבילה מ `initialParcelId` וטוען מחדש, ו effect שמעתיק את בעלי החבילה | מגיב רק לשינוי ערך. לחיצה חוזרת על אותה חבילה אחרי בחירה ידנית באחרת לא מחזירה אליה, וקליטה הולכת לחבילה הלא נכונה |
| 150 עד 162 | `facilityCode` מהחבילה, `single`, `lotAllowed` ליחידה אחת, `lotWillSplit`, `oversized` | |
| 164 עד 222 | `askForBin` של `GET /custody/bins/suggest` לפי מתקן וגודל, ו `createBinHere` שיוצר מדף מתוך הספסל | במצב אוטומטי נשלח `autoStow: true` והשרת בוחר מדף מחדש לכל יחידה. המדף המוצג הוא הערכה, והמדף האמיתי רק על התווית |
| 224 עד 274 | ולידציה, `patch` פונקציונלי, ו `submit` ששולח את כל היחידות ל `POST /intake/items/batch` עם `binId` או `autoStow`, ו `isLot` רק ליחידה אחת | בשרת כל יחידה בטרנזקציה משלה. כשל באמצע משאיר את כל היחידות בטופס, ולחיצה חוזרת קולטת ומחייבת שוב. אין idempotency. לוט שמתפצל מצמיד תיאור רק לפריט הראשון |
| 276 עד 298 | `closeParcel` שולח `POST /parcels/:id/process` עם `emptyReason`, שמעביר ל `processed` וגובה `parcel_processing` | כסף בלי חלון אישור |
| 300 עד 548 | בורר חבילה, בעלים, מצב אחסון, הצעת מדף או סריקה, שורות יחידות עם `PhotoInput` ותיבת לוט, ושורת סגירה | `stowError` בלי `role="alert"`. שדה גודל לוט קופץ ל 1 תוך כדי הקלדה |
| 550 עד 587 | תוויות עם הדפסה בודדת ו `BarcodePrintAllButton` | נמחקות במעבר לשונית |

**שים לב.** שמות `autoStow`, `binId` ושדות היחידה חייבים להתאים ל `IntakeItemDto`, כי `forbidNonWhitelisted` דוחה שדה לא מוכר.

#### `apps/web/src/areas/warehouse/ServiceQueue.tsx`

תור בקשות השירות. אישור או דחייה של בקשה חדשה, וטופס סגירה לפי סוג לבקשה פעילה. דפוס P8. כל הנתיבים ב `dis.controller.ts` עם `warehouse_operator` או `admin`.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 20 עד 37 | `STATUS_TONE` ו `QueueItem` עם `typeFields` חופשי ו `requesterEmail` | כתובת הדואר של הלקוח מוצגת לכל מפעיל. הסרה דורשת שינוי גם בשאילתה בשרת |
| 46 עד 128 | `ServiceQueue`, `GET /services/queue`, `act` וטבלה | בלי עימוד |
| 130 עד 168 | `QueueActions`. ב `requested` accept או deny ב `POST /services/requests/:id/accept` ו `/deny`. אחרת טופס לפי הסוג | דחייה בלי סיבה ובלי אישור. `POST /services/custom/:id/decline` עם סיבה קיים ולא בשימוש |
| 179 עד 282 | `InspectionFulfillment`. אזורים מ `typeFields.areas`, מצב ראשוני `clean`, אימות, הערה כללית והערה לכל אזור, `POST /services/inspection/:id/complete` | ה hooks נקראים לפני ה return המוקדם בשורה 195, לשמור על הסדר |
| 289 עד 431 | `FieldSpec` ו `FORMS`, טבלה מסוג בקשה לנתיב, הודעה ושדות עם `kind` ו `initial` | שמות השדות הם חוזה עם ה DTO ואין בדיקת טיפוס. ערכי התחלה מסוכנים, buyout 100.00, custom 25.00, consignment מכירה 1000.00 בערוץ eBay. buyout ו custom הם טפסי הצעה והבקשה נשארת `in_progress` |
| 433 עד 535 | `FulfillmentForm` בונה state מ `spec.fields`, בודק כל שדה, ממיר כסף לסנטים ושולח | אין `busy`. בטופס הצעה לחיצה כפולה שולחת שתי הצעות |

**שים לב.** הממשק מכיר רק `requested` ואת כל השאר, ולא את `typeFields.stage`. בקשת custom אחרי שהלקוח אישר ושילם עדיין מציגה טופס הצעה. הצעה חוזרת מחזירה `stage` ל `quoted` ומאפשרת ללקוח לשלם שוב, ואין בממשק קריאה ל `POST /services/custom/:id/complete`. התיקון הוא בחירת טופס לפי `stage`, וחסימה בשרת של הצעה שלא בשלב המתאים.

**איך מוסיפים סוג שירות.** רשומה ב `FORMS` עם הנתיב, מפתח הודעה, ושדות ששמותיהם זהים ל DTO בשרת, כי `forbidNonWhitelisted` דוחה שדה עודף ושדה חסר נכשל בולידציה. שדה כסף מקבל `kind: 'money'` ונשלח בסנטים. כדאי ערך התחלה ריק, כדי שהבדיקה תחסום שליחה בלי הקלדה. סוג עם שלבי הצעה ואישור צריך גם בחירת טופס לפי `stage`.

#### `apps/web/src/areas/warehouse/GradingSubmissions.tsx`

אצוות של כרטיסים למדרג חיצוני. פתיחה לגוף דירוג, הוספת בקשות מוכנות, שליחה עם מעקב, וסגירה. שליחה מעבירה את כל הכרטיסים ל `at_grader`. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 17 עד 37 | `Submission` ו `ReadyRequest` | |
| 51 עד 108 | `GradingSubmissions`, `GET /services/grading/submissions`, ופתיחה ב `POST` עם גוף דירוג שמתחיל `PSA` | גוף דירוג הוא מחרוזת חופשית, `psa` ו `PSA` הן שתי אצוות |
| 110 עד 186 | טבלה, ניהול לאצווה פתוחה, וסגירה ב `/:id/close` לאצווה שנשלחה | `OpenSubmission` בלי `key`, מצב ישן בלי key, ומספר מעקב של אצווה קודמת נשלח עם הבאה. התיקון `key={openId}` |
| 196 עד 259 | `OpenSubmission`. `loadReady` לפי גוף דירוג, `add` ב `/:id/add`, ו `ship` ב `/:id/ship` עם מעקב, מזהה חיצוני והערות | `add` בלי `busy`. שליחה בלי חלון אישור ולא הפיכה מהממשק |
| 261 עד 327 | רינדור האצווה, רק מה שעוד יכול להיכנס | ההערה בשורה 189 מבטיחה הצגה של מה שכבר באצווה, והקוד לא מציג. אין לכך נתיב בשרת |

#### `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx`

תור עותקים שנקנו בחנות הבית. הפריט כבר נוצר במצב `received` על שם הקונה, והמפעיל רק מתייג ומניח על מדף. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 12 עד 51 | `HouseOrderRow`, state ו `load` של `GET /marketplace/house/orders/queue` | `orders` מתחיל כמערך ריק ולא `null`, ובזמן טעינה מוצג שאין הזמנות |
| 53 עד 85 | כותרת עם ספירה, `BarcodePrintAllButton`, שגיאה, ורשימה | השגיאה בלי `role="alert"` |
| 87 עד 119 | `HouseOrderRowView` ו `stow`, `POST .../orders/:id/stow` עם `binId` או `autoStow: true` ומפתחות תמונות | בשרת נעילה `for('update')` ובדיקת `awaiting_stow` מונעות הנחה כפולה, והפריט עובר ל `stored`. המדף שנבחר אוטומטית מופיע רק ביומן בתחתית |
| 121 עד 165 | שורה עם תמונת קטלוג, סידורי, קונה, `BarcodeLabel`, שדה מדף ו `PhotoInput` | לא מחובר ל `loadSummary`, ספירת המלאי בסקירה לא מתעדכנת |

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/warehouse/SupportQueue.tsx` | תור פניות לצוות מ `GET /support/queue`, ממוין בשרת לפי המתנה. take שולח `POST /support/tickets/:id/assign`, שבשרת דורס בעלים קודם בלי תנאי. השרשור נפתח ב `ThreadDrawer` של הלקוח עם `staff`, לפי פרמטר `ticket` בכתובת. לקוח מושעה מסומן בתג. |

#### `apps/web/src/areas/admin/AdminConsole.tsx`

המעטפת של קונסולת הניהול, תשע לשוניות, `App.tsx` מרנדר אותה רק ל `admin`. כל `adm.controller.ts` מסומן `@Roles('admin')` ברמת המחלקה. הקובץ מכיל בעצמו משתמשים, פריטים, תמחור, מחלוקות וחיובי אחסון, והשאר בקבצים שכנים. דפוס P8 עם עריכה בתוך שורת טבלה, בלי חלון אישור ובלי רענון אחרי שמירה. שתי שכבות, מסכים שהשרת מאמת ומתעד, ועריכה ישירה של `role`, `status`, `ownerId` ו `lifecycleState` שעוקפת את מכונת המצבים בכוונה.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 28 עד 72 | `AdminUser` עם `intakeId` לקריאה ו `nameReviewRequired`, `AdminItem`, והעותקים הידניים `ROLES`, `STATUSES`, `STATES` | `STATES` חסר `at_grader` ו `discarded`. הוספה מחייבת לשנות יחד את `UpdateItemDto` ו `ItemPatch` בשרת |
| 74 עד 94 | `TABS` עם `yield` ראשונה, ו `TAB_LABEL` | |
| 104 עד 139 | prop `currentUserId`, state, ו `load` של `GET /admin/users` ו `GET /admin/items` במקביל בכל כניסה | בשרת בלי `limit`, כל הכספת יורדת לדפדפן. כשל אחד מאפס את שתי הרשימות |
| 141 עד 280 | `ContextTabs`, `SuccessNote` ו `ErrorState` משותפים, ולשונית פעילה בתוך `TabPanel` | `message` לא מתאפס לעולם, ושתי הודעות סותרות יכולות להופיע יחד. Retry טוען משתמשים ופריטים גם לשגיאת תמחור |
| 286 עד 401 | `UserRow`. שם משתמש כטקסט כי הוא קבוע בטריגר של מיגרציה 0004. `save` שולח `PATCH /admin/users/:id` עם `firstName`, `role`, `status` תמיד, ו `lastName` רק אם לא ריק | כל שמירה מאפסת `nameReviewRequired` גם בלי שינוי שם. משתמש בלי שם פרטי לא ניתן לשמירה. מחיקת שם משפחה לא נשלחת. אחרי שמירה התג מציג סטטוס ישן. הענקת `admin` והשעיה בלחיצה אחת. השרת מונע מנהל שמשעה את עצמו. ה audit לא רושם את ה body |
| 407 עד 516 | `ItemRow`. שישה שדות, `save` שולח את כולם ל `PATCH /admin/items/:id`. בשרת `updateItem` נועל, בודק `typeClass`, וכותב `item_change_history` ואירועי custody עם `reason: 'admin edit'` | השירות לא בודק מעברים ולא נוגע בשוק או במשלוחים. פריט ב `at_grader` או `discarded` מוצג כ `received` וכל שמירה נדחית ב 400. `conditionGrade` של `null` נשלח כמחרוזת ריקה ומלכלך היסטוריה. `ownerId` לא נבדק בשרת ואין foreign key |
| 522 עד 766 | `PricingSection`. `GET /pricing/rules`, טופס עם חמישה `ACTION_TYPES`, ו `POST /pricing/rules`. `percentToBasisPoints` בשורות 760 עד 766 | כלל חדש בתוקף מיד ודוחק את הקודם, בלי עריכה, מחיקה או `effectiveTo`. אין תקרה על אחוז. `itemClass` חופשי ושגיאת כתיב יוצרת כלל מת. אחוז על פעולה בלי בסיס נותן אפס. `GET /pricing/rules` פתוח לכל מחובר |
| 772 עד 987 | `DisputesSection` ו `DisputeRow`. מחלוקות ועסקאות במקביל, פתיחה ב `POST /admin/disputes`, ועדכון סטטוס ופסיקה ב `PATCH` | פסיקה לא מזיזה כסף, זו רשומה בלבד. אפשר לפתוח כמה מחלוקות לאותה עסקה, ולא ניתן למחוק פסיקה |
| 993 עד 1071 | `StorageFeesSection`, טבלת ריצות מ `GET /admin/storage-fee-runs` | אין הפעלה ידנית, בכוונה |

**שים לב.** שליחת השדות שהשתנו בלבד ב `UserRow` וב `ItemRow` הייתה סוגרת את שלוש הבעיות של איפוס הסימון, המחרוזת הריקה והמצבים החסרים.

**איך מתקנים כלל תמחור שגוי.** אין עריכה ואין מחיקה. מוסיפים כלל חדש לאותה פעולה ואותו סוג פריט, והוא דוחק את הקודם מהרגע הזה. חיובים שכבר נוצרו שומרים snapshot של הכלל ולא משתנים, וצריך לטפל בהם ידנית. פעולות כמו `parcel_processing`, `storage_oversized`, `shipping_rush`, `cash_out_fee`, `escrow_fee` ו `show_pickup` לא נמצאות ב `ACTION_TYPES` ולא ניתנות לתמחור מהקונסולה.

#### `apps/web/src/areas/admin/WalletRequestsSection.tsx`

בקשות הפקדה ומשיכה. תור מסונן, מגירה עם פרטים והיסטוריה, וכפתורים רק למעברים החוקיים. כל הנתיבים ב `pay/wallet-request.controller.ts` עם `@Roles('admin')`. הקובץ הרגיש ביותר כספית, והשרת עושה כאן את רוב העבודה נכון. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 27 עד 47 | `reviewerActions`, פונקציה טהורה ממצב לפעולות, מיוצאת לבדיקה `tests/web/wallet-requests.test.ts` | תואמת היום את `WALLET_REQUEST_TRANSITIONS` ב `wallet-request.rules.ts`. שינוי בשרת לא ייתפס בקומפילציה |
| 66 עד 106 | props `currentUserId`, `onMsg`, `onError`, state, ו `load` של `GET /admin/wallet-requests` עם ארבעה מסננים | אין ביטול בקשה. `to` מתפרש בשרת כחצות UTC ומוציא את היום שנבחר |
| 108 עד 140 | `openDetail`, ו `act` ששולח `POST /admin/wallet-requests/:id/<action>`, מרענן רשימה ומגירה | `finally` מוחק את סיבת הדחייה גם בכשל. בשרת כל מעבר בטרנזקציה עם `for('update')`, בדיקת מעבר והפרדת תפקידים |
| 142 עד 251 | מסננים וטבלה | |
| 253 עד 313 | המגירה עם `isOwnRequest` כהסבר בלבד, וחלונות אישור ל reject ול complete | `onCancel` inline, קפיצת פוקוס אחרי כל תו בשדה הסיבה. חובת הסיבה עוברת כ `busy` בשורה 286 ולכן גם ביטול מושבת. `aria-describedby` מצביע על מזהה שלא קיים. התיקון הנכון ב `DetailDrawer.tsx`, `onCancel` ב ref ו `confirmDisabled` נפרד |
| 318 עד 438 | `WalletRequestDrawer`. ללא פעולות לבקשה של המנהל עצמו. review, approve, processing מיידיים. פרטים, `settledLedgerId` כהוכחה שרק complete הזיז כסף, והיסטוריה | `documentKey` מוצג כטקסט ואין דרך לפתוח את המסמך |

**שים לב.** reject ו complete הן הפעולות היחידות עם חלון אישור, ו complete היא היחידה שמשנה יתרה. בשרת `complete` נועל את הבקשה, וזה מה שמונע שני רישומי ledger משני מנהלים. מצב חדש ב `WALLET_REQUEST_TRANSITIONS` מחייב עדכון של `reviewerActions` ושל `WALLET_REQUEST_STATUSES` ב `shared/walletRequests.ts`. תיקון מסנן התאריך לשימוש ב `lt` של היום הבא ישפיע על כל קורא של `listForReview`.

#### `apps/web/src/areas/admin/HouseStoreSection.tsx`

ניהול חנות הבית. יצירת מוצר, מלאי, והורדה מהמכירה. התיאור הופך מילה במילה לתיאור כל פריט שנמכר. נתיבים ב `house-store.controller.ts` עם `admin`. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 11 עד 58 | `HouseListingRow`, state ו `load` של `GET /marketplace/house/manage` | |
| 60 עד 85 | `cents`, `copies`, `ready`, ו `create` של `POST /marketplace/house/listings` | אין `busy`. לחיצה כפולה יוצרת שני מוצרים עם מלאי מלא כל אחד. ל `photoRef` אין בדיקת תבנית בלקוח |
| 87 עד 95 | `patch` של `PATCH .../listings/:id` עם `stock` או `status` | הנתיב מקבל גם `askingPrice`, והממשק לא מציע |
| 97 עד 204 | טופס וטבלה. שדה מלאי לא נשלט עם `defaultValue`, שולח ב `onBlur` רק כשהערך השתנה. כפתור active או removed | המלאי נקבע כערך מוחלט מתצוגה ישנה בזמן שקניות מורידות אותו, ונמכרים עותקים שאין. בכשל השדה ממשיך להציג את מה שהוקלד |

#### `apps/web/src/areas/admin/ShelfYieldPanel.tsx`

הלשונית הראשונה. איזה מדף, אזור ולקוח מכניסים מעט ביחס למקום שהם תופסים. הכנסה ולא רווח. דפוס P8.

| שורות | מה הבלוק עושה | שים לב |
|---|---|---|
| 32 עד 78 | `ShelfRow`, `ZoneRow`, `CustomerRow`. המדד `revenuePerSlotMonthMinor` ו `deadItemCount` | בשרת המדד הוא הכנסה לפריט לחודש. התווית בעברית ב `yield.col.perSlotMonth` אומרת לחודש מדף. תיקון התווית משפיע גם על ציר `YieldChart` |
| 88 עד 102 | `YieldCell`, מספר ופס ביחס לטוב ביותר עם מינימום 2 אחוז | |
| 104 עד 138 | `load` של `GET /admin/shelf-yield`, `/zones`, `/customers` במקביל, ו `occupied`, `bestShelf`, `bestCustomer` | `byZone` בשרת מחשב שוב את כל המדפים |
| 140 עד 240 | ארבעה כרטיסים, וטבלת מדפים תפוסים בסדר השרת, הגרוע ראשון. דגל של פריטים מתים או יותר מ 180 יום | `toLocaleString` בלי locale. הסף 180 קבוע בלקוח |
| 242 עד 314 | `YieldChart` וטבלת אזורים | הפסים בטבלה מחושבים ביחס ל `bestShelf`, ולא תואמים את הגרף שמעליה. אזורים ריקים בלי `EmptyState` |
| 316 עד 375 | טבלת לקוחות ביחס ל `bestCustomer` | |

| קובץ | מה הוא עושה |
|---|---|
| `apps/web/src/areas/admin/SignInsSection.tsx` | יומן ניסיונות כניסה מ `GET /admin/logins`. שלושה כרטיסים, טבלת מזהים עם חמישה כשלונות לפחות ביממה, וכל הניסיונות. בשגיאה מציג אפסים כאילו אין תקיפה. הקיבוץ לפי מזהה מנורמל ולא לפי `userId`. `OUTCOME_*` מוקלדים כ `Record` ומחייבים עדכון. |
| `apps/web/src/areas/admin/YieldChart.tsx` | גרף עמודות SVG של תשואה לפי אזור, נופל להכנסה כשאין עדיין יחס. מסמן את האזור התפוס החלש. ה SVG `aria-hidden` והתוויות `div` מחוצה לו, ולכן `rowHeight` חייב להתאים ל CSS של `chart-row`. |

## פרק העבודה. איך עובדים על הקוד

### סקירה

הפרק הזה הוא אחד עשר מתכונים לעבודה יומיומית. כל מתכון אומר אילו קבצים לפתוח ובאיזה סדר, אילו פקודות להריץ, איפה נופלים, ואיך מוכיחים שהשינוי עובד. כל פקודה, סקריפט, משתנה סביבה ונתיב נבדקו מול הקוד. המתכונים מניחים שקראתם את פרק הדפוסים, ולכן הם כותבים `דפוס P3` ולא מסבירים אותו שוב.

שלוש מוסכמות לכל הפרק.

- הפקודות רצות משורש הריפו, אלא אם כתוב `cd`.
- `DB` הוא משתנה של ה shell שלכם לחיבור ישיר ל Postgres. ה shell לא קורא את `.env`, ולכן מגדירים אותו פעם אחת.
- מספרי ממצאים כמו E1 מפנים לפרק הממצאים של DIVE2.

```bash
export DB=postgres://bault:bault@localhost:5432/bault
```

שלושה דברים שהמקורות הקודמים טעו בהם, ונבדקו כאן מול הקוד. `pnpm dev` לא מעלה את ה worker. ה DTO של ה API נכתבים ב class-validator ולא ב zod, ו zod משמש רק את `packages/config/src/env.ts`. `pnpm test` מאפס את המסד בסוף ההרצה, לא בתחילתה.

### מתכון 1. הרמה מקומית מאפס

**מה צריך על המחשב.** Node 22.22.2 ומעלה או 24.15 ומעלה, לפי `engines` ב `package.json`. pnpm 9.15.0 דרך corepack. Docker בשביל Postgres, PgBouncer ו MinIO. psql בשביל כל שאר המתכונים.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

1. ערכו את `.env`. ארבעה ערכים חייבים לזוז מ `.env.example`.

```bash
PAYMENT_PROVIDER=sandbox
DATABASE_URL=postgres://bault:bault@localhost:5432/bault
AUTH_RATE_LIMIT_PER_MINUTE=5000
RATE_LIMIT_PER_MINUTE=20000
```

- `PAYMENT_PROVIDER` בקובץ הדוגמה הוא `paypal`. ה `superRefine` ב `packages/config/src/env.ts` שורות 326 עד 329 דורש אז `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` ו `PAYPAL_WEBHOOK_ID`, ובלעדיהם ה API, ה worker, ה migrate וה seed נופלים כבר בטעינה.
- `DATABASE_URL` בקובץ הדוגמה מצביע על PgBouncer בפורט 6432. זה מדמה את הייצור, אבל אם PgBouncer לא עולה או נכשל באימות, הכי פשוט להצביע על 5432 כמו ה CI. `DIRECT_DATABASE_URL` נשאר על 5432 תמיד, כי ה migrate וה worker צריכים חיבור אמיתי.
- מגבלות הקצב. ב `@nestjs/throttler` 6.5.0 שני הדליים בעלי השם חלים על כל handler, וב `.env.example` הדלי `auth` הוא 10 לדקה. כלומר כל מסך שנטען יותר מעשר פעמים בדקה מאותו IP מקבל 429, וכל חבילת בדיקות נופלת. ה CI משתמש ב 5000 ו 20000.
- `SESSION_COOKIE_SECRET` בקובץ הדוגמה ארוך מ 16 תווים, ולכן עובר בפיתוח.
- `EXPOSE_API_DOCS=true` בקובץ הדוגמה. בפיתוח זה שימושי, Swagger עולה על `http://localhost:3000/docs`. כל ערך לא ריק נקרא כ true, גם `false`, וזה E7.
- `NODE_ENV=development` נותן שורות לוג קריאות. כל ערך אחר נותן JSON.

2. הבינו מאיפה נקרא `.env`. `loadDotenvFromRoot` ב `env.ts` שורות 12 עד 25 עולה מה cwd עד שש רמות ולוקח את ה `.env` הראשון שמצא. קובץ `.env` בתוך `apps/api` או `apps/worker` יסתיר את זה שבשורש. `apps/web/.env` נקרא רק על ידי Vite, ורק כדי לדרוס את `VITE_API_PROXY_TARGET`.

3. העלו את התשתית.

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

השירותים הם `postgres` על 5432, `pgbouncer` על 6432, ו `minio` על 9000 עם קונסולה על 9001. המשתמש והסיסמה של Postgres הם `bault`. של MinIO הם `minioadmin`.

4. צרו bucket, רק אם אתם רוצים אחסון אמיתי. ברירת המחדל `STORAGE_PROVIDER=sandbox` מקבלת תמונות וזורקת אותן. כדי לעבוד כמו ה CI, קבעו `STORAGE_PROVIDER=s3` וצרו את ה bucket. `S3StorageAdapter` ב `packages/adapters/src/s3.ts` לא יוצר bucket בעצמו.

```bash
docker compose -f infra/docker-compose.yml exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose -f infra/docker-compose.yml exec minio mc mb --ignore-existing local/bault-images
curl -sf http://localhost:9000/minio/health/live && echo minio-ok
```

5. בנו את החבילות המשותפות. ה API וה worker מייבאים את `@bault/config` ו `@bault/adapters` מתוך `dist`. סקריפטי ה dev בונים את שתיהן פעם אחת בעלייה, אבל ה watch לא עוקב אחריהן.

```bash
pnpm --filter "./packages/*" build
```

6. הריצו migrations ו seed.

```bash
pnpm --filter @bault/api db:migrate
pnpm --filter @bault/api db:seed
```

`db:migrate` מריץ את `tsx src/db/migrate.ts` מתוך `apps/api`, מחיל כל רשומה ב `src/db/migrations/meta/_journal.json`, ואחר כך את `src/db/sql/0001_append_only.sql`. `db:seed` הוא גם `pnpm db:reset` בשורש. הוא מתחיל ב `TRUNCATE` של כל הטבלאות, כולל טבלאות ההיסטוריה ו `pgboss.job`, ואין לו שום בדיקה של `NODE_ENV`, וזה E11. בלי seed אין שורות ב `pricing_rule`, וכל פעולה שמתומחרת נכשלת, וזה E6.

7. העלו את ה API ואת ה SPA.

```bash
pnpm dev
```

`scripts/dev.mjs` בודק שהפורט פנוי, מעלה את `pnpm --filter @bault/api dev`, מחכה עד 120 שניות ל `GET /api/v1/healthz`, ורק אז מעלה את Vite על 5173. אם ה API נופל, גם Vite נעצר. הוא לא מעלה את ה worker.

8. העלו את ה worker בטרמינל שני.

```bash
pnpm dev:worker
```

בעלייה הוא מדפיס `[worker] registered <name> (<cron>)` לכל אחד משמונה ה jobs, ואחר כך `[worker] started`. אפשר גם להעלות כל תהליך לבד, `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:worker`.

**חשבונות ה seed.** הסיסמה של כולם `11111111`. מתחברים בשם משתמש או במייל.

| משתמש | תפקיד | הערה |
|---|---|---|
| `eldar` | admin | המנהל הראשי |
| `hermon` | warehouse_operator | המחסן |
| `red`, `golden`, `veteran` | user | אספנים עם פריטים ויתרות |
| `platform` | admin | הבעלים של פריטים שנתרמו או נקנו על ידי Bault |
| `dana` | user | מושעה, מגיע רק לתמיכה |

**איך מוכיחים שהכל עובד.**

```bash
curl -s http://localhost:3000/api/v1/healthz        # {"status":"ok"}
curl -s http://localhost:3000/api/v1/readyz         # {"status":"ok","db":true}
curl -s -c /tmp/c.txt -H 'content-type: application/json' \
  -d '{"identifier":"red","password":"11111111"}' http://localhost:3000/api/v1/auth/login
curl -s -b /tmp/c.txt http://localhost:3000/api/v1/me/profile
psql "$DB" -Atc "select count(*) from pg_trigger where tgname like 'trg_append_only_%'"   # 10
psql "$DB" -Atc "select name from pgboss.schedule order by name"                          # 8 jobs
```

אחר כך פתחו את `http://localhost:5173`, התחברו כ `red`, וראו את הכספת.

**מלכודות.**
- `[dev] port 3000 is already in use` אומר ש `pnpm dev` קודם נסגר עם סגירת טרמינל ולא עם Ctrl-C. הסקריפט מדפיס את הפקודה שמשחררת את הפורט.
- Vite מדפיס בעלייה `[vite] /api → <target> (from <source>)`. זו השורה הראשונה לבדוק כשהדפדפן מראה `api_unreachable`.
- ה Dockerfiles משתמשים ב `node:20-slim`, בעוד `engines` דורש 22 ומעלה. בפיתוח זה לא משנה, אבל אל תבנו סביבה מקומית מה image.

**איפוס מלא.** `docker compose -f infra/docker-compose.yml down -v` מוחק גם את ה volumes `pgdata` ו `miniodata`. אחריו חוזרים לצעד 3. איפוס של הנתונים בלבד הוא `pnpm db:reset`.

### מתכון 2. הרצת כל חבילת בדיקות

ההגדרה של שמונה החבילות נמצאת ב `vitest.workspace.ts`. ארבע לא צריכות כלום. ארבע מדברות עם API חי ב HTTP, ודרכו עם מסד שעבר migrate ו seed.

| חבילה | קבצים | צריכה | פקודה |
|---|---|---|---|
| `web` | `tests/web/**/*.test.ts` | כלום, סביבת node | `pnpm test:web` |
| `ux` | `tests/ux/**/*.test.tsx` | כלום, jsdom, ה API מוחלף ב `vi.mock` | `pnpm test:ux` |
| `contract` | `tests/contract/**/*.test.ts` | כלום, חוץ מ `storage-adapter.test.ts` שצריך MinIO ו bucket | `pnpm test:contract` |
| `core-contract` | `tests3/contract/**/*.test.ts` | כלום | `pnpm test:core-contract` |
| `integration` | `tests/integration/**/*.test.ts` | API חי, seed טרי | `pnpm test:integration` |
| `core` | `tests3/integration/**/*.test.ts` | API חי, seed טרי | `pnpm test:core` |
| `concurrency` | `tests/concurrency/**/*.test.ts` | API חי, seed טרי | `pnpm test:concurrency` |
| `property` | `tests/property/**/*.test.ts` | API חי, seed טרי | `pnpm test:property` |

**איך החבילות שתלויות במסד מגיעות ל API.** `tests/integration/helpers/http.ts` שולח בקשות ל `API_URL`, ברירת מחדל `http://localhost:3000/api/v1`. הוא מתחבר עם `signIn`, מממן ארנק דרך המסלול האמיתי של בקשת cash in ואישור מנהל ב `fundWallet`, וקולט פריט ב `intakeFor`. אין גישה ישירה למסד מהבדיקות. `tests/integration/dev-proxy.test.ts` בודק גם את Vite דרך `WEB_URL`, ומדלג אם הוא לא רץ.

**הסדר הנכון, עם seed טרי לפני כל חבילה, וזה E16.**

1. ודאו שב `.env` המגבלות הן 5000 ו 20000, אחרת `signIn` יקבל 429.
2. העלו API. או `pnpm dev:api`, או כמו ה CI.

```bash
pnpm --filter @bault/api build
node apps/api/dist/main.js &
until curl -sf http://localhost:3000/api/v1/readyz >/dev/null; do sleep 1; done
```

3. הריצו את החבילות שלא צריכות מסד.

```bash
pnpm test:web && pnpm test:ux && pnpm test:contract && pnpm test:core-contract
```

4. הריצו כל חבילה שתלויה במסד אחרי seed משלה.

```bash
for p in integration core concurrency property; do
  pnpm --filter @bault/api db:seed
  pnpm exec vitest run --no-file-parallelism --project "$p" || break
done
```

5. קובץ אחד או בדיקה אחת.

```bash
pnpm --filter @bault/api db:seed
pnpm exec vitest run --project core tests3/integration/fin-invariants.test.ts
pnpm exec vitest run --project integration tests/integration/mkt-purchase.test.ts -t 'self-dealing'
```

**למה seed לפני כל חבילה.** הבדיקות יוצרות נתונים אמיתיים על חשבונות ה seed. בקשת משיכה פתוחה מהרצה קודמת, יתרה שזזה, או מודעה שנמכרה, משנות את התוצאה של הבדיקה הבאה. ההוכחה ב E16 היא `fin-invariants`, שנכשל ב 409 אחרי הרצה קודמת ועובר על seed טרי. ה CI עושה seed אחד לפני ארבע החבילות, ולכן סדר שונה או הרצה כפולה יכולים להיכשל שם.

**`pnpm test` ו `pnpm test:seeded`.** `pnpm test` מריץ את `scripts/test.mjs`. הוא מריץ את שמונה החבילות בסדר web, ux, contract, core-contract, integration, core, concurrency, property, ונעצר בכשל הראשון. הוא לא עושה seed בהתחלה. בסוף, גם אחרי כשל, הוא מריץ `db:seed` כדי להחזיר את הקטלוג, כלומר הוא מוחק את נתוני הפיתוח שלכם. `--no-reset` או `BAULT_TEST_NO_RESET=1` מבטלים את האיפוס. `pnpm test:seeded` מריץ migrate, seed, ואז `pnpm test`. אל תריצו `pnpm test:all-parallel` מול מסד, הוא מריץ את כל הפרויקטים במקביל על אותם חשבונות.

**מלכודות.**
- ה API חייב לרוץ עם אותו `.env`. הבדיקות לא קוראות `.env`, רק `API_URL` ו `WEB_URL`.
- מוני ה throttler נשמרים בזיכרון של ה API. אחרי 429, הפעלה מחדש של ה API מאפסת אותם.
- `tests3/integration/receiving-bench.test.ts` מעלה תמונות. עם `STORAGE_PROVIDER=s3` בלי bucket, תשעה מבחנים נופלים ב 500, וזה E10. עם `sandbox` הם עוברים.
- `storage-adapter.test.ts` מדלג בקול כש MinIO לא זמין. דילוג הוא לא מעבר.
- חבילות `contract` ו `core-contract` טוענות את `@bault/adapters` מ `src` דרך alias ב `vitest.workspace.ts`. הן יעברו גם כש `dist` ישן, וה API עדיין ירוץ עם הקוד הישן.
- בדיקות `ux` מחליפות את `apps/web/src/shared/api` ב `vi.mock`, ולכן הן לא מוכיחות שה route קיים בשרת.

**איך מוכיחים.** כל חבילה מסיימת ב `Test Files ... passed`. ריצה שנייה של אותה חבילה אחרי seed נוסף חייבת לתת אותה תוצאה. אם לא, יש בבדיקה תלות במצב.

### מתכון 3. מעקב אחרי בקשה אחת מקצה לקצה

**הדרך שבקשה עוברת.** הדפדפן שולח ל `/api/v1/...` על 5173. Vite מעביר ל API עם `X-Forwarded-For`. ב API, לפי הסדר, `requestContext` ב `main.ts` שורה 47 קובע מזהה בקשה, helmet, מפרסר JSON עד 16MB, שלושת ה guards מ `app.module.ts` שורות 98 עד 100, `ThrottlerGuard`, `SessionAuthGuard`, `RolesGuard`, אחר כך `ValidationPipe` משורה 131, ה controller, ה service, ובסוף `AuditInterceptor` כשהבקשה הצליחה או `AllExceptionsFilter` כשנזרקה שגיאה. עבודה אסינכרונית ממשיכה ב worker דרך `outbox_message`.

1. **קבלו את מזהה הבקשה.** כל תשובה מכילה כותרת `x-request-id`. בדפדפן, בלשונית Network של כלי המפתחים. ב curl, `-i`. אפשר לשלוח מזהה משלכם, ו `requestContext` ישתמש בו, עד 200 תווים.

```bash
curl -si -b /tmp/c.txt -H 'x-request-id: dbg-001' \
  -X POST http://localhost:3000/api/v1/marketplace/listings/<listingId>/purchase | head -20
```

2. **קראו את גוף השגיאה.** כל שגיאה חוזרת במעטפת `{"error":{"code","message","details"}}`. הקודים ב `apps/api/src/shared/errors/error-codes.ts`. ב SPA, `apps/web/src/shared/api.ts` הופך אותה ל `ApiError` עם `kind` לפי הסטטוס, ו `api_unreachable` הוא הקוד ש Vite מחזיר כשאין API.

3. **חפשו בלוג.** אין access log. נרשמות רק אזהרות ושגיאות. שגיאת `AppError` ב 4xx לא נרשמת בכלל, ואת הסיבה שלה רואים רק בגוף התשובה. 500 נרשם עם stack מ `AllExceptionsFilter`. ב `NODE_ENV=development` השורה נראית כך, `12:03:44.120 ERROR [api 1a2b3c4d] ...`, עם שמונת התווים הראשונים של המזהה. בכל ערך אחר השורה היא JSON עם `requestId` מלא.

```bash
pnpm dev:api 2>&1 | tee /tmp/api.log      # בטרמינל של ה API
grep 'dbg-001' /tmp/api.log                 # המזהה המלא, או שמונת התווים הראשונים
```

4. **זהו את המשתמש.** ה cookie נקרא `session` לפי `SESSION_COOKIE_NAME`. במסד נשמר רק hash של sha256, ב `login_session.token_hash`. כך עוברים מה cookie לחשבון.

```bash
psql "$DB" -c "select s.user_id, u.username, u.role, u.status, s.expires_at, s.revoked_at
  from login_session s join user_account u on u.id::text = s.user_id
  where s.token_hash = encode(sha256(convert_to('<cookie value>','UTF8')),'hex')"
psql "$DB" -c "select identifier, outcome, ip, occurred_at from login_attempt order by occurred_at desc limit 10"
```

5. **בדקו את יומן הביקורת.** `AuditInterceptor` כותב שורה ב `audit_record` לכל POST, PUT, PATCH ו DELETE שהצליחו, אחרי שהתשובה נשלחה, וכשל בכתיבה נבלע בשקט. בקשה שנכשלה לא נרשמת. אין בשורה מזהה בקשה, ולכן מחברים לפי `actor_id` וזמן. `target_id` נלקח מפרמטר route בשם `id`, `itemId`, `requestId`, `offerId`, `listingId` או `userId`.

```bash
psql "$DB" -c "select occurred_at, actor_id, action, target_entity, target_id
  from audit_record order by occurred_at desc limit 20"
```

6. **בדקו את הטבלאות של התחום.** כל פעולת כסף או בעלות משאירה עקבות קבועים.

| מה קרה | טבלה | מה לחפש |
|---|---|---|
| כסף זז | `ledger_record` | `user_id`, `type`, `direction`, `amount`, `reference_type`, `reference_id` |
| חיוב לפי מחירון | `charge` | `action_type`, `pricing_rule_snapshot`, `status` |
| בעלות, מצב או מדף השתנו | `custody_event` | `event_type`, `prev_owner_id`, `new_owner_id`, `prev_state`, `new_state` |
| מצב הפריט עכשיו | `item` | `owner_id`, `lifecycle_state`, `hold_flag`, `bin_id` |
| מכירה | `listing`, `transaction` | `listing.status`, `transaction.frozen_pricing` |
| תשובה שנשמרה לחזרה | `idempotency_key` | `key`, `endpoint`, `status_code` |
| אישור דו שלבי | `confirmation_token` | `action`, `consumed_at`, `expires_at` |
| בקשת ארנק | `wallet_request`, `wallet_request_event` | `status`, ומי אישר |
| משלוח | `shipment` | `status`, `payment_due_at`, `tracking_number` |
| אירוע להודעה | `outbox_message` | `event_type`, `payload`, `dispatched_at` |
| הודעה שנוצרה | `notification` | `channel`, `status`, `failure_reason` |

```bash
psql "$DB" -c "select occurred_at, type, direction, amount, reference_type, reference_id
  from ledger_record where user_id = '<userId>' order by occurred_at desc limit 20"
psql "$DB" -c "select occurred_at, event_type, prev_owner_id, new_owner_id, prev_state, new_state, actor_id, reason
  from custody_event where item_id = '<itemId>' order by occurred_at"
psql "$DB" -c "select created_at, event_type, payload, dispatched_at from outbox_message order by created_at desc limit 10"
```

**דוגמה מלאה, קנייה בשוק.** `POST /marketplace/listings/:id/purchase` שהצליחה משאירה בדיוק את השורות האלה, וכל אחת שחסרה היא באג.
- שלוש שורות ב `ledger_record` עם `reference_type = 'listing'`. `purchase` חובה לקונה, `sale_credit` זכות למוכר, ו `fee` חובה למוכר אם העמלה אחרי ויתור החברות גדולה מאפס.
- שתי שורות ב `custody_event` לפריט, `ownership_transfer` מהמוכר לקונה ו `state_change` מ `listed` ל `stored`.
- `listing.status` הוא `sold`, ושורה חדשה ב `transaction` עם קוד `TXN-` ו `frozen_pricing`.
- שורה ב `idempotency_key` עם `endpoint = 'purchase:<listingId>'`.
- שורה ב `outbox_message` מסוג `item_sold`. ה payload מכיל `sellerId` ו `buyerId`, וה worker מודיע רק למוכר, כי הוא לוקח את מפתח הנמען הראשון.
- שורה ב `audit_record` עם `action = 'POST /api/v1/marketplace/listings/<id>/purchase'` ו `target_id` של המודעה.

7. **עקבו אחרי ההמשך ב worker.** `outbox.dispatch` רץ כל דקה. כל עוד `dispatched_at` ריק, ה worker עוד לא טיפל באירוע. כשהוא מטפל, נוצרות שורות ב `notification`, ובערוץ email עם `EMAIL_PROVIDER=console` הלוג של ה worker מדפיס `[email] to=... template=...`. כל job מדפיס בתחילית `[job:<name>]`, ו pg-boss שומר את ההיסטוריה.

```bash
psql "$DB" -c "select name, state, retry_count, created_on, completed_on, output
  from pgboss.job order by created_on desc limit 20"
```

**מלכודות.**
- מיילים שה API שולח בעצמו, אימות ואיפוס סיסמה, מודפסים בלוג של ה API ולא של ה worker. הקישור נראה כך, `http://localhost:5173/#/verify-email?token=...`.
- `user_id` ורוב עמודות ההפניה הן `text`, ו `user_account.id` הוא `uuid`. ב JOIN ידני כתבו `u.id::text = s.user_id`.
- טבלאות ההיסטוריה דוחות UPDATE ו DELETE ב trigger. אל תתקנו נתונים ידנית ב psql, כתבו שורה מפצה דרך הקוד.

**איך מוכיחים.** שלוש עובדות צריכות להסכים. הכותרת `x-request-id`, השורה בלוג כשיש שגיאה, והשורות בטבלאות התחום עם אותו זמן ואותו משתמש.

### מתכון 4. route חדש במודול קיים

הדוגמה לאורך המתכון היא `POST /api/v1/support/tickets/:id/reopen`, פתיחה מחדש של פנייה שנסגרה, לצוות בלבד. אותם צעדים חלים על כל מודול.

**הקבצים, לפי הסדר.**
1. `apps/api/src/modules/sup/sup.controller.ts`, ה DTO וה route.
2. `apps/api/src/modules/sup/support.service.ts`, הלוגיקה.
3. `apps/api/src/modules/sup/sup.module.ts`, רק אם הוספתם מחלקת controller או service חדשה.
4. `apps/api/src/shared/errors/error-codes.ts`, רק אם צריך קוד שגיאה חדש.
5. `tests3/integration/sec-authorization.test.ts`, הוספה למטריצת ההרשאות.
6. קובץ בדיקה של המודול, ב `tests/integration` או `tests3/integration`.
7. הקריאה מה SPA, במתכון 8.

**צעד 1, ה controller.** דפוס P2. מה שחשוב לדעת על השרשרת בפועל.
- כל route דורש session כברירת מחדל, כי `SessionAuthGuard` רשום גלובלית. `@Public()` מ `acc/public.decorator.ts` פותח אותו לכולם.
- המשתמש חייב להיות `active`. `@AllowSuspended()` מתיר גם `suspended`, והוא קיים רק על נתיבי התמיכה. משתמש `pending` נחסם תמיד ב 403 `account_suspended`.
- `@Roles(...)` מ `sec/roles.decorator.ts`. ה guard קורא אותו ב `getAllAndOverride`, כלומר `@Roles` על מתודה מחליף את זה של המחלקה ולא מתווסף לו. בלי `@Roles` כל משתמש מחובר עובר.
- ה throttling חל אוטומטית בשני הדליים. `@Throttle({ auth: { limit, ttl } })` מצמצם route רגיש, כמו ב `acc/auth.controller.ts` שורה 22.
- ה audit אוטומטי לכל מתודה משנה. קראו לפרמטר `id` או אחד השמות שה interceptor מכיר, אחרת `target_id` יישאר ריק.

**צעד 2, ה DTO.** דפוס P4, אבל בפועל ה DTO הוא מחלקה עם דקורטורים של class-validator באותו קובץ של ה controller. zod לא משמש לבקשות. ה `ValidationPipe` ב `main.ts` שורות 130 עד 137 עובד עם `whitelist`, `forbidNonWhitelisted` ו `transform`.

```ts
class ReopenDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

@Roles('warehouse_operator', 'admin')
@Post('tickets/:id/reopen')
reopen(@Param('id') id: string, @Body() dto: ReopenDto, @CurrentUser() user: AuthUser) {
  return this.support.reopen(id, { id: user.id, role: user.role }, dto.reason);
}
```

**צעד 3, ה service.** דפוס P3. הכלל הוא לבדוק את המצב בתוך הטרנזקציה, אחרי נעילה, ולא לפניה. `resolve` הקיים בודק מחוץ לטרנזקציה, ולכן שתי סגירות מקבילות יעברו שתיהן. אל תעתיקו אותו.

```ts
async reopen(ticketId: string, actor: TicketActor, reason: string) {
  if (!this.staff(actor)) throw AppError.forbidden('Only staff can reopen a ticket');
  return this.db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTicket)
      .where(eq(supportTicket.id, ticketId)).for('update').limit(1);
    if (!t) throw AppError.notFound('Ticket not found');
    if (t.status !== 'resolved') throw new AppError(ErrorCode.CONFLICT, 'Ticket is not resolved', 409);
    await tx.update(supportTicket)
      .set({ status: 'open', updatedAt: new Date() }).where(eq(supportTicket.id, ticketId));
    await this.outbox.emit(tx, { aggregateType: 'support_ticket', aggregateId: ticketId,
      eventType: 'support_ticket_replied', payload: { userId: t.userId, ticketCode: t.code, reason } });
    return { status: 'open' as const };
  });
}
```

**מלכודות.**
- שדה ב DTO בלי דקורטור נדחה ב 400 `validation_failed`, והשדה מופיע ב `details`, כי `forbidNonWhitelisted`. שדה מקונן צריך `@ValidateNested()` ו `@Type(() => X)`, כמו ב `inv/inv.controller.ts` שורה 82.
- `@Body()` עם interface או `Record` לא עובר שום ולידציה. רק מחלקה.
- `@Query('x')` ו `@Param('id')` לא עוברים ולידציה בכלל. בדקו אותם ב service. מזהה שאינו uuid תקין מגיע ל Postgres, ו `AllExceptionsFilter` הופך את השגיאה ל 400.
- זרקו רק `AppError` או `new AppError(ErrorCode.X, msg, status)`. `Error` רגיל הופך ל 500 עם הודעה כללית.
- בדיקת בעלות היא עבודה של ה service. מי שאינו הבעלים מקבל `notFound`, לא `forbidden`, כמו ב `loadFor` ב `support.service.ts` שורות 63 עד 66.
- route שמזיז כסף צריך גם `idempotency-key` ואישור דו שלבי. ראו מתכון 6.
- Nest מחזיר 201 ל POST כברירת מחדל. אם הלקוח מצפה ל 200, הוסיפו `@HttpCode(200)`.

**צעד 4, הבדיקה.** דפוס P10. בדיקה אחת שמוכיחה את המסלול הטוב, את התפקיד השגוי ואת המצב השגוי.

```ts
import { describe, it, expect } from 'vitest';
import { SEED, signIn } from '../../tests/integration/helpers/http';

describe('POST /support/tickets/:id/reopen', () => {
  it('lets staff reopen a resolved ticket and refuses everyone else', async () => {
    const collector = await signIn(SEED.collector);
    const t = await collector.post('/support/tickets', { category: 'other', subject: 'Reopen', body: 'b' });
    const op = await signIn(SEED.operator);
    expect((await op.post(`/support/tickets/${t.body.id}/reopen`, { reason: 'x' })).status).toBe(409);
    expect((await op.post(`/support/tickets/${t.body.id}/resolve`)).status).toBe(201);
    expect((await collector.post(`/support/tickets/${t.body.id}/reopen`, { reason: 'x' })).status).toBe(403);
    expect((await op.post(`/support/tickets/${t.body.id}/reopen`, { reason: 'x', extra: 1 })).status).toBe(400);
    expect((await op.post(`/support/tickets/${t.body.id}/reopen`, { reason: 'x' })).status).toBe(201);
  });
});
```

ואז הוסיפו את ה route למערך המתאים ב `tests3/integration/sec-authorization.test.ts`, `STAFF_ONLY` בשורה 27, `ADMIN_ONLY` בשורה 56, `PUBLIC_ROUTES` בשורה 70 או `OWNER_SCOPED` בשורה 82. הרשימות כתובות ביד בכוונה, כדי ש route בלי שורה שם ייראה כחסר. קלט רע ומספרים קיצוניים שייכים ל `tests3/integration/sec-validation.test.ts`.

**איך מוכיחים.**

```bash
pnpm --filter @bault/api typecheck
pnpm --filter @bault/api db:seed
pnpm exec vitest run --project core tests3/integration/sec-authorization.test.ts tests3/integration/<your-test>.test.ts
psql "$DB" -c "select action, target_id from audit_record where action like '%/reopen' order by occurred_at desc limit 3"
```

וב Swagger על `http://localhost:3000/docs` ה route מופיע תחת התגית של המודול.

### מתכון 5. טבלה או עמודה חדשה

הדוגמה היא עמודה `reopened_at` ב `support_ticket`. טבלה חדשה עוברת את אותם צעדים, עם צעד נוסף ב barrel.

**הקבצים, לפי הסדר.**
1. `apps/api/src/modules/sup/sup.schema.ts`, ההגדרה ב TypeScript. דפוס P5.
2. `apps/api/src/db/schema/index.ts`, רק לקובץ schema חדש. בלי export כאן, Drizzle לא מכיר את הטבלה ו `db.query` לא מוקלד.
3. `apps/api/src/db/migrations/0031_<name>.sql`, ה SQL, כתוב ביד. דפוס P6.
4. `apps/api/src/db/migrations/meta/_journal.json`, רשומה חדשה.
5. `apps/api/src/db/sql/0001_append_only.sql`, רק לטבלת היסטוריה.
6. `apps/api/src/db/seed.ts`, רשימת ה `TRUNCATE` בשורות 83 עד 97 לטבלה חדשה, ושורות דמו אם המסך צריך אותן. הרשימה בלי `CASCADE`, ולכן טבלה חדשה עם מפתח זר לטבלה שברשימה, שלא נוספה אליה, תפיל את ה seed.
7. `apps/worker/src/jobs/*.ts`, כל SQL גולמי שנוגע בטבלה.
8. הטיפוסים ב SPA, אם העמודה מגיעה ללקוח.

**צעד 1, ה schema.** השתמשו בעוזרים מ `apps/api/src/db/schema/_helpers.ts`, `pkId`, `createdAt`, `updatedAt`, `amountMinor` לכסף בסנטים שלמים, `currency`. הוסיפו `index()`, `uniqueIndex()`, `check()` ו `.references()` גם כשהמיגרציה כתובה ביד. היום 52 מתוך 73 אינדקסים קיימים רק ב SQL, ומי שקורא רק את ה schema לא רואה אותם.

```ts
reopenedAt: timestamp('reopened_at', { withTimezone: true }),
```

**צעד 2, קובץ ה SQL.** לא מריצים `pnpm --filter @bault/api db:generate` ולא `drizzle-kit push`. ה snapshot האחרון בתיקייה `meta` הוא של 0003, ולכן generate מייצר קובץ שיוצר מחדש טבלאות קיימות, ו push מציע למחוק כל אינדקס ואילוץ שלא מוצהר ב TypeScript.

```sql
-- 0031 — a resolved ticket can be reopened.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "support_ticket" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;
```

הכללים לקובץ.
- `--> statement-breakpoint` בין פקודות. המיגרטור מפצל עליו.
- `IF NOT EXISTS` בכל `CREATE` ו `ADD COLUMN`. `CREATE TYPE` ואילוצים בתוך `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$`, כמו ב `0029_who_signed_in.sql`.
- כל המיגרציות הממתינות רצות בטרנזקציה אחת. לכן אין `CREATE INDEX CONCURRENTLY`, וערך חדש שנוסף ב `ALTER TYPE ... ADD VALUE` לא שמיש באותה ריצה.
- עמודה חדשה על טבלה קיימת היא nullable או עם ברירת מחדל קבועה. `NOT NULL` בלי ברירת מחדל שובר כל INSERT ישן, כולל של ה worker.
- עמודות הפניה ברוב הטבלאות הן `text`, ו `user_account.id` ו `item.id` הם `uuid`. ה JOINים עובדים רק בזכות `CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT` בסוף `0001_append_only.sql`. עמודה חדשה שמפנה לטבלה אחרת עדיף שתהיה `uuid` עם מפתח זר.
- לא עורכים מיגרציה שכבר רצה במסד כלשהו. ה hash נשמר ולא נבדק, והשינוי יופיע רק במסדים חדשים.

**צעד 3, היומן.** `migrate.ts` שורה 23 קורא ל `migrate()` של Drizzle עם `./src/db/migrations`. המיגרטור קורא רק את מה שרשום ב `_journal.json`, ומריץ רק רשומות שה `when` שלהן גדול מה `created_at` של האחרונה שהוחלה. קובץ בלי רשומה לא ירוץ לעולם. `when` קטן מדי ידולג בשקט.

```json
    {
      "idx": 31,
      "version": "7",
      "when": 1785074700000,
      "tag": "0031_a_ticket_can_be_reopened",
      "breakpoints": true
    }
```

ה `tag` זהה לשם הקובץ בלי `.sql`. הרשומה האחרונה היום היא `0030` עם `1785074600000`.

**צעד 4, טבלת היסטוריה.** אם הטבלה החדשה היא יומן שאסור לערוך, הוסיפו את שמה לשני המערכים `history_tables` ב `0001_append_only.sql` שורות 42 ו 87. הקובץ רץ אחרי כל migrate ומתקין trigger שדוחה UPDATE ו DELETE. ודאו קודם ב grep שאין `update(` או `delete(` על הטבלה ב `apps/api/src` ואין `UPDATE` או `DELETE` ב `apps/worker/src`.

**צעד 5, ה worker.** ה worker כותב SQL גולמי ולא מייבא את ה schema, ולכן TypeScript לא יתפוס שבר. הטבלאות שהוא נוגע בהן הן `item`, `ledger_record`, `charge`, `shipment`, `membership`, `membership_period`, `user_account`, `pricing_rule`, `outbox_message`, `notification`, `notification_preference` ו `storage_fee_run`. שינוי שם, מחיקה, `NOT NULL` חדש או ערך enum חדש באחת מהן מחייבים לעבור על כל שאילתה.

```bash
grep -rnE '\b(support_ticket|reopened_at)\b' apps/worker/src
grep -rnE 'INSERT INTO (charge|ledger_record|notification|outbox_message)' apps/worker/src
```

**המלכודת של ה image הבנוי, E2.** בייצור מריצים `node dist/db/migrate.js`. שם `__dirname` הוא `dist/db`, ו `nest-cli.json` לא מגדיר `assets`, ולכן `dist/db/sql/0001_append_only.sql` לא קיים. המיגרציות עצמן נשמרות, כי `migrationsFolder` יחסי ל cwd וה Dockerfile מעתיק את `src/db/migrations`, ואז ההרצה נופלת ב ENOENT. התוצאה היא מסד עם כל הטבלאות, בלי אף trigger ובלי ה cast. `tsx src/db/migrate.ts` בפיתוח וב CI לא מראה את זה. התיקון הוא `"assets": ["db/sql/*.sql"]` תחת `compilerOptions` ב `apps/api/nest-cli.json`, ובדיקה שהקובץ הופיע ב `dist`.

```bash
pnpm --filter @bault/api build
ls apps/api/dist/db/sql || echo 'E2: sql guards missing from dist'
psql "$DB" -c 'create database bault_scratch'
cd apps/api
DIRECT_DATABASE_URL=postgres://bault:bault@localhost:5432/bault_scratch node dist/db/migrate.js
psql postgres://bault:bault@localhost:5432/bault_scratch -Atc \
  "select count(*) from pg_trigger where tgname like 'trg_append_only_%'"   # חייב 10
cd ../..
psql "$DB" -c 'drop database bault_scratch'
```

**איך מוכיחים.**

```bash
pnpm --filter @bault/api db:migrate
psql "$DB" -c 'select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 3'
psql "$DB" -c '\d support_ticket'
psql "$DB" -Atc "select count(*) from pg_trigger where tgname like 'trg_append_only_%'"
pnpm --filter @bault/api typecheck && pnpm --filter @bault/worker typecheck
```

אחר כך מיגרציה על מסד ריק, כמו בבלוק של E2 אבל עם `pnpm --filter @bault/api db:migrate`, seed, כל ארבע החבילות שתלויות במסד, והרצה ידנית של כל job שנוגע בטבלה, לפי מתכון 7. מיגרציה שנבדקה רק על המסד המקומי שכבר עבר את כל הקודמות לא נבדקה.

### מתכון 6. שינוי שנוגע בכסף או בבעלות

זה המתכון שבו טעות עולה כסף אמיתי. רוב ממצאי P0 נובעים מאותה טעות, בדיקה ברגע אחד ופעולה ברגע אחר בלי נעילה. הדוגמה הקנונית בקוד היא `PurchaseService.purchase` ב `apps/api/src/modules/mkt/purchase.service.ts` שורות 65 עד 182, ויש בה גם את הבאג E1.

**הקבצים שתיגעו בהם כמעט תמיד.**
- ה service של הפעולה. דפוס P3.
- `apps/api/src/modules/pay/ledger.service.ts`, `record` בשורה 44 ו `balanceOf` בשורה 57.
- `apps/api/src/modules/pay/billing.service.ts`, `charge(tx, action)` לחיוב לפי מחירון, שכותב `charge` ושורת יומן.
- `apps/api/src/modules/prc/pricing.service.ts`, `price(action, input, tx)` שמחזיר סכום ו snapshot.
- `apps/api/src/modules/cst/custody.service.ts`, `transferOwnership` בשורה 147, `changeState` בשורה 161, `setHold` בשורה 186, `run` בשורה 210.
- `apps/api/src/modules/not/outbox/outbox.service.ts`, `emit(tx, event)`.
- `apps/api/src/shared/idempotency/idempotency.service.ts` ו `apps/api/src/shared/confirmation/confirmation.service.ts`.

**רשימת הבדיקה. כל שורה חייבת תשובה לפני push.**

1. **טרנזקציה אחת ליחידת עבודה עסקית.** `this.db.transaction(async (tx) => ...)` או `this.custody.run(...)`. כל קריאה בפנים מקבלת `tx`. `ledger.record(entry)` ו `balanceOf(userId)` בלי `tx` רצים על ה pool, מחוץ לטרנזקציה, ושורת היומן נשארת גם אם השאר נכשל.
2. **נעילה לפני בדיקה, בסדר קבוע.** קודם שורת העסק, `listing`, `shipment`, `escrow_deal`, עם `.for('update')`. אחר כך הפריטים, דרך `custody`, שנועל ב `lockItem`. בסוף הארנקים, לפי מזהה בסדר עולה. סדר שונה בשני מסלולים יוצר deadlock, ו Postgres מבטל אחד מהם עם 500.
3. **היתרה, E1 ו E18.** `balanceOf` הוא `SUM` על `ledger_record`, ואין שורה לנעול. שתי טרנזקציות שבודקות את אותו ארנק במקביל רואות שתיהן את אותה יתרה. לפני כל בדיקת יתרה, בתוך הטרנזקציה, נעלו את הארנק של המשלם. נעילת השורה ב `user_account` היא הדרך הפשוטה. `pg_advisory_xact_lock` על hash של המזהה היא חלופה שלא חוסמת עדכוני פרופיל.
4. **הבדיקה עצמה אחרי הנעילה, ובאותה טרנזקציה.** E18 הוא בדיוק ההפך. `shipment.service.ts` שורות 813 ו 929, `human-fulfilment.service.ts` שורה 212, `escrow.service.ts` שורה 335, `offer.service.ts` שורה 173 ו `withdrawal.service.ts` שורה 55 קוראים ליתרה בלי `tx`, ומעדכנים אחר כך לפי `id` בלבד.
5. **בעלות, E4.** `transferOwnership(tx, itemId, newOwnerId, actorId, reason)` מעביר מכל בעלים שהוא, ולא מקבל את הבעלים הצפוי. אחרי הנעילה, בדקו `item.owner_id`, `lifecycle_state` ו `hold_flag` מול מה שהפעולה מניחה. התיקון השורשי הוא פרמטר `expectedOwnerId` ב `CustodyService`, שזורק 409, ועדכון שמונה נקודות הקריאה, `purchase.service.ts` שורה 145, `trade.service.ts` שורות 109 ו 112, `escrow.service.ts` שורה 612, `donation.service.ts` שורה 53, `disposal-services.service.ts` שורה 191, `buyout.service.ts` שורה 147 ו `consignment.service.ts` שורה 200.
6. **מעבר מצב.** `changeState` בודק את המעבר ב `assertTransition` מ `cst/lifecycle.ts`. מצב חדש נכנס גם לשם וגם ל enum ב migration.
7. **אישור דו שלבי.** `confirmation.issue` שומר את הפרמטרים לחמש דקות. `consume` רץ מחוץ לטרנזקציה, בוחר את השורה ואחר כך מעדכן לפי `id` בלי תנאי על `consumed_at`, ולכן שתי בקשות confirm מקבילות עוברות שתיהן. אחרי `consume` בדקו מחדש, בתוך הטרנזקציה ואחרי נעילה, את כל מה שנבדק ב issue. הנתונים יכלו להשתנות בחמש הדקות. התיקון בשירות הוא `UPDATE ... WHERE consumed_at IS NULL RETURNING`.
8. **אידמפוטנטיות.** הלקוח שולח כותרת `idempotency-key`. `lookup` רץ לפני הטרנזקציה ו `save` אחרי ה commit, ולכן שתי בקשות מקבילות עם אותו מפתח רצות שתיהן, וההגנה האמיתית מפני כפל היא הנעילה. `lookup(key, endpoint)` לא מסנן לפי משתמש, ולכן ה endpoint צריך לכלול גם את המשתמש וגם את מזהה הפעולה. `purchase:<listingId>` כולל רק את המודעה, ומשתמש אחר ששולח אותו מפתח יקבל את התשובה השמורה של הקונה הראשון. אם אין כותרת, `purchase` נופל ל `purchase-<userId>-<listingId>`.
9. **outbox.** `outbox.emit(tx, ...)` באותה טרנזקציה, אחרי השינוי. ה payload חייב לכלול נמען, אחד מ `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`, או מערך `recipientIds`. ה worker לוקח את המפתח הראשון שמצא בסדר הזה, אז לשני נמענים השתמשו ב `recipientIds`. סוג אירוע חדש מחייב את הקבצים במתכון 7.
10. **היומן.** `amount` חיובי ושלם בסנטים, והכיוון ב `direction`. `type` חייב להיות ב enum `ledger_type` וב union של `LedgerEntry`, כלומר סוג חדש הוא migration עם `ALTER TYPE ... ADD VALUE` ועדכון של שניהם. מלאו `referenceType` ו `referenceId`, אחרת אי אפשר לשחזר למה הכסף זז. תיקון הוא שורה מפצה, אף פעם לא UPDATE.
11. **ספק חיצוני.** לא קוראים לספק מתוך טרנזקציה פתוחה, ולא לפני שיש שורת `pending`. `withdrawal.service.ts` קורא ל `createPayout` בתוך הטרנזקציה, וזו הדוגמה למה לא לעשות.
12. **שגיאות.** `AppError` עם 409 וקוד מ `ErrorCode`, `INSUFFICIENT_BALANCE`, `NEGATIVE_BALANCE_BLOCKED`, `ITEM_ON_HOLD`, `CONFLICT`. ה audit נכתב לבד.

**התבנית הנכונה, בקיצור.**

```ts
return this.db.transaction(async (tx) => {
  const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).for('update').limit(1);
  const [it] = await tx.select().from(item).where(eq(item.id, l.itemId)).for('update').limit(1);
  // ... status, owner and hold checks on l and it
  for (const id of [buyerId].sort()) {        // add every user whose balance this checks
    await tx.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.id, id)).for('update');
  }
  const bal = await this.ledger.balanceOf(buyerId, tx);
  if (bal.amount < price) throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient wallet balance', 409);
  await this.ledger.record({ userId: buyerId, type: 'purchase', amount: price, direction: 'debit',
    referenceType: 'listing', referenceId: listingId }, tx);
  await this.custody.transferOwnership(tx, l.itemId, buyerId, buyerId, `sale of listing ${listingId}`);
  await this.outbox.emit(tx, { aggregateType: 'listing', aggregateId: listingId, eventType: 'item_sold',
    payload: { itemId: l.itemId, buyerId, sellerId: l.sellerId, price } });
});
```

**route עם אישור דו שלבי ו idempotency.** פעולה בלתי הפיכה מקבלת שני routes. הראשון בודק ומחזיר `confirmationToken` ו `expiresAt`. השני צורך את הטוקן ומבצע. כך עושים `POST /marketplace/listings/:id/remove` ו `POST /marketplace/listings/remove/confirm` ב `mkt/mkt.controller.ts` שורות 133 עד 141. פעולת כסף שהלקוח עלול לשלוח פעמיים מקבלת את הכותרת, כמו `purchase` בשורות 142 עד 149.

```ts
@Post('things/:id/do')
requestDo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
  return this.things.requestDo(user.id, id);           // confirmation.issue(user.id, 'do_thing', { id })
}

@Post('things/do/confirm')
confirmDo(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTokenDto,
          @Headers('idempotency-key') key?: string) {
  return this.things.confirmDo(user.id, dto.confirmationToken, key);
}
```

ה SPA שולח את הכותרת דרך הפרמטר השלישי של `api.post`, עם מפתח שנוצר פעם אחת לכל אישור ונשמר בין ניסיונות חוזרים. הדוגמה היא `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx` שורות 65 עד 76, שגם מציגה הודעה אחרת כשהתשובה מסומנת `replayed`.

**בדיקת המקביליות ל E1 ו E18.** הקובץ הולך ל `tests/concurrency/`. הוא חייב להיכשל לפני התיקון, והוא נכשל לסירוגין כי הוא תלוי בתזמון, ולכן הריצו אותו כמה פעמים.

```ts
import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from '../integration/helpers/http';

describe('concurrency: one wallet, many purchases', () => {
  it('never spends more than the balance', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector3);
    const start = (await buyer.get('/finance/wallet')).body.amount as number;
    if (start < 1000) await fundWallet(SEED.collector3, 1000 - start);
    const price = (await buyer.get('/finance/wallet')).body.amount as number;

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const item = await intakeFor(operator, SEED.collector, { description: `E1 ${i}` });
      ids.push((await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: price })).body.id);
    }
    const res = await Promise.all(ids.map((id) => buyer.post(`/marketplace/listings/${id}/purchase`)));

    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await buyer.get('/finance/wallet')).body.amount).toBeGreaterThanOrEqual(0);
  });
});
```

לאותו מבנה בדיוק כתבו גרסה לכל נקודה ב E18. למשל `POST /shipping/shipments/:id/pay` על כמה משלוחים שממתינים לתשלום, או `POST /escrow/:id/fund` על כמה עסקאות, כשהיתרה מספיקה רק לאחד.

**בדיקה ל E4.** פריט עם העברת מתנה שממתינה לאישור נמכר בשוק, ואז הנמען מאשר. היום הפריט עובר מהקונה לנמען.

```ts
it('a sold card cannot be moved by a transfer approved afterwards', async () => {
  const operator = await signIn(SEED.operator);
  const owner = await signIn(SEED.collector);
  const item = await intakeFor(operator, SEED.collector, { description: 'E4' });
  const t = await owner.post('/marketplace/transfers', { itemId: item.id, toUsername: 'veteran' });
  const c = await owner.post('/marketplace/transfers/confirm', { confirmationToken: t.body.confirmationToken });
  const listing = await owner.post('/marketplace/listings', { itemId: item.id, askingPrice: 100 });
  await fundWallet(SEED.collector2, 1000);
  const buyer = await signIn(SEED.collector2);
  expect((await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`)).status).toBe(201);

  const recipient = await signIn(SEED.collector3);
  expect((await recipient.post(`/marketplace/swaps/${c.body.swapId}/approve`)).status).toBe(409);
});
```

**איך מוכיחים.**

```bash
pnpm --filter @bault/api db:seed && pnpm test:concurrency
pnpm --filter @bault/api db:seed && pnpm test:property
pnpm --filter @bault/api db:seed && pnpm exec vitest run --project core \
  tests3/integration/fin-invariants.test.ts tests3/integration/band1-money-ownership.test.ts
psql "$DB" -c "select user_id, sum(case when direction='credit' then amount else -amount end) as bal
  from ledger_record group by user_id having sum(case when direction='credit' then amount else -amount end) < 0"
psql "$DB" -c "select count(*) from ledger_record where amount <= 0"
```

השאילתה הראשונה מראה ארנקים שליליים. ארנק שלילי מותר בקוד אחרי חיוב שירות, אבל לעולם לא אחרי קנייה. הריצו אותה לפני הבדיקה ואחריה, והקונה של הבדיקה לא אמור להופיע בה. השנייה חייבת להחזיר 0, וזה גם מה שה job `ledger.invariant-check` בודק כל שעה.

### מתכון 7. job חדש או שינוי ב job קיים ב worker

ה worker הוא תהליך Node נפרד בלי Nest. הוא מחזיק `Pool` אחד ו pg-boss אחד, שניהם על `DIRECT_DATABASE_URL`, ומריץ SQL גולמי על אותן טבלאות של ה API. דפוס P7.

**הקבצים, לפי הסדר.**
1. `apps/worker/src/jobs/registry.ts`, שם חדש ב `JobName`. לפי המוסכמה `<area>.<verb>`, כמו `shipment.expiry-sweep`.
2. `apps/worker/src/jobs/<name>.ts`, פונקציה `export async function x(pool: Pool): Promise<void>`.
3. `apps/worker/src/index.ts`, שורה חדשה במערך `schedule` שמתחיל בשורה 40, עם `name`, `cron` ו `run`. הלולאה בשורות 63 עד 71 יוצרת את התור, רושמת `boss.work`, קובעת `boss.schedule` ומדפיסה `registered`.
4. אם ה job מחקה חישוב של ה API, מחיר, יתרה, מדיניות, פתחו את ה service המקביל ב API ושמרו את שניהם זהים. `storage-fee.ts` מול `vlt/storage-policy.ts` הוא הדוגמה.
5. אם ה job יוצר הודעה, `INSERT INTO outbox_message` עם נמען ב payload, ולסוג אירוע חדש חמישה קבצים.
   - `apps/api/src/modules/not/event-types.ts`, רשומה ב `NOTIFICATION_EVENT_TYPES` עם `category`, `label`, `emailByDefault`.
   - `apps/worker/src/jobs/notification-events.ts`, `EMAIL_BY_DEFAULT` ו `SUBJECTS`. זה עותק לפי ערך של הקטלוג של ה API.
   - `apps/worker/src/jobs/notification-message.ts`, `case` חדש ב `switch` שמנסח את המשפט.
   - `apps/web/src/shared/notifications.ts`, `EVENT_LABEL_KEY`.
   - `apps/web/src/shared/i18n.tsx`, המפתח `notifications.event.<key>` בעברית ובאנגלית.

**התבנית לטרנזקציה ב worker.** `shipment-expiry.ts` הוא הדוגמה הנקייה.

```ts
export async function sweepSomething(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM shipment WHERE status = 'awaiting_payment' AND payment_due_at <= now()
       FOR UPDATE SKIP LOCKED`);
    for (const row of rows) { /* UPDATE ..., INSERT INTO outbox_message ... */ }
    await client.query('COMMIT');
    console.log(`[job:something] handled ${rows.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

**מלכודות.**
- **אין נעילות מתאימות בקוד הקיים.** אף job לא משתמש ב `SKIP LOCKED`. `outbox-dispatch.ts` בוחר את כל השורות שלא נשלחו בלי נעילה ומסמן כל שורה רק בסוף הטיפול בה, כלומר שני worker במקביל ישלחו כל הודעה פעמיים. ב job חדש, נעלו ב `FOR UPDATE SKIP LOCKED`.
- **ניסיון חוזר.** ב pg-boss 10.4.2 ברירת המחדל היא `retry_limit` 2. job שזרק ירוץ עוד פעמיים. job שמחייב כסף חייב להיות בטוח להרצה חוזרת. `storage-fee.ts` עושה את זה בכך שהוא סופר בתוך השאילתה כמה תקופות כבר חויבו לכל פריט ב `charge`, ומחייב רק את ההפרש. ריצה כפולה במקביל עדיין לא מוגנת, כי אין נעילה.
- **כיבוי, E15.** אין טיפול ב SIGTERM. פריסה הורגת job באמצע. כל יחידת עבודה בטרנזקציה משלה, כדי שהריגה תשאיר מצב שלם.
- **cron ב UTC.** pg-boss מתזמן לפי UTC, והמרווח הקטן ביותר הוא דקה.
- **ה adapter הנכון, E17.** `tracking-refresh.ts` שורה 10 יוצר `new SandboxShippingAdapter()` בלי לקרוא את `SHIPPING_PROVIDER`. job שצריך ספק חייב לבחור אותו לפי `loadEnv()`, כמו `emailAdapter()` ב `outbox-dispatch.ts`.
- **השפעה על כסף.** `interest-accrual.ts`, `storage-fee.ts` ו `membership-renewal.ts` כותבים ל `ledger_record`. כל רשימת הבדיקה של מתכון 6 חל עליהם, כולל נעילת ארנק.
- **שינוי סכמה.** ה worker לא מוקלד מול ה schema. ראו מתכון 5.
- **שינוי ב `packages/*`** מחייב build לפני ש `tsx watch` רואה אותו.

**דוגמה לשינוי ב job קיים, תיקון E17.** `apps/worker/src/jobs/tracking-refresh.ts` הוא 26 שורות. שורה 10 יוצרת adapter מזויף ברמת המודול, והלולאה מעדכנת כל משלוח `shipped` או `in_transit` בלי טרנזקציה ובלי אירוע outbox. התיקון המינימלי הוא לבחור adapter כמו ה API.

```ts
import { loadEnv } from '@bault/config';
import { EasyPostShippingAdapter, SandboxShippingAdapter, type ShippingAdapter } from '@bault/adapters';

function shippingAdapter(): ShippingAdapter {
  const env = loadEnv();
  return env.SHIPPING_PROVIDER === 'easypost'
    ? new EasyPostShippingAdapter({ apiKey: env.EASYPOST_API_KEY, baseUrl: env.EASYPOST_BASE_URL || undefined })
    : new SandboxShippingAdapter();
}
```

אחרי זה שלוש החלטות שה job הישן דילג עליהן. לעדכן רק כשהסטטוס באמת השתנה, `WHERE id = $2 AND status <> $1`. לכתוב `outbox_message` כשמשלוח הגיע ל `delivered` או ל `exception`, עם `userId` ב payload. ולזכור שקריאה לספק לכל משלוח, כל חצי שעה, עולה כסף ונתקלת במגבלת הקצב של EasyPost.

**הרצה ידנית של job, בלי לחכות ל cron.**

```bash
cd apps/worker
pnpm exec tsx -e "
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { dispatchOutbox } from './src/jobs/outbox-dispatch';
const pool = new Pool({ connectionString: loadEnv().DIRECT_DATABASE_URL });
dispatchOutbox(pool).then(() => pool.end(), (e) => { console.error(e); return pool.end(); });"
```

החליפו את ה import בפונקציה של ה job שלכם. זה מריץ את הקוד מול המסד המקומי, בלי pg-boss.

**איך מוכיחים.**

```bash
pnpm --filter @bault/worker typecheck
pnpm dev:worker                       # מחפשים "[worker] registered <name> (<cron>)"
psql "$DB" -c "select name, cron, timezone from pgboss.schedule order by name"
psql "$DB" -c "select name, state, retry_count, completed_on, output from pgboss.job
  where name = '<name>' order by created_on desc limit 5"
pnpm test:web                         # notification-catalogue.test.ts בודק שה API, ה worker וה SPA מסכימים
```

אין חבילת בדיקות ל worker. בדיקה שקל לכתוב היא בדיקת `web` שמייבאת פונקציה טהורה מ `apps/worker/src/jobs`, כמו ש `tests/web/notification-catalogue.test.ts` עושה. ל job שמשנה נתונים, הריצו אותו ידנית אחרי seed והשוו את הטבלאות לפני ואחרי.

### מתכון 8. מסך או לשונית חדשים ב SPA

ה SPA הוא React בלי router חיצוני. הניתוב הוא hash בצורה `#/<section>/<tab>?<params>`, והוא כולו ב `apps/web/src/shared/routing.ts`. `App.tsx` מחליט איזה section מוצג ולמי. כל section מחליט בעצמו על הלשוניות שלו. דפוס P8.

**קודם תחליטו מה אתם מוסיפים.** לשונית בתוך אזור קיים היא שינוי קטן. section חדש ברייל הוא שינוי ב `App.tsx`.

**לשונית באזור קיים, לפי הסדר.**
1. הקומפוננטה, למשל `apps/web/src/areas/admin/ReportsSection.tsx`, או `apps/web/src/areas/warehouse/...`.
2. מערך `TABS` של האזור. `apps/web/src/areas/admin/AdminConsole.tsx` שורה 81 עם `TAB_LABEL` שאחריו, או `apps/web/src/areas/warehouse/WarehouseConsole.tsx` שורה 103, או ה `TABS` של דף הלקוח.
3. התנאי שמרנדר את הלשונית, `{section === 'reports' && (...)}` באדמין או `{tab === 'reports' && (...)}` במחסן.
4. מפתחות i18n, `admin.section.reports` או `warehouse.tab.reports`. ה breadcrumb בונה את המפתח מ `TAB_PREFIX` ב `App.tsx` שורה 145, ומשמיט אותו אם הוא לא קיים.

**section חדש, לפי הסדר.**
1. הדף, `apps/web/src/areas/customer/<area>/<Name>Page.tsx`.
2. `apps/web/src/App.tsx`, רשומה ב `SECTIONS` בשורה 86 עם `key`, `labelKey`, `titleKey`, `icon`, ואם צריך `secondary` ו `requires: 'staff' | 'admin'`. רשומה ב `TAB_PREFIX` אם יש לשוניות. שורת רינדור ליד שורה 555, `{section === 'x' && <XPage />}`. ל section של צוות, התנאי כולל גם `isStaff` או `isAdmin`, כמו בשורות של `warehouse` ו `admin`.
3. אייקון מ `apps/web/src/shared/ui/icons.tsx`.
4. `apps/web/src/shared/routing.ts`, רק אם section ישן הוחלף. `LEGACY_ROUTES` מפנה קישורים ישנים, ו `tests/web/routing.test.ts` בודק אותו.

**הדף עצמו, התבנית של `SupportPage.tsx`.**

```tsx
export function ReportsSection() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ReportRow[]>('/admin/reports'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (rows === null) return <SkeletonTable />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />;
  if (rows.length === 0) return <EmptyState title={t('reports.empty')} text={t('reports.emptyText')} />;
  return <Panel>{/* ... */}</Panel>;
}
```

**הקריאה ל API.** רק דרך `api.get`, `api.post`, `api.patch`, `api.put`, `api.del` מ `apps/web/src/shared/api.ts`. הנתיב יחסי ל `/api/v1`, ה cookie נשלח עם `credentials: 'include'`, ושגיאה הופכת ל `ApiError` עם `kind` ו `code`. `apiErrorKey(e)` מתרגם `kind` למפתח הודעה. `api.post` מקבל כותרות בפרמטר השלישי, וכך שולחים `idempotency-key` לפעולת כסף. טיפוסים ועזרים שמשותפים לכמה מסכים הולכים לקובץ ב `apps/web/src/shared`, כמו `support.ts` או `shipments.ts`.

**i18n בשתי השפות.** הכל ב `apps/web/src/shared/i18n.tsx`.
- האובייקט `he` בשורה 24 הוא המקור. `MessageKey` נגזר ממנו.
- האובייקט `en` בשורה 2327 מוגדר כ `Record<MessageKey, string>`, ולכן מפתח שחסר באנגלית נכשל ב typecheck.
- משתנים בתבנית `{name}`, ומעבירים אותם ב `t('key', { name })`. אותם משתנים חייבים להופיע בשתי השפות.
- `tests/web/i18n-catalogue.test.ts` בודק שאין מחרוזת עברית שנשארה באנגלית, שהמשתנים זהים, ושהמוצר נקרא Bault בכל מקום.
- שפת ברירת המחדל היא עברית, והבחירה נשמרת ב `localStorage` תחת `bault.locale`.

**תפקידים.** הסתרה ב SPA היא נוחות ולא אבטחה. כל route שהמסך קורא חייב `@Roles` ב API, לפי מתכון 4. ב `App.tsx`, `requires: 'staff'` פותח ל `warehouse_operator` ול `admin`, ו `requires: 'admin'` רק למנהל. משתמש מושעה רואה רק `support`. section לא מוכר או לא מורשה נופל לברירת המחדל של התפקיד, `admin`, `warehouse` או `vault`.

**מלכודות.**
- RTL. מאפיינים לוגיים בלבד, `margin-inline-start` ולא `margin-left`. `node scripts/design-lint.mjs` תופס מאפיינים פיזיים, ערכים מחוץ לסקאלה וצבעים קשיחים.
- `navigate` שומר את ה section האחרון ב `localStorage`, ו `App.tsx` חוזר אליו ברענון. section שנמחק צריך הפניה ב `LEGACY_ROUTES`.
- בדיקות `ux` מחליפות את `shared/api` ב `vi.mock`. הן מוכיחות את המסך, לא את החוזה עם השרת.
- `apps/web/.env` נכנס ל bundle אם המשתנה מתחיל ב `VITE_`. אף פעם לא סוד. `tests/web/no-credentials-in-bundle.test.ts` בודק את זה.

**הבדיקה.** קובץ ב `tests/ux/<name>.test.tsx`, עם `vi.mock('../../apps/web/src/shared/api', ...)` ורינדור בתוך `I18nProvider`, כמו `tests/ux/customer-screens.test.tsx`. לוגיקה טהורה הולכת ל `tests/web`.

**איך מוכיחים.**

```bash
pnpm --filter @bault/web typecheck
pnpm test:web && pnpm test:ux
node scripts/design-lint.mjs
pnpm --filter @bault/web build
```

אחר כך `pnpm dev`, התחברו כ `red`, `hermon` ו `eldar`, וודאו שכל אחד רואה רק את מה שמותר לו. החליפו שפה במתג השפה בכותרת, ובדקו שאין מפתח גולמי על המסך ושהפריסה מתהפכת נכון.

### מתכון 9. adapter לספק חיצוני, PayPal, EasyPost, דואר

כל ספק יושב מאחורי interface ב `packages/adapters/src`, עם מימוש sandbox שלא מדבר עם אף אחד ומימוש אמיתי. ה API בוחר מימוש לפי משתנה סביבה. דפוס P11.

| ספק | interface ומימושים | משתנה בחירה | איפה נבחר |
|---|---|---|---|
| תשלום | `payment.ts`, `PaymentAdapter`, `PayPalPaymentAdapter`, `SandboxPaymentAdapter` | `PAYMENT_PROVIDER`, בלי ברירת מחדל | `adapters.module.ts` |
| משלוח | `shipping.ts` עם `SandboxShippingAdapter`, `easypost.ts` עם `EasyPostShippingAdapter` | `SHIPPING_PROVIDER`, ברירת מחדל `sandbox` | `adapters.module.ts`, וב worker קשיח ל sandbox |
| דואר | `email.ts`, `ConsoleEmailAdapter`, `SmtpEmailAdapter`, התבניות ב `renderEmail` | `EMAIL_PROVIDER`, ברירת מחדל `console` | `adapters.module.ts` וגם `outbox-dispatch.ts` ב worker |
| אחסון | `storage.ts` עם `SandboxStorageAdapter`, `s3.ts` עם `S3StorageAdapter` | `STORAGE_PROVIDER`, ברירת מחדל `sandbox` | `adapters.module.ts` |

**הקבצים, לפי הסדר.**
1. `packages/adapters/src/<provider>.ts`. שינוי ב interface שובר את שני המימושים, וזה מכוון.
2. `packages/adapters/src/index.ts`, export לקובץ חדש.
3. `packages/config/src/env.ts`. ה enum של הספק, `STORAGE_PROVIDER` בשורה 79, `PAYMENT_PROVIDER` בשורה 101, `SHIPPING_PROVIDER` בשורה 179, `EMAIL_PROVIDER` בשורה 196. המפתחות שחובה לכל ספק ב `superRefine`, שורות 287 עד 331. הסירוב ל sandbox בייצור, שורות 333 עד 412.
4. `.env.example`, תיעוד המשתנים החדשים.
5. `apps/api/src/shared/adapters/adapters.module.ts`, ה factory שבוחר מימוש. ה services מקבלים את ה adapter דרך `@Inject(PAYMENT_ADAPTER)`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` או `STORAGE_ADAPTER`.
6. ה worker. `emailAdapter()` ב `apps/worker/src/jobs/outbox-dispatch.ts` שורות 57 עד 73 הוא עותק של ה factory לדואר. `tracking-refresh.ts` שורה 10 משתמש תמיד ב sandbox, וזה E17.
7. בדיקת חוזה ב `tests/contract/<provider>-adapter.test.ts` או `tests3/contract/`.

**sandbox מול אמיתי.**
- **sandbox** מיועד לפיתוח ולבדיקות. `SandboxPaymentAdapter` מסלק כל חיוב ולא מאמת webhook. `SandboxShippingAdapter` ממציא תעריפים, מחזיר מספר מעקב `SBX...`, ו `getTracking` מחזיר תמיד `in_transit`. `SandboxStorageAdapter` מחזיר מפתח ולא שומר כלום. `ConsoleEmailAdapter` מדפיס `[email] to=... template=...` עם המשתנים, כולל הקישורים.
- **אמיתי מול סביבת בדיקה של הספק** הוא הדרך לבדוק את האינטגרציה בלי כסף אמיתי. PayPal עם `PAYPAL_ENVIRONMENT=sandbox`, שמכוון ל `api-m.sandbox.paypal.com`. EasyPost עם מפתח שמתחיל ב `EZTK`, ש `isTestMode` מזהה. SMTP לתיבת בדיקה. MinIO במקום S3.
- **ייצור** מסרב ל sandbox פעמיים. `env.ts` מסרב ל `PAYMENT_PROVIDER=sandbox`, `SHIPPING_PROVIDER=sandbox`, `STORAGE_PROVIDER=sandbox` ו `EMAIL_PROVIDER=console` כש `NODE_ENV=production`, וה factory ב `adapters.module.ts` זורק שוב.

**לפי ספק.**
- **PayPal.** צריך `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` ו `PAYPAL_WEBHOOK_ID`. ה webhook מגיע ל `POST /api/v1/webhooks/payment`, שהוא `@Public()`, ו `verifyWebhook` מאמת אותו בקריאה ל PayPal. ה controller מעביר `JSON.stringify(req.body)` ולא את הבתים המקוריים. זה מספיק ל PayPal, אבל ספק שבודק HMAC על הגוף ייכשל. E3, אין בשום מקום יצירה של PayPal order, ולכן טעינה מיידית בכרטיס לא יכולה לעבוד מול PayPal אמיתי.
- **EasyPost.** `EASYPOST_API_KEY` חובה, `EASYPOST_BASE_URL` אופציונלי. אותו host לבדיקה ולייצור, והמפתח קובע. כל משלוח שנשלח בייצור נשאר `in_transit` עד שמתקנים את E17.
- **דואר.** שתי כניסות. ה API שולח בעצמו אימות מייל ואיפוס סיסמה, עם קישור שנבנה מ `APP_BASE_URL` בצורה `/#/verify-email?token=`. ה worker שולח הודעות מה outbox, רק לחשבון `active`. שינוי בבחירת הספק נעשה בשני המקומות. `SMTP_SECURE` נקרא דרך `booleanFromEnv`, ולכן `false` הוא באמת false.

**מלכודות.**
- ה API וה worker קוראים את `@bault/adapters` מ `dist`. אחרי כל שינוי, `pnpm --filter @bault/adapters build` ואתחול של שניהם. בדיקות החוזה קוראות מ `src` דרך alias, ולכן יעברו גם כשה API רץ עם הגרסה הישנה.
- בדיקות החוזה לא יוצאות לרשת. `PayPalConfig` מקבל `fetchImpl` להזרקה, ובדיקת EasyPost משתמשת ב `vi.stubGlobal('fetch', ...)`. בדיקה שקוראת לספק האמיתי לא שייכת ל CI.
- סכומים. הספקים עובדים במחרוזות עשרוניות, והיומן בסנטים שלמים. ההמרות `toMinor` ו `toDecimal` נמצאות בכל adapter. אל תעבירו `number` עשרוני לשום מקום ב API.
- קריאה לספק מתוך טרנזקציה פתוחה מחזיקה נעילות כל זמן הקריאה. ראו מתכון 6, סעיף 11.

**איך מוכיחים.**

```bash
pnpm --filter @bault/adapters build && pnpm --filter @bault/config build
pnpm test:contract && pnpm test:core-contract
cd packages/config && node -e "
const { loadEnv } = require('./dist/env.js');
console.log(loadEnv().PAYMENT_PROVIDER, loadEnv().SHIPPING_PROVIDER, loadEnv().EMAIL_PROVIDER)"
```

אחר כך העלו API עם הספק בסביבת הבדיקה שלו ועברו את הזרימה פעם אחת ביד. לדואר, הירשמו עם כתובת אמיתית וקבלו את מייל האימות. ל EasyPost, צרו משלוח ובחרו תעריף. ל PayPal, הפעילו webhook מה dashboard של PayPal sandbox מול כתובת ציבורית שמפנה ישירות לפורט של ה API. `pnpm tunnel` לא מתאים לזה, כי הוא שם סיסמת Basic Auth לפני הכל, כולל `/api`, ו PayPal לא יעבור אותה.

### מתכון 10. לפני push

**הבסיס, לכל שינוי.**

```bash
pnpm --filter "./packages/*" build
pnpm lint
pnpm typecheck
pnpm test:web && pnpm test:ux && pnpm test:contract && pnpm test:core-contract
```

`pnpm lint` הוא `eslint .` עם `eslint.config.mjs`. `no-explicit-any` ו `no-unused-vars` הם אזהרות, ואזהרה לא מכשילה. `pnpm typecheck` מריץ `tsc --noEmit` בכל חבילה, וצריך את ה `dist` של `packages/*`, ולכן ה build קודם.

**אילו בדיקות עוד, לפי מה ששיניתם.** כל חבילה שתלויה במסד רצה אחרי seed משלה, לפי מתכון 2.

| שיניתם | מה להריץ |
|---|---|
| route או service ב API | ה integration של המודול, `sec-authorization.test.ts` ו `sec-validation.test.ts` ב `core` |
| כסף או בעלות | `test:concurrency`, `test:property`, `fin-invariants`, `band1` עד `band3` ב `core`, ובדיקת מקביליות חדשה |
| schema או migration | migrate על מסד ריק, ארבע חבילות המסד, הרצה ידנית של כל job שנוגע בטבלה, ובדיקת E2 מ `dist` |
| worker | `pnpm --filter @bault/worker typecheck`, הרצה ידנית של ה job, `test:web` בגלל `notification-catalogue` |
| SPA | `test:web`, `test:ux`, `node scripts/design-lint.mjs`, `pnpm --filter @bault/web build` |
| adapter | `test:contract`, `test:core-contract`, build של `packages/adapters`, ואתחול של ה API וה worker |
| `packages/config/src/env.ts` | `test:core-contract`, ועלייה של ה API עם `.env` של פיתוח ועם `NODE_ENV=production` |

**מה ה CI עושה.** יש workflow אחד, `.github/workflows/ci.yml`, עם job אחד בשם `verify`, על כל push ו pull request.
1. Postgres 16 כ service, ו MinIO מ `quay.io/minio/minio` כצעד, עם `mc mb` ל `bault-images`.
2. pnpm מ `packageManager`, Node 24, `pnpm install --frozen-lockfile`.
3. build של `packages/*`, lint, typecheck.
4. `test:web`, `ux`, `test:core-contract`, `test:contract`.
5. migrate ו seed פעם אחת.
6. `pnpm --filter @bault/api build`, `node apps/api/dist/main.js` ברקע, והמתנה עד 60 שניות ל `readyz`.
7. `test:integration`, `test:core`, `test:concurrency`, `test:property`.

הסביבה ב CI היא `NODE_ENV=test`, `PAYMENT_PROVIDER=sandbox`, `STORAGE_PROVIDER=s3`, `DATABASE_URL` ו `DIRECT_DATABASE_URL` שניהם על 5432, ומגבלות קצב 5000 ו 20000. כדי לשחזר כשל של CI מקומית, השתמשו באותם ערכים.

**מה ה CI לא בודק, ולכן אתם בודקים.**
- ה worker לא רץ בכלל. אף job לא נבדק.
- `vite build` של ה SPA לא רץ. רק typecheck.
- אף Dockerfile לא נבנה, וה migrate לא רץ מ `dist`, ולכן E2 לא נתפס.
- seed אחד לפני ארבע חבילות, ולכן כשל של E16 יכול להופיע שם ולא אצלכם, או ההפך.
- ה CI רץ על Node 24, וה images על `node:20-slim`.
- אין ספק אמיתי. הכל sandbox, חוץ מהאחסון.

### מתכון 11. מתסמין לקובץ

חמש עשרה התקלות הסבירות ביותר, מה גורם להן בדרך כלל, ואיפה מתחילים לחפש. לפני כל שורה, קחו את `x-request-id` של הבקשה ואת גוף השגיאה, לפי מתכון 3.

| # | תסמין | סיבה סבירה | קובץ ומה לבדוק |
|---|---|---|---|
| 1 | ה API, ה worker או ה migrate לא עולים עם `Invalid environment configuration` | משתנה חסר או לא חוקי. הנפוץ ביותר הוא `PAYMENT_PROVIDER=paypal` מקובץ הדוגמה בלי מפתחות PayPal | `packages/config/src/env.ts`, הסכמה בשורות 53 עד 286 וה `superRefine` בשורות 287 עד 331. ההודעה מפרטת כל שדה. בדקו גם שאין `.env` נוסף ב cwd |
| 2 | הדפדפן מראה `api_unreachable`, או `[vite] API unreachable` בטרמינל | ה API לא רץ, נפל, או רץ על פורט אחר | `apps/web/vite.config.ts` ו `apps/web/proxy-target.ts`. השורה `[vite] /api →` מראה לאן Vite פונה. `curl http://localhost:3000/api/v1/healthz` |
| 3 | אחרי התחברות חוזרים מיד למסך הכניסה, או 401 על כל בקשה | ה cookie לא נשמר או לא נשלח. `NODE_ENV=production` על http מסמן אותו `Secure`. פנייה ישירה ל 3000 מ 5173 בלי ה proxy. seed שמחק את `login_session`. session שפג אחרי שבעה ימים | `acc/auth.controller.ts` שורות 195 עד 198 קובעות את ה cookie. `acc/session-auth.guard.ts` ו `acc/session.service.ts` `resolve`. `App.tsx` `probeSession` מעביר ל anonymous על 401. בדקו בכלי המפתחים cookie בשם `session` על `localhost:5173`, ואת `login_session` לפי מתכון 3 |
| 4 | 403 `account_suspended` או `Requires role` | המשתמש `pending` או `suspended`, או חסר לו תפקיד. ה job `wallet.suspension-sweep` משעה אוטומטית ארנק מתחת ל `WALLET_SUSPEND_BELOW_MINOR` | `acc/session-auth.guard.ts`, `sec/roles.guard.ts`, `@Roles` במתודה מול המחלקה. `select username, role, status, auto_suspended_at from user_account`. `apps/worker/src/jobs/wallet-suspension.ts` |
| 5 | 429 `rate_limited` | דלי `auth` חל על כל handler, לפי IP, עם `AUTH_RATE_LIMIT_PER_MINUTE`, 10 בקובץ הדוגמה. `MAIL_ROUTE` קבוע על 5 לדקה | `app.module.ts` ה `ThrottlerModule`, `acc/auth.controller.ts` שורות 22 ו 34. בפיתוח העלו את שני הערכים ב `.env` ואתחלו את ה API, כי המונים בזיכרון |
| 6 | 400 `validation_failed` על בקשה שנראית תקינה | שדה שלא מוגדר ב DTO, כי `forbidNonWhitelisted`. אובייקט מקונן בלי `@Type`. טופס במקום JSON | ה DTO בקובץ ה controller, ו `main.ts` שורות 130 עד 137. השדות הבעייתיים מופיעים ב `error.details` |
| 7 | 400 `No pricing rule for action "x"` | אין שורה בתוקף ב `pricing_rule` לפעולה. מסד בלי seed, E6 | `prc/pricing.service.ts` שורה 111. `select action_type, effective_from, effective_to from pricing_rule`. בפיתוח seed, בייצור מחירון דרך המנהל |
| 8 | 500 בהעלאת תמונה | `STORAGE_PROVIDER=s3` בלי MinIO או בלי bucket. כשל אחסון הופך ל 500 כללי, E10. תמונה גדולה מ 16MB מקבלת 413 | `med/media.service.ts` שורה 109, `packages/adapters/src/s3.ts`. `curl http://localhost:9000/minio/health/live` ו `mc ls local/bault-images`. בפיתוח אפשר `STORAGE_PROVIDER=sandbox` |
| 9 | 500 אחר | `Error` רגיל במקום `AppError`. deadlock בין שני מסלולים שנועלים בסדר שונה. `append_only_violation` מ trigger אחרי UPDATE או DELETE על טבלת היסטוריה. עמודה חדשה ב TypeScript בלי migration | הלוג של ה API עם המזהה, מתכון 3. `shared/errors/all-exceptions.filter.ts`. `src/db/sql/0001_append_only.sql`. `drizzle.__drizzle_migrations` |
| 10 | יתרה שלילית אחרי קנייה, או יתרה שלא מתאימה ליומן | E1 ו E18, בדיקת יתרה בלי נעילה. `ledger.record` בלי `tx`. job שרץ פעמיים | מתכון 6. `pay/ledger.service.ts`. שאילתות ה SUM במתכון 6. הלוג של ה worker מדפיס `[job:ledger-invariant] ALERT` כשיש שורות סכום לא חיוביות או חיובים מסולקים בלי שורת יומן |
| 11 | פריט אצל הבעלים הלא נכון, או עבר פעמיים | E4, `transferOwnership` לא בודק בעלים צפוי. אישור דו שלבי שנצרך פעמיים במקביל | `cst/custody.service.ts` שורה 147, `shared/confirmation/confirmation.service.ts` שורה 40. `custody_event` של הפריט לפי סדר זמן |
| 12 | job לא רץ | ה worker לא רץ, כי `pnpm dev` לא מעלה אותו. ה job נכשל ונוסה שוב פעמיים. ה cron ב UTC | `apps/worker/src/index.ts` שורות 40 עד 71. `pgboss.schedule` ו `pgboss.job` עם `state` ו `output`. `pnpm dev:worker` ושורות `registered` |
| 13 | הודעה או מייל לא הגיעו | `outbox_message.dispatched_at` עדיין ריק. ב payload אין מפתח נמען. המשתמש כיבה את הערוץ. החשבון לא `active` ולכן לא נשלח מייל. `EMAIL_PROVIDER=console` מדפיס במקום לשלוח | `apps/worker/src/jobs/outbox-dispatch.ts`, `recipientsOf` ו `channelEnabled`. `notification` עם `status` ו `failure_reason`. `notification_preference` |
| 14 | משלוח תקוע | `awaiting_payment` כשהארנק לא כיסה, ואחרי `PAYMENT_WINDOW_DAYS`, שבעה ימים, `shipment.expiry-sweep` מבטל. `labeled` עד שהמחסן סורק dispatch. `in_transit` לנצח כי `tracking-refresh.ts` משתמש תמיד ב sandbox שמחזיר `in_transit`, E17 | `shp/shipment.service.ts`, `shp/dispatch.service.ts`, `shp/shipping-options.ts` שורה 105, `apps/worker/src/jobs/shipment-expiry.ts` ו `tracking-refresh.ts`. `select code, status, payment_due_at, tracking_number, updated_at from shipment` |
| 15 | שינוי לא נכנס לתוקף | שינוי ב `packages/*` בלי build, כי ה API וה worker קוראים מ `dist`. migration בלי רשומה ב `_journal.json` או עם `when` קטן מדי. מחרוזת שנוספה רק ל `he` | `pnpm --filter "./packages/*" build` ואתחול. `apps/api/src/db/migrations/meta/_journal.json` מול `drizzle.__drizzle_migrations`. `pnpm --filter @bault/web typecheck` |

**שים לב.** בדיקה שנכשלת ב 409 שלא היה קודם היא כמעט תמיד שאריות מהרצה קודמת, E16. seed ואז הרצה חוזרת, לפני שמחפשים באג.
