import type { SVGProps } from 'react';

/**
 * One icon system for the whole product: 24-box outline glyphs, 1.6 stroke,
 * rounded caps and joins. Nothing filled, no emoji, no illustrations — size is
 * controlled by CSS (`width`/`height` on the parent rule), never per call site.
 *
 * Every icon is decorative by default (`aria-hidden`); the surrounding control
 * carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------- Navigation ---------- */

/** Vault: a safe door with a spoked handle. */
export function IconVault(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.75" y="3.75" width="18.5" height="16.5" rx="2.5" />
      <circle cx="11" cy="12" r="4.25" />
      <path d="M11 7.75v1.5M11 14.75v1.5M6.75 12h1.5M13.75 12h1.5" />
      <path d="M18.25 9.5v5" />
    </Svg>
  );
}

/** Wallet with a card slot and clasp. */
export function IconWallet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <path d="M3 9.5V6.9a1.9 1.9 0 0 1 1.55-1.87l10-1.9" />
      <path d="M21 11.5h-3.5a1.75 1.75 0 0 0 0 3.5H21" />
    </Svg>
  );
}

/** Marketplace: a storefront with an awning. */
export function IconMarketplace(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 9.5V19a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5" />
      <path d="M2.75 9.5 4.4 4.6A1.5 1.5 0 0 1 5.82 3.5h12.36a1.5 1.5 0 0 1 1.42 1.1l1.65 4.9" />
      <path d="M2.75 9.5a2.6 2.6 0 0 0 4.8 0 2.6 2.6 0 0 0 4.8 0 2.6 2.6 0 0 0 4.8 0 2.6 2.6 0 0 0 4.6 0" />
      <path d="M9.5 20.5v-5.25h5v5.25" />
    </Svg>
  );
}

/** Bault store: a shopping bag — the shop's own stock, not a neighbour's stall. */
export function IconStore(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.6 7.5h14.8l-1.1 11.4a1.6 1.6 0 0 1-1.6 1.45H7.3a1.6 1.6 0 0 1-1.6-1.45z" />
      <path d="M8.75 10.25V6.9a3.25 3.25 0 0 1 6.5 0v3.35" />
    </Svg>
  );
}

/** Escrow: a closed padlock — money and card held while both sides commit. */
export function IconEscrow(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.25" y="10" width="15.5" height="10.25" rx="2.5" />
      <path d="M8 10V7.4a4 4 0 0 1 8 0V10" />
      <path d="M12 13.75v2.75" />
    </Svg>
  );
}

/** Services: a service package / cube. */
export function IconServices(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.9 20.5 7.5v9L12 21.1 3.5 16.5v-9z" />
      <path d="M3.7 7.6 12 12.1l8.3-4.5M12 12.1V21" />
    </Svg>
  );
}

/** Shipping: a delivery truck. */
export function IconShipping(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.75 6.5A1.5 1.5 0 0 1 4.25 5h8.5a1.5 1.5 0 0 1 1.5 1.5v9.75H2.75z" />
      <path d="M14.25 9.25h3.13a1.5 1.5 0 0 1 1.28.72l2.12 3.46v2.82h-6.53" />
      <circle cx="7" cy="17.75" r="1.9" />
      <circle cx="17.25" cy="17.75" r="1.9" />
      <path d="M8.9 17.75h6.45" />
    </Svg>
  );
}

/**
 * Shipping & Services: the same truck cab, with a wrench riding where the
 * trailer would be. One glyph has to stand for both halves of the merged
 * section, so the truck keeps the silhouette recognisable and the tool says
 * that more than postage happens here.
 */
export function IconShippingServices(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.75 7.25A1.5 1.5 0 0 1 4.25 5.75h6.5a1.5 1.5 0 0 1 1.5 1.5v8.5H2.75z" />
      <path d="M12.25 10h2.4a1.5 1.5 0 0 1 1.28.72l.72 1.18" />
      <circle cx="6.25" cy="17.5" r="1.75" />
      <path d="M8 17.5h3.25" />
      <path d="M21.2 10.4a2.9 2.9 0 0 1-3.83 3.62l-3.3 3.3a1.3 1.3 0 0 1-1.84-1.84l3.3-3.3a2.9 2.9 0 0 1 3.62-3.83l-1.83 1.83.44 1.81 1.81.44z" />
    </Svg>
  );
}

/**
 * FAQ & Legal: a document whose lower half carries a balance beam. The question
 * mark sits in the page's upper corner so the glyph reads as "the answers and
 * the terms" rather than as either one alone.
 */
export function IconLegal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 3.75h8.25l4.75 4.75v11.75a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20.25V5.25a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M13.5 3.9V8.5h4.6" />
      <path d="M12 12.25v6" />
      <path d="M8.5 13.75h7" />
      <path d="M8.5 13.75 7 16.75h3z" />
      <path d="M15.5 13.75 14 16.75h3z" />
    </Svg>
  );
}

/** Archive: a lidded box — the marker for cards that have left the vault. */
export function IconArchive(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4.25" width="18" height="4" rx="1.25" />
      <path d="M4.75 8.25v10a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-10" />
      <path d="M9.75 12h4.5" />
    </Svg>
  );
}

/** Ask: a speech bubble carrying a question mark. */
export function IconAsk(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.25 12.5c0 3.9-3.7 7-8.25 7a9.4 9.4 0 0 1-2.6-.36L4.5 20.5l1.13-3.6A6.66 6.66 0 0 1 3.75 12.5c0-3.87 3.7-7 8.25-7s8.25 3.13 8.25 7z" />
      <path d="M9.9 10.35a2.15 2.15 0 0 1 4.18.7c0 1.43-2.08 1.7-2.08 3" />
      <path d="M12 15.6h.01" />
    </Svg>
  );
}

/** Print: the classic printer body with a page feeding through it. */
export function IconPrint(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 8.5V4.25a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .5.5V8.5" />
      <path d="M6 8.5h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2v-3H7v3H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2z" />
      <rect x="7" y="13.5" width="10" height="6.75" rx="0.75" />
    </Svg>
  );
}

/** Warehouse: a wide building with bay doors. */
export function IconWarehouse(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.75 20.25V9.4a1.5 1.5 0 0 1 .93-1.39l7.75-3.15a1.5 1.5 0 0 1 1.14 0l7.75 3.15a1.5 1.5 0 0 1 .93 1.39v10.85" />
      <path d="M1.75 20.25h20.5" />
      <path d="M6.75 20.25v-6.5h10.5v6.5" />
      <path d="M6.75 17h10.5" />
      <path d="M12 13.75v6.5" />
    </Svg>
  );
}

/** Notifications bell. */
export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 10.25a6 6 0 0 1 12 0c0 3.1.66 4.9 1.34 5.94a.8.8 0 0 1-.67 1.24H5.33a.8.8 0 0 1-.67-1.24C5.34 15.15 6 13.35 6 10.25Z" />
      <path d="M10 20.4a2.3 2.3 0 0 0 4 0" />
    </Svg>
  );
}

/** Management: control sliders. */
export function IconManagement(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h5.5M14.5 7H20M4 17h3.5M12.5 17H20M4 12h9.5M18.5 12H20" />
      <circle cx="12" cy="7" r="2.25" />
      <circle cx="10" cy="17" r="2.25" />
      <circle cx="16" cy="12" r="2.25" />
    </Svg>
  );
}

/* ---------- Header & menus ---------- */

export function IconUser(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
    </Svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.4a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-2.55 1.06v.14a1.8 1.8 0 1 1-3.6 0v-.07a1.5 1.5 0 0 0-2.6-1.03l-.05.05A1.8 1.8 0 1 1 5.8 16.3l.05-.05a1.5 1.5 0 0 0-1.06-2.55h-.14a1.8 1.8 0 1 1 0-3.6h.07A1.5 1.5 0 0 0 5.75 7.5L5.7 7.45A1.8 1.8 0 1 1 8.25 4.9l.05.05a1.5 1.5 0 0 0 1.65.3h.07A1.5 1.5 0 0 0 10.94 3.9v-.14a1.8 1.8 0 0 1 3.6 0v.07a1.5 1.5 0 0 0 2.55 1.06l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.36.88h.14a1.8 1.8 0 0 1 0 3.6h-.07a1.5 1.5 0 0 0-1.38.76Z" />
    </Svg>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.4 9.5h17.2M3.4 14.5h17.2" />
      <path d="M12 3.3c2.2 2.4 3.35 5.45 3.35 8.7S14.2 18.3 12 20.7c-2.2-2.4-3.35-5.45-3.35-8.7S9.8 5.7 12 3.3Z" />
    </Svg>
  );
}

export function IconSignOut(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.75 8V6.5a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6.25a2 2 0 0 0 2-2V16" />
      <path d="M10 12h9.5M17 9.25 19.75 12 17 14.75" />
    </Svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2 19.25 6v5.4c0 4.2-2.9 7.6-7.25 9.4-4.35-1.8-7.25-5.2-7.25-9.4V6z" />
      <path d="m9.25 12 1.9 1.9 3.6-3.6" />
    </Svg>
  );
}

/* ---------- Actions ---------- */

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5.25v13.5M5.25 12h13.5" />
    </Svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.75" cy="10.75" r="6.5" />
      <path d="m15.5 15.5 4.25 4.25" />
    </Svg>
  );
}

export function IconFilter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.75 6.25h16.5M6.75 12h10.5M10 17.75h4" />
    </Svg>
  );
}

export function IconCalendar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.75" y="5.25" width="16.5" height="15" rx="2.25" />
      <path d="M3.75 9.75h16.5M8.25 3.5v3.5M15.75 3.5v3.5" />
    </Svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.75v10.5M8.25 10.75 12 14.5l3.75-3.75" />
      <path d="M4.75 16.5v1.75a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V16.5" />
    </Svg>
  );
}

export function IconUpload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20.25V9.75M8.25 13.5 12 9.75l3.75 3.75" />
      <path d="M4.75 7.5V5.75a2 2 0 0 1 2-2h10.5a2 2 0 0 1 2 2V7.5" />
    </Svg>
  );
}

/* `IconPin` was removed with the rail's pin control — nothing renders it, and
   keeping an unused pin glyph around invites the affordance back. */

export function IconMenu(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.75 7h16.5M3.75 12h16.5M3.75 17h16.5" />
    </Svg>
  );
}

export function IconDots(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5.75" r="1.35" />
      <circle cx="12" cy="12" r="1.35" />
      <circle cx="12" cy="18.25" r="1.35" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11.5a8 8 0 1 0-.9 4.4" />
      <path d="M20.25 4.75v5h-5" />
    </Svg>
  );
}

/* ---------- Status & data ---------- */

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.75v5M12 15.75v.5" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.75 4.75L19 7.75" />
    </Svg>
  );
}

export function IconCheckCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="m8.25 12.25 2.6 2.6 4.9-5.2" />
    </Svg>
  );
}

export function IconInbox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.75 13.5h4l1.25 2.5h6l1.25-2.5h4" />
      <path d="M5.6 4.75h12.8a1.5 1.5 0 0 1 1.4 1l2 5.6v6.4a2 2 0 0 1-2 2H4.2a2 2 0 0 1-2-2v-6.4l2-5.6a1.5 1.5 0 0 1 1.4-1Z" />
    </Svg>
  );
}

export function IconBox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.9 20.5 7.5v9L12 21.1 3.5 16.5v-9z" />
      <path d="M3.7 7.6 12 12.1l8.3-4.5" />
      <path d="M12 12.1V21M7.75 5.2l8.4 4.55" />
    </Svg>
  );
}

export function IconLocation(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21c3.9-4.1 5.85-7.2 5.85-9.3A5.85 5.85 0 0 0 6.15 11.7C6.15 13.8 8.1 16.9 12 21Z" />
      <circle cx="12" cy="11.4" r="2.25" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7v5.25l3.25 1.9" />
    </Svg>
  );
}

export function IconArrowUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 19.5V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function IconArrowDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4.5V19M6 13l6 6 6-6" />
    </Svg>
  );
}

export function IconTag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11.4 3.75H19a1.25 1.25 0 0 1 1.25 1.25v7.6a1.5 1.5 0 0 1-.44 1.06l-6.65 6.65a1.5 1.5 0 0 1-2.12 0l-6.16-6.16a1.5 1.5 0 0 1 0-2.12l6.46-6.46a1.5 1.5 0 0 1 1.06-.44Z" />
      <circle cx="16" cy="8" r="1.4" />
    </Svg>
  );
}

export function IconReceipt(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.75 3.75h12.5v16.5l-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5z" />
      <path d="M9 8.25h6M9 12h6" />
    </Svg>
  );
}

export function IconScan(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.75 8.25V6a2.25 2.25 0 0 1 2.25-2.25h2.25M15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25M20.25 15.75V18A2.25 2.25 0 0 1 18 20.25h-2.25M8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25" />
      <path d="M3.75 12h16.5" />
    </Svg>
  );
}

export function IconChart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20.25h16.25" />
      <path d="M6.75 20.25V13M11.5 20.25V7.5M16.25 20.25v-9" />
    </Svg>
  );
}

export function IconLayers(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m12 3.25 8.5 4.4-8.5 4.4-8.5-4.4z" />
      <path d="m3.5 12 8.5 4.4 8.5-4.4M3.5 16.4l8.5 4.35 8.5-4.35" />
    </Svg>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9.25" cy="8" r="3.5" />
      <path d="M2.75 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.9a3.5 3.5 0 0 1 0 6.2M17.5 14.1a6.5 6.5 0 0 1 3.75 5.4" />
    </Svg>
  );
}

/** The register: rows, each with a stamp at its start edge. */
export function IconRows(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4.75" width="4" height="4" rx="1" />
      <rect x="3" y="15.25" width="4" height="4" rx="1" />
      <path d="M10 6.75h11M10 17.25h11M10 12h11M3 12h4" />
    </Svg>
  );
}

/** The display case: the collection as a wall of cards. */
export function IconCase(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.25" y="3.25" width="7" height="8.5" rx="1.4" />
      <rect x="13.75" y="3.25" width="7" height="8.5" rx="1.4" />
      <rect x="3.25" y="14.25" width="7" height="6.5" rx="1.4" />
      <rect x="13.75" y="14.25" width="7" height="6.5" rx="1.4" />
    </Svg>
  );
}

export function IconGavel(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m13.6 4.4 6 6M15.7 2.3l2.1 2.1M19.9 6.5l2.1 2.1" />
      <path d="m16.5 7.5-9 9M4.75 21.25h7" />
      <path d="m9.9 10.9 3.2 3.2" />
    </Svg>
  );
}

/* ---------- Decorative brand art ---------- */

/**
 * Stylised vault door for the wallet hero — pure geometry, no photography.
 * It is drawn in `currentColor` at low opacity so it sinks into the navy card
 * and never competes with the balance figure.
 */
export function VaultDoorArt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 320 320" fill="none" aria-hidden="true" focusable="false" {...props}>
      <defs>
        <linearGradient id="bault-vault-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.42" />
        </linearGradient>
      </defs>
      <g stroke="currentColor" fill="none" strokeLinecap="round">
        <circle cx="160" cy="160" r="146" strokeWidth="1" opacity="0.35" />
        <circle cx="160" cy="160" r="126" strokeWidth="10" stroke="url(#bault-vault-sheen)" />
        <circle cx="160" cy="160" r="104" strokeWidth="1.5" opacity="0.5" />
        <circle cx="160" cy="160" r="60" strokeWidth="2" opacity="0.65" />
        <circle cx="160" cy="160" r="26" strokeWidth="8" opacity="0.5" />
        <circle cx="160" cy="160" r="9" strokeWidth="2" opacity="0.8" />
        {/* Handle spokes */}
        <g strokeWidth="7" opacity="0.6">
          <path d="M160 60v42M160 218v42M60 160h42M218 160h42" />
          <path d="M89 89l30 30M201 201l30 30M231 89l-30 30M119 201l-30 30" />
        </g>
        {/* Bolt heads around the rim */}
        <g opacity="0.7">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return (
              <circle
                key={i}
                cx={160 + Math.cos(a) * 116}
                cy={160 + Math.sin(a) * 116}
                r="4"
                fill="currentColor"
                stroke="none"
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}

/* ============================================================
   Theme
   ============================================================
   Three icons for three states. `system` gets a display rather than a
   half-moon, because "follow the machine" is a different idea from "dark" and
   drawing it as a variation of one of the other two makes the cycle unreadable.
   ============================================================ */

export function IconSun(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}>
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}>
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMonitor(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" strokeLinecap="round" />
    </svg>
  );
}
