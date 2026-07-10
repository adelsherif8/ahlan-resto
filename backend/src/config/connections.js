import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import {
  SUPABASE_AHLAN_URL,
  SUPABASE_AHLAN_SERVICE_KEY,
  ENCRYPTION_KEY,
} from "./env.js";

export const supabaseAhlan =
  SUPABASE_AHLAN_URL && SUPABASE_AHLAN_SERVICE_KEY
    ? createClient(SUPABASE_AHLAN_URL, SUPABASE_AHLAN_SERVICE_KEY)
    : null;

// Same wire format as ai2-web: hex(iv[12] + authTag[16] + ciphertext), AES-256-GCM
export function decryptField(value) {
  if (!value || !ENCRYPTION_KEY) return value;
  try {
    const buf = Buffer.from(value, "hex");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return value; // stored unencrypted (dev)
  }
}

const tenantClients = new Map();
export function tenantClient(url, key) {
  const cacheKey = url;
  if (!tenantClients.has(cacheKey)) tenantClients.set(cacheKey, createClient(url, key));
  return tenantClients.get(cacheKey);
}
