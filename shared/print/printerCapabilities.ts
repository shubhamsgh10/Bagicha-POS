/** Printer label fields used to decide if raw ESC/POS is appropriate. */
export type PrinterLabelFields = {
  name?: string;
  windowsQueueName?: string;
  type?: "network" | "usb";
};

/**
 * Office lasers/MFPs accept RAW spooler jobs but do not render ESC/POS receipts.
 * Sending thermal bytes produces empty jobs or garbage.
 */
export function supportsRawEscPos(printer: PrinterLabelFields): boolean {
  const label = `${printer.name ?? ""} ${printer.windowsQueueName ?? ""}`.toLowerCase();

  if (/laserjet|laser jet|officejet|deskjet|mfp|multifunction|inkjet|brother hl|canon lbp|xerox|pagewide/.test(label)) {
    return false;
  }
  if (/microsoft|pdf|onenote|fax|xps|send to/.test(label)) {
    return false;
  }
  if (/epson tm|star tsp|bixolon|citizen|pos-|thermal|receipt|xprinter|xp-80|rp3|tm-t|tm-m/.test(label)) {
    return true;
  }

  return true;
}

export function nonEscPosPrinterMessage(printer: PrinterLabelFields): string {
  const name = printer.windowsQueueName ?? printer.name ?? "This printer";
  return (
    `${name} is not a thermal receipt printer. ESC/POS kitchen tickets need a thermal printer ` +
    `(Epson TM, Star, etc.) or use the on-screen KOT preview and browser print.`
  );
}
