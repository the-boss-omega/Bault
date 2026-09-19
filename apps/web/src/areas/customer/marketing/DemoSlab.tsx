import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { useI18n } from '../../../shared/i18n';

/**
 * The card on the signed-out stages — a DEMONSTRATION, and says so.
 *
 * The photograph is the Gold Star Rayquaza, because it is the best-looking card
 * Bault has a real photograph of. Everything printed around it is invented for
 * the page and matches no record: there is no serial, no site, no zone and no
 * owner, because a page anybody on the internet can open must never describe a
 * collector's actual holdings. The grade is a demo too — the case is drawn in
 * CSS, names no grading company and carries no certificate number, so it cannot
 * be mistaken for a real slab's label.
 */

/** Whose photograph is shown. Only the picture: nothing else about that item is used. */
export const DEMO_PHOTO = 'SN-DX107-0003';
/** A serial that no item can ever be issued, shown as the demo record's identity. */
export const DEMO_SERIAL = 'DEMO-0000';
/** The case label — the card's printed name, which is not a record of anyone's. */
const DEMO_CARD_NAME = 'Rayquaza ★';
const DEMO_CARD_SET = 'Gold Star · EX Deoxys';

export function DemoSlab() {
  const { t } = useI18n();
  return (
    <figure className="demo-slab">
      <figcaption className="demo-slab-label">
        <span className="demo-slab-name">
          <span className="demo-slab-card">{DEMO_CARD_NAME}</span>
          <span className="demo-slab-set">{DEMO_CARD_SET}</span>
        </span>
        <span className="demo-slab-grade">
          <span className="demo-slab-grade-num">10</span>
          <span className="demo-slab-grade-word">GEM MT</span>
        </span>
      </figcaption>
      <CardPhotoThumb serialNumber={DEMO_PHOTO} title={t('landing.demoAlt')} />
      <span className="demo-slab-tag">{t('landing.demo')}</span>
    </figure>
  );
}
