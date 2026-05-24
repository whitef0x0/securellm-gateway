import type { Types } from 'mongoose';

export {};

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth?: {
        apiKeyId: Types.ObjectId;
        role: 'client' | 'admin';
        scopes: string[];
        allowedModels?: string[];
      };
    }
  }
}
