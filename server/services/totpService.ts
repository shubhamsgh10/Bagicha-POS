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
    // window:1 accepts ±1 time step (±30s clock drift)
    const result = verifySync({ token, secret, window: 1 } as Parameters<typeof verifySync>[0]);
    return !!result && (result as { valid: boolean }).valid;
  } catch {
    return false;
  }
}
