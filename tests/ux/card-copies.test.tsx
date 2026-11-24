import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { CardPhotoThumb, cardPhotoUrl } = await import('../../apps/web/src/shared/CardPhoto');
const { catalogueSerial } = await import('../../apps/web/src/shared/catalogue');

/**
 * The ten photographs are the catalogue, each named by the serial of the copy that was photographed. A further
 * copy of the same card is that serial and a copy number, and is shown with the card's photograph; what is
 * printed on its label is its own serial.
 */
describe('a further copy of a catalogued card', () => {
  it('is named by the card it is a copy of, and any other serial by itself', () => {
    expect(catalogueSerial('SN-DR97-0001-C2')).toBe('SN-DR97-0001');
    expect(catalogueSerial('SN-ROS105-0008-C12')).toBe('SN-ROS105-0008');
    expect(catalogueSerial('SN-DR97-0001')).toBe('SN-DR97-0001');
    // The serials the product makes are a time and four digits: neither is a copy number.
    expect(catalogueSerial('SN-MH3Q9ZK2-5821')).toBe('SN-MH3Q9ZK2-5821');
    expect(catalogueSerial('LOT-MH3Q9ZK2-5821')).toBe('LOT-MH3Q9ZK2-5821');
    expect(catalogueSerial('')).toBe('');
  });

  it('is looked for under the card’s photograph, in the thumbnail’s sizes and the full one', () => {
    expect(cardPhotoUrl('SN-DR97-0001-C2')).toBe('/images/w640/SN-DR97-0001.webp');
    expect(cardPhotoUrl('SN-DR97-0001-C2', 1)).toBe('/images/SN-DR97-0001.png');
    expect(cardPhotoUrl('SN-DR97-0001-C2', 0, true)).toBe('/images/SN-DR97-0001.png');
    expect(cardPhotoUrl('SN-DR97-0001')).toBe('/images/w640/SN-DR97-0001.webp');
  });

  it('shows the card’s photograph on its own label, which says its own serial', () => {
    const { container } = render(
      <I18nProvider>
        <CardPhotoThumb
          serialNumber="SN-DR97-0001-C2"
          title="2003 Pokémon EX Dragon — Rayquaza ex"
        />
      </I18nProvider>,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/images/w640/SN-DR97-0001.webp');
    expect(container.querySelector('.slab-band')).toHaveAttribute('data-serial', 'SN-DR97-0001-C2');
  });
});
