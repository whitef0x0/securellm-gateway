import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { redactPii, rehydratePii, type TokenMap } from '../detection/piiRedactor';
import { scanInput, type ScanResult } from '../detection/scanner';
import { classify } from '../detection/classifier';
import { createJudge } from '../detection/llmJudge';
import { wrapWithStructuralIsolation } from '../detection/structuralIsolation';
import { chat as llmChat, ProviderError } from '../services/llmProvider';
import { validateOutput } from '../detection/outputValidator';
import { writeAudit, hashContent, type AuditParams } from '../services/auditLogger';
import { pseudonymize } from '../crypto/pseudonym';
import { getConfig } from '../config';
import { logger } from '../logger';
import type { DetectedThreat } from '../models/auditLog';

const bodySchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1),
  system: z.string().optional(),
});

export const chatRouter = Router();

chatRouter.post('/chat', async (req: Request, res: Response): Promise<void> => {
  const startMs = Date.now();
  const { correlationId } = req;
  const auth = req.auth!;
  const { LOG_PSEUDONYM_SECRET, ANTHROPIC_API_KEY } = getConfig();
  const anonymizedKeyId = pseudonymize(auth.apiKeyId.toString(), LOG_PSEUDONYM_SECRET);
  const detectedThreats: DetectedThreat[] = [];

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', correlationId });
    return;
  }
  const { model, messages, system } = parsed.data;

  if (auth.allowedModels?.length && !auth.allowedModels.includes(model)) {
    res.status(403).json({ error: 'model_not_allowed', correlationId });
    return;
  }

  // PII redaction across user messages — shared token map (arch §10.3)
  const tokenMap: TokenMap = {};
  const redactedMessages = messages.map((m) => {
    if (m.role !== 'user') return m;
    const { text, tokenMap: msgMap } = redactPii(m.content);
    Object.assign(tokenMap, msgMap);
    return { ...m, content: text };
  });

  const redactedUserText = redactedMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const requestHash = hashContent(JSON.stringify(redactedMessages));
  const hasPii = Object.keys(tokenMap).length > 0;

  const auditBase = {
    correlationId,
    apiKeyId: auth.apiKeyId,
    anonymizedKeyId,
    llmModel: model,
    requestHash,
    tokenMap: hasPii ? tokenMap : undefined,
  };

  async function auditAndRespond(
    status: 'blocked' | 'error',
    httpStatus: number,
    errorBody: Record<string, unknown>,
    extra: Partial<AuditParams> = {},
  ): Promise<void> {
    try {
      await writeAudit({
        ...auditBase,
        detectedThreats,
        latencyMs: Date.now() - startMs,
        status,
        ...extra,
      });
    } catch (e) {
      logger.error({ correlationId, err: e }, 'audit write failed');
      res.status(500).json({ error: 'audit_failure', correlationId });
      return;
    }
    res.status(httpStatus).json({ ...errorBody, correlationId });
  }

  // L1/L2 scan
  let scanResult: ScanResult = scanInput(redactedUserText);

  if (scanResult.action === 'block') {
    detectedThreats.push({
      rule: scanResult.rule,
      patternName: scanResult.patternName,
      location: 'input',
    });
    await auditAndRespond('blocked', 400, { error: 'injection_detected', detectedThreats });
    return;
  }

  // L3 classifier — runs when L2 didn't hard-block. L3 never blocks on its own
  // authority (it false-positives on structured payloads); a suspicious score
  // escalates to the L4 judge, which makes the final block/pass decision. If the
  // model is unavailable, we keep the existing scanResult (L2's escalation signals).
  const l3 = await classify(redactedUserText);
  if (l3.action === 'escalate') {
    scanResult = { action: 'escalate', signals: ['L3_SUSPICIOUS'] };
  }

  // L4 judge — fail closed if escalation signals present and judge unavailable/uncertain
  if (scanResult.action === 'escalate') {
    if (!ANTHROPIC_API_KEY) {
      await auditAndRespond(
        'error',
        503,
        { error: 'detector_unavailable' },
        {
          errorCode: 'detector_unavailable',
          detectedThreats: [
            { rule: 'JUDGE_UNAVAILABLE', patternName: 'l4_timeout_or_error', location: 'input' },
          ],
        },
      );
      return;
    }

    const judge = createJudge(new Anthropic({ apiKey: ANTHROPIC_API_KEY }));
    const judgeResult = await judge(redactedUserText);

    if (judgeResult.action === 'fail_closed') {
      await auditAndRespond(
        'error',
        503,
        { error: 'detector_unavailable' },
        {
          errorCode: 'detector_unavailable',
          detectedThreats: [
            { rule: 'JUDGE_UNAVAILABLE', patternName: 'l4_timeout_or_error', location: 'input' },
          ],
        },
      );
      return;
    }

    if (judgeResult.action === 'block') {
      detectedThreats.push({
        rule: judgeResult.rule,
        patternName: 'judge_injection',
        location: 'input',
      });
      await auditAndRespond('blocked', 400, { error: 'injection_detected', detectedThreats });
      return;
    }
  }

  // L5 structural isolation — wrap user messages
  const isolatedMessages = redactedMessages.map((m) =>
    m.role === 'user' ? { ...m, content: wrapWithStructuralIsolation(m.content) } : m,
  );

  // Provider call
  let llmOutput: string;
  let responseModel: string;
  try {
    const result = await llmChat({ model, system, messages: isolatedMessages });
    llmOutput = result.content;
    responseModel = result.model;
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    await auditAndRespond(
      'error',
      pe?.status ?? 502,
      { error: pe?.code ?? 'provider_error' },
      { errorCode: pe?.code ?? 'provider_error' },
    );
    return;
  }

  // L6 output validation (pre-rehydration)
  const validation = validateOutput(llmOutput, tokenMap);
  if (validation.action === 'block') {
    detectedThreats.push({
      rule: validation.rule,
      patternName: validation.patternName,
      location: 'output',
    });
    await auditAndRespond(
      'blocked',
      400,
      { error: 'output_blocked', detectedThreats },
      { responseHash: hashContent(llmOutput) },
    );
    return;
  }

  // Render/exfil guard stripped content — response still goes out, but record it
  // so stripped exfil attempts are observable in the audit log (arch §11.6).
  if (validation.sanitized) {
    detectedThreats.push({
      rule: 'RENDER_GUARD',
      patternName: 'stripped_render_content',
      location: 'output',
    });
  }

  const finalOutput = rehydratePii(validation.output, tokenMap);

  try {
    await writeAudit({
      ...auditBase,
      detectedThreats,
      responseHash: hashContent(llmOutput),
      latencyMs: Date.now() - startMs,
      status: 'allowed',
    });
  } catch (e) {
    logger.error({ correlationId, err: e }, 'audit write failed — withholding response');
    res.status(500).json({ error: 'audit_failure', correlationId });
    return;
  }

  res.status(200).json({ content: finalOutput, model: responseModel, correlationId });
});
