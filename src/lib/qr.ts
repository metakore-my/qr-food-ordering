import crypto from "crypto";
import QRCode from "qrcode";

let _secret: string | undefined;

function getSecret(): string {
  if (!_secret) {
    const env = process.env.QR_SECRET;
    if (!env) throw new Error("QR_SECRET environment variable is required");
    _secret = env;
  }
  return _secret;
}

export function signTableToken(tableId: number, tableToken: string): string {
  const payload = `${tableId}:${tableToken}`;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifyTableToken(signed: string): {
  tableId: number;
  tableToken: string;
} {
  const decoded = Buffer.from(signed, "base64url").toString();
  const parts = decoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [tableIdStr, tableToken, signature] = parts;
  const payload = `${tableIdStr}:${tableToken}`;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "utf-8");
  const expBuf = Buffer.from(expected, "utf-8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid token signature");
  }

  return { tableId: parseInt(tableIdStr, 10), tableToken };
}

export async function generateTableQrCode(
  baseUrl: string,
  tableId: number,
  tableToken: string
): Promise<string> {
  const signed = signTableToken(tableId, tableToken);
  const url = `${baseUrl}/table/${signed}`;
  return QRCode.toDataURL(url, { width: 300, margin: 2 });
}
