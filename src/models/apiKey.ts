import { Schema, model, type Document } from 'mongoose';

export interface IApiKey extends Document {
  keyIdPrefix: string;
  keyHash: string;
  role: 'client' | 'admin';
  scopes: string[];
  allowedModels?: string[];
  rateLimitOverride?: number;
  active: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    keyIdPrefix: { type: String, required: true, unique: true },
    keyHash: { type: String, required: true },
    role: { type: String, enum: ['client', 'admin'], required: true },
    scopes: { type: [String], default: [] },
    allowedModels: { type: [String] },
    rateLimitOverride: { type: Number },
    active: { type: Boolean, required: true, default: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

export const ApiKey = model<IApiKey>('ApiKey', ApiKeySchema);
