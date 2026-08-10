import type { Device, Interface } from "usb";

function findPrinterOutEndpoint(device: Device): { iface: Interface; outEndpoint: Interface["endpoints"][number] } | null {
  if (!device.interfaces?.length) return null;

  let fallback: { iface: Interface; outEndpoint: Interface["endpoints"][number] } | null = null;

  for (const iface of device.interfaces) {
    const desc = (iface as Interface & { descriptor?: { bInterfaceClass?: number } }).descriptor;
    const isPrinter = desc?.bInterfaceClass === 7;
    const outEp = iface.endpoints.find((e) => e.direction === "out");
    if (!outEp) continue;
    const match = { iface, outEndpoint: outEp };
    if (isPrinter) return match;
    if (!fallback) fallback = match;
  }

  return fallback;
}

/** Direct libusb transfer (Linux/macOS, or Windows with WinUSB/Zadig). */
export async function sendViaLibusb(vendorId: number, productId: number, data: Buffer): Promise<void> {
  const usbModule = await import("usb");
  const device = usbModule.findByIds(vendorId, productId);
  if (!device) {
    throw new Error(
      `USB device not found (VID:0x${vendorId.toString(16).padStart(4, "0")} PID:0x${productId.toString(16).padStart(4, "0")})`,
    );
  }

  device.open();
  const match = findPrinterOutEndpoint(device);
  if (!match) {
    try {
      device.close();
    } catch {
      /* ignore */
    }
    throw new Error("No USB OUT endpoint found on printer");
  }

  const { iface, outEndpoint } = match;

  try {
    if (process.platform === "linux") {
      const ifaceExt = iface as Interface & {
        isKernelDriverActive?: () => boolean;
        detachKernelDriver?: () => void;
      };
      if (ifaceExt.isKernelDriverActive?.()) {
        ifaceExt.detachKernelDriver?.();
      }
    }
    iface.claim();
    const out = outEndpoint as unknown as {
      transfer: (d: Buffer, cb: (err: Error | null) => void) => void;
    };
    await new Promise<void>((resolve, reject) => {
      out.transfer(data, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    // iface.release() is callback-async (releasing takes real time, more so with
    // closeEndpoints:true) — this used to fire-and-forget it, so sendViaLibusb's
    // promise resolved before the interface was actually released and the device
    // actually closed. A rapid next print to the SAME USB device (double-tap, or the
    // next job draining off the print queue) could then race device.open()/iface.claim()
    // against a still-in-progress release, failing or hanging on a device the OS/driver
    // hadn't actually freed yet. Now awaited so this function doesn't return until
    // release + close have truly finished.
    await new Promise<void>((resolve) => {
      try {
        iface.release(true, () => {
          try {
            device.close();
          } catch {
            /* ignore */
          }
          resolve();
        });
      } catch {
        try {
          device.close();
        } catch {
          /* ignore */
        }
        resolve();
      }
    });
  }
}
