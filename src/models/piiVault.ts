import { Schema, model, type Document } from 'mongoose';
import { getConfig } from '../config/index.js';

export interface IPiiVault extends Document {
  correlationId: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  createdAt: Date;
}

const PiiVaultSchema = new Schema<IPiiVault>(
  {
    correlationId: { type: String, required: true, unique: true },
    ciphertext: { type: Buffer, required: true },
    iv: { type: Buffer, required: true },
    authTag: { type: Buffer, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

PiiVaultSchema.index({ correlationId: 1 }, { unique: true });
PiiVaultSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: getConfig().PII_VAULT_TTL_DAYS * 86400 },
);

export const PiiVault = model<IPiiVault>('PiiVault', PiiVaultSchema);
