/**
 * The photographs in `assets/images` are of cards, and each is named by the serial of the copy that was
 * photographed (`SN-DR97-0001.png`). A further copy of the same card has a serial of its own, which is the first
 * copy's with a copy number after it (`SN-DR97-0001-C2`), and is shown with the card's photograph: the card is
 * the same, the copy is not. A serial that is not a copy is its own photograph's name.
 */
export function catalogueSerial(serial: string): string {
  return serial.replace(/-C\d+$/, '');
}
