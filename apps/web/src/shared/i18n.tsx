import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Hebrew/English i18n for the SPA.
 *
 * Hebrew remains the default locale. The Hebrew catalogue is the source of truth:
 * `MessageKey` is derived from it, so the English catalogue is a total map over the
 * same keys and TypeScript fails the build if a translation is missing.
 *
 * Switching locale also flips the document direction — the stylesheet uses CSS
 * logical properties throughout, so LTR falls out of the `dir` attribute with no
 * per-rule overrides.
 */
export type Locale = 'he' | 'en';

export const DEFAULT_LOCALE: Locale = 'he';
export const LOCALES: readonly Locale[] = ['he', 'en'] as const;

const STORAGE_KEY = 'bault.locale';

/** Values may contain {placeholders}, substituted from the vars argument. */
export type MessageVars = Record<string, string | number>;

const he = {
  // ---- App shell ----
  'app.title': 'Bault — כספת ושוק לפריטי אספנות',
  'app.loading': 'טוען…',
  'app.logout': 'התנתק',
  'app.signedInAs': 'מחובר כ{role}',
  'app.switchLanguage': 'English',
  'app.switchLanguageLabel': 'החלף שפה',

  'role.user': 'אספן',
  'role.warehouse_operator': 'עובד מחסן',
  'role.admin': 'מנהל',

  'tab.vault': 'הכספת',
  'tab.wallet': 'ארנק',
  'tab.marketplace': 'שוק',
  'tab.services': 'שירותים',
  'tab.shipping': 'משלוח',
  'tab.notifications': 'התראות',
  'tab.profile': 'פרופיל',
  'tab.warehouse': 'קונסולת מחסן',
  'tab.admin': 'ניהול',

  // ---- Card photo lightbox ----
  'photo.show': 'הצג תמונה',
  'photo.showOf': 'הצג תמונה של {title}',
  'photo.close': 'סגור',
  'photo.missing': 'אין תמונה זמינה לפריט זה.',

  // ---- Service requests (shared: customer + operator) ----
  'service.type.professional_photography': 'צילום מקצועי',
  'service.type.third_party_grading': 'דירוג',
  'service.type.consignment': 'קונסיגנציה',
  'service.type.donation': 'תרומה',
  'service.type.batch_split': 'פיצול אצווה',
  'service.type.warehouse_transfer': 'העברת מחסן',
  'service.status.requested': 'ממתין',
  'service.status.in_progress': 'אושר',
  'service.status.completed': 'הושלם',
  'service.status.cancelled': 'נדחה',

  // ---- Auth ----
  'auth.signInTitle': 'כניסה',
  'auth.signUpTitle': 'הרשמה',
  'auth.identifier': 'אימייל או שם משתמש',
  'auth.identifierHint': 'אפשר להתחבר עם האימייל או עם שם המשתמש — אחד מהם מספיק.',
  'auth.email': 'אימייל',
  'auth.password': 'סיסמה',
  'auth.passwordHint': 'לפחות 8 תווים.',
  'auth.signIn': 'התחבר',
  'auth.signUp': 'הרשם',
  'auth.noAccount': 'אין לך חשבון?',
  'auth.haveAccount': 'כבר יש לך חשבון?',
  'auth.goToSignIn': 'מעבר לכניסה',
  'auth.registerSuccess': 'נרשמת! מזהה קליטה: {intakeId}. בדוק את המייל לאימות.',
  'auth.demoUsers':
    'משתמשי דמו (סיסמה 11111111): red@bault.dev · golden@bault.dev (אספנים) · hermon@bault.dev (מחסן) · eldar@bault.dev (מנהל)',

  'auth.username': 'שם משתמש',
  'auth.usernameHint': 'שם המשתמש נקבע פעם אחת בהרשמה ולא ניתן לשינוי.',

  // ---- Vault ----
  'vault.title': 'הכספת שלי',
  'vault.searchPlaceholder': 'חיפוש חופשי',
  'vault.search': 'חפש',
  'vault.condition': 'מצב: {grade}',

  // ---- Wallet ----
  'wallet.title': 'הארנק שלי',
  'wallet.currentBalance': 'יתרה נוכחית',
  'wallet.topup': 'טען ארנק (בסנטים)',
  'wallet.transactions': 'תנועות',
  'wallet.col.date': 'תאריך',
  'wallet.col.type': 'סוג',
  'wallet.col.amount': 'סכום',

  // ---- Marketplace ----
  'market.title': 'שוק',
  'market.searchPlaceholder': 'חיפוש בשוק',
  'market.search': 'חפש',
  'market.sellLegend': 'מכירת פריט',
  'market.selectItemOption': '— בחר פריט —',
  'market.listForSale': 'הצע למכירה (בסנטים)',
  'market.buy': 'קנה',
  'market.makeOffer': 'הצע מחיר',
  'market.offerPrompt': 'סכום הצעה (בסנטים):',
  'market.status.purchased': 'הרכישה הושלמה',
  'market.status.offerSent': 'ההצעה נשלחה',
  'market.status.selectItem': 'בחר פריט למכירה',
  'market.status.listed': 'הפריט הוצע למכירה',

  // ---- Services (customer) ----
  'services.title': 'שירותים',
  'services.pickItem': 'בחר פריט מהכספת שלך:',
  'services.pickItemOption': '— בחר פריט —',
  'services.noItems': 'אין פריטים מאוחסנים זמינים בכספת.',
  'services.selectItemFirst': 'בחר פריט קודם',
  'services.photography': 'צילום מקצועי',
  'services.photographyRequested': 'בקשת צילום נשלחה',
  'services.grading': 'דירוג צד ג׳',
  'services.gradingRequested': 'בקשת דירוג נשלחה',
  'services.consignment': 'מכירה בקונסיגנציה',
  'services.consignmentRequested': 'בקשת קונסיגנציה נשלחה',
  'services.donation': 'תרומה',
  'services.donated': 'הפריט נתרם',
  'services.myRequests': 'הבקשות שלי',
  'services.noRequests': 'לא שלחת עדיין בקשות.',
  'services.colService': 'שירות',
  'services.colStatus': 'סטטוס',
  'services.colDate': 'תאריך',

  // ---- Shipping ----
  'shipping.title': 'משלוח',
  'shipping.selectItemFirst': 'בחר פריט',
  'shipping.created': 'נוצר משלוח — בחר תעריף',
  'shipping.rateSelected': 'נבחר {carrier} {serviceLevel} — {amount}. ממתין לשילוח במחסן.',
  'shipping.itemPlaceholder': '— בחר פריט —',
  'shipping.addressPlaceholder': 'כתובת יעד',
  'shipping.rush': 'משלוח מהיר',
  'shipping.createAndGetRates': 'צור משלוח וקבל תעריפים',
  'shipping.selectRate': 'בחר',

  // ---- Notifications ----
  'notifications.title': 'התראות',
  'notifications.preferences.title': 'העדפות התראות',
  'notifications.preferences.hint': 'בחר על אילו אירועים תרצה לקבל התראות.',
  'notifications.mine': 'ההתראות שלי ({n})',
  'notifications.empty': 'אין התראות עדיין.',
  'notifications.col.event': 'אירוע',
  'notifications.col.content': 'תוכן',
  'notifications.col.date': 'תאריך',
  'notifications.event.item_received': 'פריט התקבל',
  'notifications.event.item_sold': 'פריט נמכר',
  'notifications.event.offer_received': 'התקבלה הצעה',
  'notifications.event.shipment_out': 'משלוח יצא',
  'notifications.event.hold_placed': 'הוטלה החזקה',

  // ---- Profile ----
  'profile.title': 'פרופיל',
  'profile.details.heading': 'הפרטים שלי',
  'profile.details.email': 'אימייל:',
  'profile.details.intakeId': 'מזהה קליטה:',
  'profile.details.role': 'תפקיד:',
  'profile.role.user': 'אספן',
  'profile.role.warehouse_operator': 'עובד מחסן',
  'profile.role.admin': 'מנהל',
  'profile.displayNamePlaceholder': 'שם תצוגה',
  'profile.saveName': 'שמור שם',
  'profile.status.nameSaved': 'השם נשמר',
  'profile.status.addressDeleted': 'הכתובת נמחקה',
  'profile.status.addressAdded': 'הכתובת נוספה',
  'profile.addresses.heading': 'כתובות למשלוח',
  'profile.addresses.empty': 'לא נשמרו כתובות עדיין.',
  'profile.addresses.default': 'ברירת מחדל',
  'profile.addresses.delete': 'מחק',
  'profile.addressForm.legend': 'הוספת כתובת',
  'profile.addressForm.label': 'תווית (למשל: בית)',
  'profile.addressForm.recipient': 'שם הנמען',
  'profile.addressForm.line1': 'רחוב ומספר',
  'profile.addressForm.city': 'עיר',
  'profile.addressForm.country': 'מדינה',
  'profile.addressForm.countryDefault': 'ישראל',
  'profile.addressForm.postalCode': 'מיקוד',
  'profile.addressForm.isDefault': 'ברירת מחדל',
  'profile.addressForm.submit': 'הוסף כתובת',

  // ---- Warehouse console ----
  'warehouse.title': 'קונסולת מחסן',
  'warehouse.intake.legend': 'קליטת פריט',
  'warehouse.intake.ownerIntakeId': 'מזהה קליטה של הבעלים',
  'warehouse.intake.typeClass': 'סוג/מחלקה',
  'warehouse.intake.binId': 'מזהה תא (אופציונלי)',
  'warehouse.intake.submit': 'קלוט',
  'warehouse.relocate.legend': 'העברת פריט (סרוק פריט, סרוק מדף)',
  'warehouse.relocate.scanItem': 'סרוק פריט',
  'warehouse.relocate.scanShelf': 'סרוק מדף',
  'warehouse.relocate.submit': 'העבר',
  'warehouse.dispatch.legend': 'שילוח (סרוק פריטים, אשר)',
  'warehouse.dispatch.shipmentId': 'מזהה משלוח',
  'warehouse.dispatch.scannedItems': 'פריטים שנסרקו (מופרד בפסיק)',
  'warehouse.dispatch.submit': 'אשר ושלח',
  'warehouse.bins.legend': 'תאים ומדפים',
  'warehouse.bins.zone': 'אזור',
  'warehouse.bins.capacity': 'קיבולת',
  'warehouse.bins.barcode': 'ברקוד (אופציונלי)',
  'warehouse.bins.create': 'צור תא',
  'warehouse.bins.empty': 'אין תאים עדיין.',
  'warehouse.bins.colBarcode': 'ברקוד',
  'warehouse.bins.colZone': 'אזור',
  'warehouse.bins.colCapacity': 'קיבולת',
  'warehouse.report.legend': 'דוח מלאי',
  'warehouse.report.cutLabel': 'חתך:',
  'warehouse.report.cut.shelf': 'לפי מדף',
  'warehouse.report.cut.owner': 'לפי בעלים',
  'warehouse.report.cut.condition': 'לפי מצב',
  'warehouse.report.cut.itemClass': 'לפי מחלקת פריט',
  'warehouse.report.empty': 'אין נתונים להצגה.',
  'warehouse.report.colCount': 'כמות',
  'warehouse.report.noValue': '— ללא —',
  'warehouse.log.title': 'יומן',
  'warehouse.log.intakeDone': 'נקלט פריט {barcode} ({id})',
  'warehouse.log.intakeError': 'שגיאת קליטה: {message}',
  'warehouse.log.relocateDone': 'הועבר {item} → {bin}',
  'warehouse.log.relocateError': 'שגיאת העברה: {message}',
  'warehouse.log.dispatchDone': 'נשלח {id} · מעקב {tracking}',
  'warehouse.log.dispatchError': 'שגיאת שילוח: {message}',
  'warehouse.log.binCreated': 'נוצר תא {barcode} באזור {zone}',
  'warehouse.log.binCreateError': 'שגיאת יצירת תא: {message}',

  // ---- Service queue (operator) ----
  'queue.title': 'בקשות שירות',
  'queue.empty': 'אין בקשות ממתינות.',
  'queue.col.service': 'שירות',
  'queue.col.customer': 'לקוח',
  'queue.col.item': 'פריט',
  'queue.col.status': 'סטטוס',
  'queue.col.actions': 'פעולות',
  'queue.action.approve': 'אשר',
  'queue.action.decline': 'דחה',
  'queue.action.finishPhotography': 'סיים צילום',
  'queue.action.finishGrading': 'סיים דירוג',
  'queue.action.finishSale': 'סיים מכירה (סנטים)',
  'queue.msg.approved': 'הבקשה אושרה',
  'queue.msg.declined': 'הבקשה נדחתה',
  'queue.msg.photographyDone': 'הצילום הושלם',
  'queue.msg.gradingDone': 'הדירוג הושלם',
  'queue.msg.saleDone': 'המכירה הושלמה',

  // ---- Admin console ----
  'admin.title': 'ניהול',
  'admin.section.users': 'משתמשים',
  'admin.section.items': 'פריטים',
  'admin.section.pricing': 'תמחור',
  'admin.section.disputes': 'מחלוקות',
  'admin.section.storage': 'דמי אחסון',
  'admin.col.status': 'סטטוס',
  'admin.action.save': 'שמור',
  'admin.users.heading': 'חשבונות ({count})',
  'admin.users.col.email': 'אימייל',
  'admin.users.col.name': 'שם',
  'admin.users.col.role': 'תפקיד',
  'admin.users.saved': 'נשמר: {email}',
  'admin.items.heading': 'פריטים ({count})',
  'admin.items.col.barcode': 'ברקוד',
  'admin.items.col.description': 'תיאור',
  'admin.items.col.type': 'סוג',
  'admin.items.col.condition': 'מצב',
  'admin.items.col.owner': 'בעלים',
  'admin.items.col.lifecycle': 'מצב חיים',
  'admin.items.col.hold': 'מוקפא',
  'admin.items.col.photo': 'תמונה',
  'admin.items.saved': 'נשמר פריט: {barcode}',
  'admin.pricing.action.intake': 'קליטה',
  'admin.pricing.action.storage': 'אחסון',
  'admin.pricing.action.service': 'שירות',
  'admin.pricing.action.shipping': 'משלוח',
  'admin.pricing.action.marketplaceFee': 'עמלת שוק',
  'admin.pricing.model.fixed': 'סכום קבוע',
  'admin.pricing.model.percentage': 'אחוז',
  'admin.pricing.heading': 'כללי תמחור ({count})',
  'admin.pricing.newRule': 'כלל חדש',
  'admin.pricing.itemClassPlaceholder': 'מחלקת פריט (ריק = הכל)',
  'admin.pricing.addRule': 'הוסף כלל',
  'admin.pricing.created': 'כלל תמחור נוסף',
  'admin.pricing.valueHint': 'ערך: בסנטים עבור סכום קבוע; בנקודות בסיס עבור אחוז (100 = 1%).',
  'admin.pricing.col.action': 'פעולה',
  'admin.pricing.col.class': 'מחלקה',
  'admin.pricing.col.model': 'מודל',
  'admin.pricing.col.value': 'ערך',
  'admin.pricing.col.currency': 'מטבע',
  'admin.pricing.col.effectiveFrom': 'בתוקף מ־',
  'admin.pricing.allClasses': 'הכל',
  'admin.disputes.status.open': 'פתוחה',
  'admin.disputes.status.investigating': 'בחקירה',
  'admin.disputes.status.ruled': 'הוכרעה',
  'admin.disputes.status.closed': 'סגורה',
  'admin.disputes.heading': 'מחלוקות ({count})',
  'admin.disputes.openLegend': 'פתיחת מחלוקת',
  'admin.disputes.transactionIdPlaceholder': 'מזהה עסקה',
  'admin.disputes.notePlaceholder': 'הערה (אופציונלי)',
  'admin.disputes.openButton': 'פתח מחלוקת',
  'admin.disputes.opened': 'מחלוקת נפתחה',
  'admin.disputes.empty': 'אין מחלוקות.',
  'admin.disputes.col.id': 'מזהה',
  'admin.disputes.col.transaction': 'עסקה',
  'admin.disputes.col.ruling': 'הכרעה',
  'admin.disputes.col.update': 'עדכון',
  'admin.disputes.updateButton': 'עדכן',
  'admin.disputes.updated': 'המחלוקת עודכנה',
  'admin.storage.previousRuns': 'הרצות קודמות ({count})',
  'admin.storage.empty': 'לא בוצעו הרצות עדיין.',
  'admin.storage.col.date': 'תאריך',
  'admin.storage.col.thresholdDays': 'סף ימים',
  'admin.storage.col.chargedItems': 'פריטים שחויבו',
  'admin.storage.col.total': 'סה״כ',
  // ---- Requirements: shipping, pricing, disputes, storage, intake, history, notifications ----
  'admin.storage.autoNotice': 'החיוב אוטומטי לחלוטין: משימה יומית מחייבת כל חשבון עם פריטים המאוחסנים יותר מיום אחד. אין הפעלה ידנית.',
  'admin.pricing.descriptionPlaceholder': 'תיאור הכלל',
  'admin.pricing.col.description': 'תיאור',
  'admin.pricing.col.billing': 'חיוב',
  'admin.pricing.billing.perEvent': 'לכל פעולה',
  'admin.pricing.billing.daily': 'יומי',
  'admin.pricing.billing.weekly': 'שבועי',
  'admin.pricing.billing.monthly': 'חודשי',
  'admin.pricing.billingHint': 'מתי הכלל מחייב: לכל פעולה (בעת האירוע) או לפי לוח זמנים קבוע (יומי/שבועי/חודשי).',
  'admin.disputes.selectTransaction': '— בחר עסקה —',
  'admin.disputes.noTransactions': 'אין עסקאות מתועדות לפתיחת מחלוקת.',
  'admin.transactions.heading': 'עסקאות ({count})',
  'shipping.selectItems': 'בחר פריטים למשלוח',
  'shipping.noItems': 'אין פריטים זמינים למשלוח.',
  'shipping.selectAddressFirst': 'בחר כתובת יעד',
  'shipping.createdWithId': 'נוצר משלוח {id} — בחר תעריף',
  'shipping.manageAddressesHint': 'הוסף כתובות משלוח בעמוד הפרופיל.',
  'shipping.shipmentIdLabel': 'מזהה משלוח: {id}',
  'profile.address.edit': 'ערוך',
  'profile.address.save': 'שמור כתובת',
  'profile.address.cancel': 'ביטול',
  'profile.address.updated': 'הכתובת עודכנה',
  'intake.quantity': 'כמות',
  'intake.binRequired': 'בחר תא (חובה)',
  'intake.selectBin': '— בחר תא —',
  'intake.isLot': 'פריט לוט (נספר כפריט אחד)',
  'intake.lotSize': 'מספר פריטים בלוט',
  'intake.breakLot': 'פירוק לוט',
  'intake.bulkDone': 'נקלטו {count} פריטים',
  'vault.history': 'היסטוריה',
  'vault.historyTitle': 'היסטוריית פריט',
  'vault.bin': 'תא: {bin}',
  'vault.isLot': 'לוט',
  'warehouse.fulfill': 'מילוי הזמנה',
  'warehouse.fulfillShipment': 'מילוי משלוח',
  'warehouse.carrier': 'מוביל',
  'warehouse.trackingNumber': 'מספר מעקב',
  'warehouse.packageWeight': 'משקל חבילה (גרם)',
  'warehouse.itemsVerified': 'כל הפריטים אומתו ונארזו',
  'warehouse.notes': 'הערות',
  'warehouse.complete': 'סיים',
  'warehouse.required': 'כל השדות נדרשים',
  'warehouse.intake.description': 'תיאור',
  'warehouse.intake.condition': 'מצב',
  'warehouse.report.exportPdf': 'ייצוא PDF',

  // ---- Profile: immutable username + address editing ----
  'profile.details.username': 'שם משתמש:',
  'profile.details.usernameImmutable': 'קבוע — לא ניתן לשינוי',
  'profile.displayNameLabel': 'שם תצוגה',

  // ---- Vault: bin, lot and item history ----
  'vault.noBin': 'ללא תא',
  'vault.lotOf': 'לוט של {count}',
  'vault.historyEmpty': 'אין עדיין אירועים לפריט זה.',
  'vault.historyLoading': 'טוען היסטוריה…',
  'vault.historyCol.date': 'תאריך',
  'vault.historyCol.event': 'אירוע',
  'vault.historyCol.details': 'פרטים',

  // ---- Warehouse: break lot ----
  'warehouse.lots.legend': 'לוטים פתוחים',
  'warehouse.lots.empty': 'אין לוטים שלמים לפירוק.',
  'warehouse.lots.colLot': 'לוט',
  'warehouse.lots.colSize': 'פריטים',
  'warehouse.lots.broken': 'הלוט {lot} פורק ל־{count} פריטים עצמאיים',
  'warehouse.lots.breakError': 'שגיאת פירוק לוט: {message}',

  // ---- Warehouse: structured service fulfillment (Requirement 5.4) ----
  'queue.col.request': 'מספר בקשה',
  'queue.fulfill.legend': 'טופס מילוי בקשה',
  'queue.fulfill.objectKey': 'מפתח קובץ התמונות',
  'queue.fulfill.shotCount': 'מספר צילומים',
  'queue.fulfill.lighting': 'תאורה',
  'queue.fulfill.grade': 'דירוג שהתקבל',
  'queue.fulfill.gradingBody': 'גוף מדרג',
  'queue.fulfill.certificateNumber': 'מספר תעודה',
  'queue.fulfill.saleAmount': 'סכום מכירה (בסנטים)',
  'queue.fulfill.channel': 'ערוץ מכירה',
  'queue.fulfill.externalReference': 'אסמכתא חיצונית',
  'queue.fulfill.itemVerified': 'הפריט אומת פיזית',
  'queue.fulfill.notes': 'הערות',
  'queue.fulfill.submit': 'סגור בקשה',
  'queue.fulfill.required': 'יש למלא את כל השדות ולאמת את הפריט.',
  'queue.fulfill.noForm': 'סוג בקשה זה נסגר אוטומטית.',

  // ---- Barcodes ----
  'barcode.print': 'הדפס ברקוד',
  'barcode.printOf': 'הדפס את הברקוד {value}',
  'barcode.scanHint': 'ברקוד Code 128 — ניתן לסריקה',
  'warehouse.intake.lastLabels': 'תוויות שנוצרו בקליטה האחרונה',
} as const;

export type MessageKey = keyof typeof he;

const en: Record<MessageKey, string> = {
  // ---- App shell ----
  'app.title': 'Bault — Collectibles Vault & Marketplace',
  'app.loading': 'Loading…',
  'app.logout': 'Sign out',
  'app.signedInAs': 'Signed in as {role}',
  'app.switchLanguage': 'עברית',
  'app.switchLanguageLabel': 'Switch language',

  'role.user': 'Collector',
  'role.warehouse_operator': 'Warehouse operator',
  'role.admin': 'Manager',

  'tab.vault': 'Vault',
  'tab.wallet': 'Wallet',
  'tab.marketplace': 'Marketplace',
  'tab.services': 'Services',
  'tab.shipping': 'Shipping',
  'tab.notifications': 'Notifications',
  'tab.profile': 'Profile',
  'tab.warehouse': 'Warehouse console',
  'tab.admin': 'Admin',

  // ---- Card photo lightbox ----
  'photo.show': 'Show photo',
  'photo.showOf': 'Show photo of {title}',
  'photo.close': 'Close',
  'photo.missing': 'No photo available for this item.',

  // ---- Service requests (shared: customer + operator) ----
  'service.type.professional_photography': 'Professional photography',
  'service.type.third_party_grading': 'Grading',
  'service.type.consignment': 'Consignment',
  'service.type.donation': 'Donation',
  'service.type.batch_split': 'Batch split',
  'service.type.warehouse_transfer': 'Warehouse transfer',
  'service.status.requested': 'Pending',
  'service.status.in_progress': 'Approved',
  'service.status.completed': 'Completed',
  'service.status.cancelled': 'Declined',

  // ---- Auth ----
  'auth.signInTitle': 'Sign in',
  'auth.signUpTitle': 'Create an account',
  'auth.identifier': 'Email or username',
  'auth.identifierHint': 'Sign in with your email or your username — either one is enough.',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 8 characters.',
  'auth.signIn': 'Sign in',
  'auth.signUp': 'Sign up',
  'auth.noAccount': "Don't have an account?",
  'auth.haveAccount': 'Already have an account?',
  'auth.goToSignIn': 'Go to sign in',
  'auth.registerSuccess': "You're registered! Intake ID: {intakeId}. Check your email to verify.",
  'auth.demoUsers':
    'Demo users (password 11111111): red@bault.dev · golden@bault.dev (collectors) · hermon@bault.dev (warehouse) · eldar@bault.dev (manager)',

  'auth.username': 'Username',
  'auth.usernameHint': 'Your username is chosen once at sign-up and can never be changed.',

  // ---- Vault ----
  'vault.title': 'My vault',
  'vault.searchPlaceholder': 'Search',
  'vault.search': 'Search',
  'vault.condition': 'Condition: {grade}',

  // ---- Wallet ----
  'wallet.title': 'My wallet',
  'wallet.currentBalance': 'Current balance',
  'wallet.topup': 'Top up wallet (in cents)',
  'wallet.transactions': 'Transactions',
  'wallet.col.date': 'Date',
  'wallet.col.type': 'Type',
  'wallet.col.amount': 'Amount',

  // ---- Marketplace ----
  'market.title': 'Marketplace',
  'market.searchPlaceholder': 'Search the marketplace',
  'market.search': 'Search',
  'market.sellLegend': 'Sell an item',
  'market.selectItemOption': '— Select an item —',
  'market.listForSale': 'List for sale (in cents)',
  'market.buy': 'Buy',
  'market.makeOffer': 'Make offer',
  'market.offerPrompt': 'Offer amount (in cents):',
  'market.status.purchased': 'Purchase completed',
  'market.status.offerSent': 'Offer sent',
  'market.status.selectItem': 'Select an item to sell',
  'market.status.listed': 'Item listed for sale',

  // ---- Services (customer) ----
  'services.title': 'Services',
  'services.pickItem': 'Pick an item from your vault:',
  'services.pickItemOption': '— Select an item —',
  'services.noItems': 'No stored items available in your vault.',
  'services.selectItemFirst': 'Select an item first',
  'services.photography': 'Professional photography',
  'services.photographyRequested': 'Photography request sent',
  'services.grading': 'Third-party grading',
  'services.gradingRequested': 'Grading request sent',
  'services.consignment': 'Consignment sale',
  'services.consignmentRequested': 'Consignment request sent',
  'services.donation': 'Donation',
  'services.donated': 'Item donated',
  'services.myRequests': 'My requests',
  'services.noRequests': "You haven't submitted any requests yet.",
  'services.colService': 'Service',
  'services.colStatus': 'Status',
  'services.colDate': 'Date',

  // ---- Shipping ----
  'shipping.title': 'Shipping',
  'shipping.selectItemFirst': 'Select an item',
  'shipping.created': 'Shipment created — select a rate',
  'shipping.rateSelected':
    'Selected {carrier} {serviceLevel} — {amount}. Awaiting dispatch from the warehouse.',
  'shipping.itemPlaceholder': '— Select an item —',
  'shipping.addressPlaceholder': 'Destination address',
  'shipping.rush': 'Express shipping',
  'shipping.createAndGetRates': 'Create shipment and get rates',
  'shipping.selectRate': 'Select',

  // ---- Notifications ----
  'notifications.title': 'Notifications',
  'notifications.preferences.title': 'Notification preferences',
  'notifications.preferences.hint': 'Choose which events you want to be notified about.',
  'notifications.mine': 'My notifications ({n})',
  'notifications.empty': 'No notifications yet.',
  'notifications.col.event': 'Event',
  'notifications.col.content': 'Content',
  'notifications.col.date': 'Date',
  'notifications.event.item_received': 'Item received',
  'notifications.event.item_sold': 'Item sold',
  'notifications.event.offer_received': 'Offer received',
  'notifications.event.shipment_out': 'Shipment dispatched',
  'notifications.event.hold_placed': 'Hold placed',

  // ---- Profile ----
  'profile.title': 'Profile',
  'profile.details.heading': 'My details',
  'profile.details.email': 'Email:',
  'profile.details.intakeId': 'Intake ID:',
  'profile.details.role': 'Role:',
  'profile.role.user': 'Collector',
  'profile.role.warehouse_operator': 'Warehouse operator',
  'profile.role.admin': 'Manager',
  'profile.displayNamePlaceholder': 'Display name',
  'profile.saveName': 'Save name',
  'profile.status.nameSaved': 'Name saved',
  'profile.status.addressDeleted': 'Address deleted',
  'profile.status.addressAdded': 'Address added',
  'profile.addresses.heading': 'Shipping addresses',
  'profile.addresses.empty': 'No saved addresses yet.',
  'profile.addresses.default': 'Default',
  'profile.addresses.delete': 'Delete',
  'profile.addressForm.legend': 'Add address',
  'profile.addressForm.label': 'Label (e.g. Home)',
  'profile.addressForm.recipient': 'Recipient name',
  'profile.addressForm.line1': 'Street and number',
  'profile.addressForm.city': 'City',
  'profile.addressForm.country': 'Country',
  'profile.addressForm.countryDefault': 'Israel',
  'profile.addressForm.postalCode': 'Postal code',
  'profile.addressForm.isDefault': 'Default',
  'profile.addressForm.submit': 'Add address',

  // ---- Warehouse console ----
  'warehouse.title': 'Warehouse console',
  'warehouse.intake.legend': 'Item intake',
  'warehouse.intake.ownerIntakeId': 'Owner intake ID',
  'warehouse.intake.typeClass': 'Type / class',
  'warehouse.intake.binId': 'Bin ID (optional)',
  'warehouse.intake.submit': 'Intake',
  'warehouse.relocate.legend': 'Relocate item (scan item, scan shelf)',
  'warehouse.relocate.scanItem': 'Scan item',
  'warehouse.relocate.scanShelf': 'Scan shelf',
  'warehouse.relocate.submit': 'Relocate',
  'warehouse.dispatch.legend': 'Dispatch (scan items, confirm)',
  'warehouse.dispatch.shipmentId': 'Shipment ID',
  'warehouse.dispatch.scannedItems': 'Scanned items (comma-separated)',
  'warehouse.dispatch.submit': 'Confirm & dispatch',
  'warehouse.bins.legend': 'Bins & shelves',
  'warehouse.bins.zone': 'Zone',
  'warehouse.bins.capacity': 'Capacity',
  'warehouse.bins.barcode': 'Barcode (optional)',
  'warehouse.bins.create': 'Create bin',
  'warehouse.bins.empty': 'No bins yet.',
  'warehouse.bins.colBarcode': 'Barcode',
  'warehouse.bins.colZone': 'Zone',
  'warehouse.bins.colCapacity': 'Capacity',
  'warehouse.report.legend': 'Inventory report',
  'warehouse.report.cutLabel': 'Group by:',
  'warehouse.report.cut.shelf': 'By shelf',
  'warehouse.report.cut.owner': 'By owner',
  'warehouse.report.cut.condition': 'By condition',
  'warehouse.report.cut.itemClass': 'By item class',
  'warehouse.report.empty': 'No data to show.',
  'warehouse.report.colCount': 'Count',
  'warehouse.report.noValue': '— none —',
  'warehouse.log.title': 'Log',
  'warehouse.log.intakeDone': 'Intake complete: {barcode} ({id})',
  'warehouse.log.intakeError': 'Intake failed: {message}',
  'warehouse.log.relocateDone': 'Relocated {item} → {bin}',
  'warehouse.log.relocateError': 'Relocate failed: {message}',
  'warehouse.log.dispatchDone': 'Dispatched {id} · tracking {tracking}',
  'warehouse.log.dispatchError': 'Dispatch failed: {message}',
  'warehouse.log.binCreated': 'Created bin {barcode} in zone {zone}',
  'warehouse.log.binCreateError': 'Bin creation failed: {message}',

  // ---- Service queue (operator) ----
  'queue.title': 'Service requests',
  'queue.empty': 'No pending requests.',
  'queue.col.service': 'Service',
  'queue.col.customer': 'Customer',
  'queue.col.item': 'Item',
  'queue.col.status': 'Status',
  'queue.col.actions': 'Actions',
  'queue.action.approve': 'Approve',
  'queue.action.decline': 'Decline',
  'queue.action.finishPhotography': 'Finish photography',
  'queue.action.finishGrading': 'Finish grading',
  'queue.action.finishSale': 'Finish sale (cents)',
  'queue.msg.approved': 'Request approved',
  'queue.msg.declined': 'Request declined',
  'queue.msg.photographyDone': 'Photography completed',
  'queue.msg.gradingDone': 'Grading completed',
  'queue.msg.saleDone': 'Sale completed',

  // ---- Admin console ----
  'admin.title': 'Admin',
  'admin.section.users': 'Users',
  'admin.section.items': 'Items',
  'admin.section.pricing': 'Pricing',
  'admin.section.disputes': 'Disputes',
  'admin.section.storage': 'Storage fees',
  'admin.col.status': 'Status',
  'admin.action.save': 'Save',
  'admin.users.heading': 'Accounts ({count})',
  'admin.users.col.email': 'Email',
  'admin.users.col.name': 'Name',
  'admin.users.col.role': 'Role',
  'admin.users.saved': 'Saved: {email}',
  'admin.items.heading': 'Items ({count})',
  'admin.items.col.barcode': 'Barcode',
  'admin.items.col.description': 'Description',
  'admin.items.col.type': 'Type',
  'admin.items.col.condition': 'Condition',
  'admin.items.col.owner': 'Owner',
  'admin.items.col.lifecycle': 'Lifecycle',
  'admin.items.col.hold': 'On hold',
  'admin.items.col.photo': 'Photo',
  'admin.items.saved': 'Item saved: {barcode}',
  'admin.pricing.action.intake': 'Intake',
  'admin.pricing.action.storage': 'Storage',
  'admin.pricing.action.service': 'Service',
  'admin.pricing.action.shipping': 'Shipping',
  'admin.pricing.action.marketplaceFee': 'Marketplace fee',
  'admin.pricing.model.fixed': 'Flat amount',
  'admin.pricing.model.percentage': 'Percentage',
  'admin.pricing.heading': 'Pricing rules ({count})',
  'admin.pricing.newRule': 'New rule',
  'admin.pricing.itemClassPlaceholder': 'Item class (blank = all)',
  'admin.pricing.addRule': 'Add rule',
  'admin.pricing.created': 'Pricing rule added',
  'admin.pricing.valueHint':
    'Value: in cents for a flat amount; in basis points for a percentage (100 = 1%).',
  'admin.pricing.col.action': 'Action',
  'admin.pricing.col.class': 'Class',
  'admin.pricing.col.model': 'Model',
  'admin.pricing.col.value': 'Value',
  'admin.pricing.col.currency': 'Currency',
  'admin.pricing.col.effectiveFrom': 'Effective from',
  'admin.pricing.allClasses': 'All',
  'admin.disputes.status.open': 'Open',
  'admin.disputes.status.investigating': 'Investigating',
  'admin.disputes.status.ruled': 'Ruled',
  'admin.disputes.status.closed': 'Closed',
  'admin.disputes.heading': 'Disputes ({count})',
  'admin.disputes.openLegend': 'Open a dispute',
  'admin.disputes.transactionIdPlaceholder': 'Transaction ID',
  'admin.disputes.notePlaceholder': 'Note (optional)',
  'admin.disputes.openButton': 'Open dispute',
  'admin.disputes.opened': 'Dispute opened',
  'admin.disputes.empty': 'No disputes.',
  'admin.disputes.col.id': 'ID',
  'admin.disputes.col.transaction': 'Transaction',
  'admin.disputes.col.ruling': 'Ruling',
  'admin.disputes.col.update': 'Update',
  'admin.disputes.updateButton': 'Update',
  'admin.disputes.updated': 'Dispute updated',
  'admin.storage.previousRuns': 'Previous runs ({count})',
  'admin.storage.empty': 'No runs yet.',
  'admin.storage.col.date': 'Date',
  'admin.storage.col.thresholdDays': 'Day threshold',
  'admin.storage.col.chargedItems': 'Items charged',
  'admin.storage.col.total': 'Total',
  // ---- Requirements: shipping, pricing, disputes, storage, intake, history, notifications ----
  'admin.storage.autoNotice':
    'Billing is fully automatic: a daily job charges every account with items stored for more than one day. There is no manual trigger.',
  'admin.pricing.descriptionPlaceholder': 'Rule description',
  'admin.pricing.col.description': 'Description',
  'admin.pricing.col.billing': 'Billing',
  'admin.pricing.billing.perEvent': 'Per event',
  'admin.pricing.billing.daily': 'Daily',
  'admin.pricing.billing.weekly': 'Weekly',
  'admin.pricing.billing.monthly': 'Monthly',
  'admin.pricing.billingHint': 'When the rule charges: per event (at the time of the action) or on a fixed schedule (daily/weekly/monthly).',
  'admin.disputes.selectTransaction': '— Select a transaction —',
  'admin.disputes.noTransactions': 'No recorded transactions to dispute.',
  'admin.transactions.heading': 'Transactions ({count})',
  'shipping.selectItems': 'Select items to ship',
  'shipping.noItems': 'No items available to ship.',
  'shipping.selectAddressFirst': 'Select a destination address',
  'shipping.createdWithId': 'Shipment {id} created — select a rate',
  'shipping.manageAddressesHint': 'Add shipping addresses on the Profile page.',
  'shipping.shipmentIdLabel': 'Shipment ID: {id}',
  'profile.address.edit': 'Edit',
  'profile.address.save': 'Save address',
  'profile.address.cancel': 'Cancel',
  'profile.address.updated': 'Address updated',
  'intake.quantity': 'Quantity',
  'intake.binRequired': 'Select a bin (required)',
  'intake.selectBin': '— Select a bin —',
  'intake.isLot': 'Lot item (counts as one item)',
  'intake.lotSize': 'Items in the lot',
  'intake.breakLot': 'Break lot',
  'intake.bulkDone': 'Intook {count} items',
  'vault.history': 'History',
  'vault.historyTitle': 'Item history',
  'vault.bin': 'Bin: {bin}',
  'vault.isLot': 'Lot',
  'warehouse.fulfill': 'Fulfill',
  'warehouse.fulfillShipment': 'Fulfill shipment',
  'warehouse.carrier': 'Carrier',
  'warehouse.trackingNumber': 'Tracking number',
  'warehouse.packageWeight': 'Package weight (grams)',
  'warehouse.itemsVerified': 'All items verified and packed',
  'warehouse.notes': 'Notes',
  'warehouse.complete': 'Complete',
  'warehouse.required': 'All fields are required',
  'warehouse.intake.description': 'Description',
  'warehouse.intake.condition': 'Condition',
  'warehouse.report.exportPdf': 'Export PDF',

  // ---- Profile: immutable username + address editing ----
  'profile.details.username': 'Username:',
  'profile.details.usernameImmutable': 'permanent — cannot be changed',
  'profile.displayNameLabel': 'Display name',

  // ---- Vault: bin, lot and item history ----
  'vault.noBin': 'No bin',
  'vault.lotOf': 'Lot of {count}',
  'vault.historyEmpty': 'Nothing has happened to this item yet.',
  'vault.historyLoading': 'Loading history…',
  'vault.historyCol.date': 'Date',
  'vault.historyCol.event': 'Event',
  'vault.historyCol.details': 'Details',

  // ---- Warehouse: break lot ----
  'warehouse.lots.legend': 'Open lots',
  'warehouse.lots.empty': 'No whole lots to break.',
  'warehouse.lots.colLot': 'Lot',
  'warehouse.lots.colSize': 'Items',
  'warehouse.lots.broken': 'Lot {lot} broken into {count} standalone items',
  'warehouse.lots.breakError': 'Break lot failed: {message}',

  // ---- Warehouse: structured service fulfillment (Requirement 5.4) ----
  'queue.col.request': 'Request ID',
  'queue.fulfill.legend': 'Fulfillment form',
  'queue.fulfill.objectKey': 'Photo object key',
  'queue.fulfill.shotCount': 'Shots taken',
  'queue.fulfill.lighting': 'Lighting setup',
  'queue.fulfill.grade': 'Returned grade',
  'queue.fulfill.gradingBody': 'Grading body',
  'queue.fulfill.certificateNumber': 'Certificate number',
  'queue.fulfill.saleAmount': 'Sale amount (cents)',
  'queue.fulfill.channel': 'Sales channel',
  'queue.fulfill.externalReference': 'External reference',
  'queue.fulfill.itemVerified': 'Item physically verified',
  'queue.fulfill.notes': 'Notes',
  'queue.fulfill.submit': 'Close request',
  'queue.fulfill.required': 'Fill every field and confirm the item was verified.',
  'queue.fulfill.noForm': 'This request type closes automatically.',

  // ---- Barcodes ----
  'barcode.print': 'Print barcode',
  'barcode.printOf': 'Print the barcode {value}',
  'barcode.scanHint': 'Code 128 barcode — scannable',
  'warehouse.intake.lastLabels': 'Labels created by the last intake',
};

const messages: Record<Locale, Record<MessageKey, string>> = { he, en };

/** Substitute {placeholders}; an unmatched placeholder is left verbatim. */
function format(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translate a key for the given locale, falling back to the key itself. */
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE, vars?: MessageVars): string {
  const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return format(template, vars);
}

export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'he' || saved === 'en' ? saved : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  // Persist the choice and keep <html lang/dir> in step, so the whole document
  // (including native form controls and scrollbars) flips direction with it.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  const translate = useCallback<TranslateFn>((key, vars) => t(key, locale, vars), [locale]);
  const toggleLocale = useCallback(() => setLocale((cur) => (cur === 'he' ? 'en' : 'he')), []);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, toggleLocale, t: translate }),
    [locale, toggleLocale, translate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience hook for components that only need to translate. */
export function useT(): TranslateFn {
  return useI18n().t;
}
