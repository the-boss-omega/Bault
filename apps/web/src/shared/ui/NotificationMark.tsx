import type { ReactNode } from 'react';
import { CardSlab } from '../CardPhoto';
import { useT } from '../i18n';
import { eventLabel, notificationBarcode, notificationGlyph, type NotificationGlyph } from '../notifications';
import type { AppNotification } from '../hooks';
import {
  IconAsk,
  IconBell,
  IconInbox,
  IconMarketplace,
  IconShield,
  IconShipping,
  IconVault,
  IconWallet,
} from './icons';

const GLYPHS: Record<NotificationGlyph, ReactNode> = {
  card: <IconVault />,
  market: <IconMarketplace />,
  escrow: <IconShield />,
  wallet: <IconWallet />,
  shipping: <IconShipping />,
  inbox: <IconInbox />,
  help: <IconAsk />,
  bell: <IconBell />,
};

/**
 * What a notification is about, in front of what it says: the card itself, in its case, when it names one
 * (the item events carry its serial), and otherwise the kind of thing it is. Decoration: the words beside
 * it say what it is.
 */
export function NotificationMark({ n }: { n: AppNotification }) {
  const t = useT();
  const barcode = notificationBarcode(n.content);
  if (barcode) {
    return (
      <span className="register-thumb" aria-hidden="true">
        <CardSlab as="span" serialNumber={barcode} title={eventLabel(t, n.eventType)} noneLabel={t('photo.none')} />
      </span>
    );
  }
  return (
    <span className="register-glyph" aria-hidden="true">
      {GLYPHS[notificationGlyph(n.eventType)]}
    </span>
  );
}
