import { generateSecret, generateURI, generateSync, verifySync } from "otplib";
import QRCode from "qrcode";

const APP_NAME = "Bagicha POS";

export { generateSecret };

export async function generateQRDataURL(username: string, secret: string): Promise<string> {
  const otpauth = generateURI({ label: `${APP_NAME}:${username}`, issuer: APP_NAME, secret });
  return QRCode.toDataURL(otpauth);
}

export function verifyToken(token: string, secret: string): boolean {
  try {
    // otplib v13's verifySync takes `epochTolerance` (seconds), not `window` (a v11/v12-era
    // option name) — `window: 1` was silently ignored as an unrecognized property (only
    // caught by the `as Parameters<typeof verifySync>[0]` cast masking the resulting TS
    // error), so verification ran with the library's actual default of ZERO tolerance:
    // an exact single 30s step match, no forgiveness for clock drift at all, despite the
    // comment here claiming ±30s. epochTolerance:30 is the real equivalent of "±1 step".
    const result = verifySync({ token, secret, epochTolerance: 30 });
    return !!result && result.valid;
  } catch {
    return false;
  }
}
