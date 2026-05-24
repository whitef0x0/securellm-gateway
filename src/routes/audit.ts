import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/requireAdmin';
import { AuditLog } from '../models/auditLog';
import { PiiVault } from '../models/piiVault';
import { decrypt } from '../crypto/fieldCrypto';
import { pseudonymize } from '../crypto/pseudonym';
import { writeAudit, hashContent } from '../services/auditLogger';
import { getConfig } from '../config';
import type { TokenMap } from '../detection/piiRedactor';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const querySchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// Metadata fields returned by the list endpoint. Explicit allowlist so we never
// accidentally surface a field that could carry sensitive content. AuditLog holds
// no raw PII by design, but PiiVault references are excluded here regardless.
const LIST_PROJECTION =
  'correlationId timestamp anonymizedKeyId llmModel detectedThreats latencyMs status errorCode -_id';

export const auditRouter = Router();

auditRouter.get('/audit', requireAdmin, async (req, res) => {
  const { correlationId } = req;

  // --- Reveal path: decrypt the PII token map for one correlation id ---
  if ('reveal' in req.query) {
    if (!req.auth?.scopes.includes('pii:reveal')) {
      res.status(403).json({ error: 'forbidden', correlationId });
      return;
    }
    const target = String(req.query['reveal']);
    const vault = await PiiVault.findOne({ correlationId: target });
    if (!vault) {
      res.status(404).json({ error: 'not_found', correlationId });
      return;
    }

    const plaintext = decrypt(
      { ciphertext: vault.ciphertext, iv: vault.iv, authTag: vault.authTag },
      getConfig().PII_ENCRYPTION_KEY,
    );
    const tokenMap = JSON.parse(plaintext) as TokenMap;

    // Self-auditing: record that this admin revealed this record (arch §12.4).
    await writeAudit({
      correlationId,
      apiKeyId: req.auth.apiKeyId,
      anonymizedKeyId: pseudonymize(req.auth.apiKeyId.toString(), getConfig().LOG_PSEUDONYM_SECRET),
      requestHash: hashContent(`reveal:${target}`),
      detectedThreats: [{ rule: 'PII_REVEAL', patternName: 'audit_reveal', location: 'audit' }],
      latencyMs: 0,
      status: 'allowed',
    });

    res.json({ correlationId: target, tokenMap });
    return;
  }

  // --- List path: audit metadata since a timestamp, capped at MAX_LIMIT ---
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query', correlationId });
    return;
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const filter = parsed.data.since ? { timestamp: { $gte: new Date(parsed.data.since) } } : {};

  const data = await AuditLog.find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select(LIST_PROJECTION)
    .lean();

  res.json({ data });
});
