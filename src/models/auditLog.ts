import { Schema, model, type Document, type Types } from 'mongoose';
import { getConfig } from '../config/index.js';

export interface DetectedThreat {
  rule: string;
  patternName: string;
  location: string;
}

interface IAuditLog extends Document {
  correlationId: string;
  timestamp: Date;
  apiKeyId: Types.ObjectId;
  anonymizedKeyId: string;
  llmModel?: string;
  requestHash: string;
  responseHash?: string;
  detectedThreats: DetectedThreat[];
  patternSetVersion: string;
  latencyMs: number;
  status: 'allowed' | 'blocked' | 'error';
  errorCode?: string;
  createdAt: Date;
}

const DetectedThreatSchema = new Schema<DetectedThreat>(
  {
    rule: { type: String, required: true },
    patternName: { type: String, required: true },
    location: { type: String, required: true },
  },
  { _id: false },
);

const AuditLogSchema = new Schema<IAuditLog>(
  {
    correlationId: { type: String, required: true, unique: true },
    timestamp: { type: Date, required: true },
    apiKeyId: { type: Schema.Types.ObjectId, required: true },
    anonymizedKeyId: { type: String, required: true },
    llmModel: { type: String },
    requestHash: { type: String, required: true },
    responseHash: { type: String },
    detectedThreats: { type: [DetectedThreatSchema], default: [] },
    patternSetVersion: { type: String, required: true },
    latencyMs: { type: Number, required: true },
    status: { type: String, enum: ['allowed', 'blocked', 'error'], required: true },
    errorCode: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

AuditLogSchema.index({ correlationId: 1 }, { unique: true });
AuditLogSchema.index({ timestamp: 1 });
AuditLogSchema.index({ apiKeyId: 1 });
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: getConfig().AUDIT_LOG_TTL_DAYS * 86400 },
);

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);
