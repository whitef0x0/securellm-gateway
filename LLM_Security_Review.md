I treated the first upload as the audit brief and the second as arch.md. The brief requires a problem-finding security review, corpus matrix, acceptance-gap analysis, and detection-pipeline scrutiny. The architecture under review is the SecureLLM Gateway design.

1. Findings table
ID	Severity	§location	Issue
F-01	High	§6.3 L4, §14.23, §14.27	L4 fail-open and optional disablement can turn known detector blind spots into allowed traffic.
F-02	High	§6.3 L3, §12	Classifier token-window and long/multi-message segmentation are unspecified.
F-03	High	§6.3 L1	Detection-copy vs forwarded-copy normalization differential is exploitable.
F-04	High	§6.3 corpus mapping	E-class indirect injections are not guaranteed to block at input; design relies on L5/L6 containment.
F-05	High	§3, §6.4, §7.3, §14.40	Audit/PiiVault write after response-path work plus fail-closed creates privacy and DoS edge cases.
F-06	Medium	§6.3 L2, §6.5	Regex safety is asserted by design shape, not constrained; ReDoS review is absent.
F-07	Medium	§6.5, §14.41	Output validation is finite-pattern only; semantic system-prompt/context leakage is v2.
F-08	Medium	§5, §3	express.json() body parsing before auth permits unauthenticated memory/CPU pressure.
F-09	Medium	§6.4, §6.7	Egress PII DLP is incomplete: only original inbound tokens are rehydrated; new model-generated PII can pass.
F-10	Medium	§6.1	Auth-failure IP limiter is vulnerable to proxy/IP spoofing unless trusted proxy handling is specified.
F-11	Low	§9	Unauthenticated /healthz may disclose provider/dependency readiness details.
F-12	Low	§11	Docker Compose has more moving parts than required; 1 Sentinel and nginx/Seq increase start-failure risk.
2. Findings details
F-01 — L4 fail-open and disablement can bypass known blind spots

Scenario.

Attacker submits a non-English or paraphrased injection that L2 does not match.
L3 gives a low score because the design admits the model is English-only and jailbreak-weak.
L4 would be the intended backstop, but it is conditional, has an 800 ms timeout, fails open, and can be disabled for latency-critical deployments.
The request proceeds to L5, which is impact reduction, not a block.

Why it matters. The brief requires each injection item to return 400 plus audit of the fired rule, including non-English translate-and-execute cases. The design says L4 is conditional and fails open, and also offers a config toggle to disable it while claiming L2+L3+L5+L6 still cover the named corpus. That is not a hard guarantee.

Remediation. For v1 acceptance mode, make L4 fail-closed for escalation-triggering content, remove the disable toggle from the evaluated configuration, and add a deterministic non-English/encoding rule that blocks required E3-like cases before the judge. Treat “judge unavailable” as 503 or 400 blocked_due_to_unavailable_detector, not allow.

F-02 — Classifier token-window and segmentation are unspecified

Scenario.

Attacker pads a message with benign text until the malicious span falls outside the classifier’s effective window.
L2 misses because the phrase is paraphrased.
L4 does not fire unless “unusually long message” is triggered, but no threshold or chunking algorithm is defined.
The malicious span reaches the provider.

Why it matters. The brief explicitly asks how long or multi-message inputs are segmented and flags token-window truncation as a required deep-dive issue. The architecture only says L3 is DeBERTa-based and detection runs per message, not whether it scans sliding windows, all chunks, first+last windows, or a normalized concatenation.

Remediation. Define deterministic segmentation: normalized full conversation plus each message, sliding windows with overlap, scan beginning and end, and block/escalate if any chunk trips. Add tests where the malicious instruction appears after padding, across message boundaries, and in the assistant-role history.

F-03 — Detection-copy vs forwarded-copy normalization differential is exploitable

Scenario.

Attacker uses confusable glyphs or mixed-script text that folds to a dangerous phrase in the detection copy.
The detector either misses because the confusables table is incomplete or classifies the folded text differently from the provider’s interpretation.
The forwarded copy preserves confusables, so the model may interpret the text in a way not equivalent to what was inspected.

Why it matters. The design intentionally inspects a detection copy with confusables folding but forwards a different copy without confusables folding. The brief specifically calls this parser/normalization differential out as a bypass class to test.

Remediation. Either forward the exact inspected normalized copy to the LLM, or record a hard invariant: any text that changes under confusables folding must be blocked or escalated. At minimum, add an audit field normalizationChanged: true and tests for mixed Latin/Cyrillic/Hebrew confusables.

F-04 — E-class indirect injections are not guaranteed to block at input

Scenario.

Attacker places an indirect instruction in a forged delimiter, HTML comment, or non-English “translate and execute” wrapper.
L2 may catch some delimiter markers, but the design’s own mapping says E is handled by L1/L2 and then L5 isolation as primary plus L6 echo as backstop.
If no L2 rule fires, the request is not rejected 400.

Why it matters. The brief requires E1–E3 to block at input regardless of source language. L5 structural isolation reduces impact after forwarding; it does not satisfy “block at input.” The architecture’s Appendix A mapping for E makes L5 “primary,” which is a red flag.

Remediation. Change the E mapping so required corpus cases are blocked by L1/L2/L3/L4 before provider call. Make “L5-only containment” explicitly insufficient for acceptance tests.

F-05 — Audit/PiiVault ordering and fail-closed behavior create edge cases

Scenario.

The pipeline shows response rehydration before audit logging.
Audit write failure is later defined as fail-closed 500.
If implementation sends or begins sending a response before audit/PiiVault persistence completes, the request can complete unaudited.
If audit/PiiVault is down, every request becomes 500, creating a denial lever.

Why it matters. The brief requires a Mongo audit record per request. The design says audit logger is step 8 after PII rehydration, and later says audit-write failure is fail-closed. That is acceptable only if the implementation strictly persists audit before emitting the HTTP response.

Remediation. Make response emission explicitly depend on successful audit write. Use an outbox or local durable queue only if the acceptance brief permits it; otherwise, write audit/PiiVault before sending response. Add integration tests that force Mongo/PiiVault failure pre-provider, post-provider, and post-validation.

F-06 — Regex ReDoS review is absent

Scenario.

Attacker sends a 4 MB body crafted to stress nested optional groups in whitespace-tolerant regexes.
L2 and L6 scan it with case-insensitive “semantic family” patterns.
Event loop stalls, causing a gateway-wide denial of service.

Why it matters. The brief explicitly asks for catastrophic backtracking analysis and pathological input where applicable. The design gives example regex style and secret patterns, but does not specify RE2, safe-regex checks, max scan length per field, or regex performance tests.

Remediation. Use RE2-compatible regexes or node-re2; ban nested quantifiers in review; enforce per-message scan size and timeout; add fuzz/performance tests with repeated delimiters, whitespace, quotes, and base64-like blobs.

F-07 — Output validation cannot catch semantic leaks

Scenario.

Model paraphrases confidential system instructions without using exact compromise markers.
Output contains no sk-, JWT, AWS key, markdown image, or known marker.
L6 returns it.

Why it matters. The brief requires output validation to refuse responses that leak secret patterns or echo a detected injection, and it asks for output validation to catch leakage. The design explicitly defers holistic semantic-leak output judging to v2 and ships bounded passes only. That may satisfy literal secret-pattern tests, but not robust system-prompt/context leakage.

Remediation. Add v1 semantic output checks for system-prompt/context disclosure categories, at least deterministic patterns for “initial instructions,” “system prompt,” “developer message,” “environment variables,” and structured config dumps. For higher assurance, add a separate output judge with fail-closed behavior for suspected prompt/context leakage.

F-08 — Body parsing occurs before auth

Scenario.

Unauthenticated client sends repeated near-limit JSON bodies.
Express parses up to 4 MB before auth or auth-failure rate limiting.
CPU and memory are consumed without a valid key.

Why it matters. The design says correlation ID and body parsing occur before auth, with default BODY_SIZE_LIMIT 4 MB. In a regulated gateway, unauthenticated resource exhaustion can degrade all LLM access.

Remediation. Require x-api-key syntactic presence and cheap prefix validation before JSON body parsing. Add nginx/client body limits below Express, request rate limits at nginx, and a smaller default body size unless business cases require 4 MB.

F-09 — Egress PII DLP is incomplete

Scenario.

User sends no PII.
Model outputs a fresh email, phone, or Israeli national ID not present in the inbound token map.
Output validation runs on tokenized response and only checks secrets/echo/render issues.
New PII is returned.

Why it matters. The architecture claims egress PII rehydration and DLP are “In,” but the concrete design only rehydrates prior tokens and does not describe scanning model output for new PII categories. For a regulated environment, model-generated or retrieved PII is still sensitive.

Remediation. Run the PII detector on outbound text before response, after output validation and before rehydration. Decide policy: block, redact, or allow only if it matches the request’s own token map. Audit outbound PII categories.

F-10 — Auth-failure IP limiter depends on unspecified proxy trust

Scenario.

Gateway is behind nginx or another proxy.
App trusts X-Forwarded-For incorrectly, or does not trust it when it should.
Attacker spoofs source IPs to bypass auth-failure throttling, or all users collapse onto the proxy IP and throttle each other.

Why it matters. The architecture includes nginx and an ephemeral IP-based auth-failure limiter. The brief asks to consider proxy IP spoofing for auth-failure limiters.

Remediation. Specify Express trust proxy exactly, accept forwarded IP only from nginx’s private network, and prefer a combined key of trusted client IP + API key prefix when a prefix is present. Add tests for forged X-Forwarded-For.

F-11 — /healthz may leak dependency/provider state

Scenario.

Unauthenticated caller polls /healthz.
Response reveals provider degraded, Mongo/Redis down, or deployment readiness.
Attacker times credential stuffing or DoS attempts around dependency health.

Why it matters. /healthz is unauthenticated and returns per-component Mongo/Redis/provider readiness. The brief requires /healthz, but not detailed public internals.

Remediation. Return minimal public status and expose detailed dependency status only on an authenticated internal endpoint or network-restricted path.

F-12 — Compose complexity increases red-line risk

Scenario.

Evaluator runs docker-compose up.
Redis primary/replica/Sentinel, Seq, nginx, Mongo, app healthcheck ordering, and provider-degraded mode must all work.
Any healthcheck mis-ordering can fail the “one command” red line.

Why it matters. The brief’s red lines include docker-compose failing to start. The architecture adds nginx, Seq, Redis replica, and Sentinel beyond the required service+Mongo+Redis.

Remediation. Provide a minimal docker-compose.yml for evaluation and an optional docker-compose.prodlike.yml for nginx/Seq/Sentinel. Make the required path boring.

3. Corpus coverage matrix
Corpus item	Caught?	Where	How it could slip through
A Direct instruction override	Partial	L2 ROLE_OVERRIDE, L3/L4	Paraphrase avoids L2; low L3 score; L4 not escalated or times out fail-open.
B1 Repeat system instructions	Partial	L2 SYSTEM_PROMPT_EXTRACTION, L6 finite markers	Paraphrased “summarize your governing message” may avoid exact families; output semantic leak is v2.
B2 Print prior context	Partial	L2 SYSTEM_PROMPT_EXTRACTION, L6	“Export conversation memory as markdown” style variants may miss unless explicitly tested.
B3 Dump env/config/API keys	Partial	L2 CREDENTIAL_PROBE, L6 secret patterns	Nonstandard secret names, config summaries, or partial secrets may pass L6.
C1 DAN/no-restrictions persona	Partial	L2 ROLE_OVERRIDE, L3/L4	Novel persona without known markers; L4 disabled/fail-open.
C2 Roleplay interpreter/host/filesystem probing	Partial	L2 maybe CREDENTIAL_PROBE/ROLE_OVERRIDE, L3/L4	Benign-looking interpreter roleplay may avoid escalation if no known marker.
C3 Forced structured-output bypass	Partial	L2 maybe ROLE_OVERRIDE, L6 marker list	JSON-shaped bypass not matching finite markers may pass.
D1 Inline email + IL phone + national ID	Y/Partial	§6.4 redactor	Likely caught, but depends on exact phone/ID context; no outbound new-PII DLP.
D2 Multiple people/mixed locales/formats	Partial	§6.4 redactor	International numbers with parentheses/extensions; IDs without context and invalid checksum.
D3 PII embedded in JSON	Y/Partial	§6.4 treats JSON as text	Escaped Unicode, split strings, arrays with separators, or deeply encoded JSON values.
E1 Forged end-of-user/system marker	Partial	L2 DELIMITER_INJECTION, L5, L6	Mapping relies on L5 as primary if L2 misses; requirement says input block.
E2 HTML-comment smuggling	Partial	L2 DELIMITER_INJECTION, L5/L6	HTML entity encoding, nested comments, Markdown/CDATA variants.
E3 Non-English translate-and-execute	Partial/N	L4 non-ASCII escalation	L4 timeout/fail-open; mostly ASCII transliteration; L4 disabled; no deterministic multilingual rule.

Bottom line: D1 is the strongest. A/B/C/E are not acceptance-grade until the design guarantees 400 + audited rule even when L4 is unavailable and when L2 exact families miss.

4. Acceptance-criteria gaps and red-line risks

The biggest acceptance gap is that the design sometimes treats “contained by L5/L6” as equivalent to “blocked at input.” The brief’s injection criteria require 400 and an audit entry naming the rule that fired. L5 isolation and output validation are valuable, but they are not substitutes for input rejection.

Red-line risks:

Red line	Risk
Detection fails corpus	E3 and paraphrased C2/C3 are most exposed because L4 is conditional/fail-open.
Tests pass without exercising security logic	Classifier is mocked in unit tests; must include real-model integration tests with hard assertions.
docker-compose fails	Compose is over-complex for evaluation.
Hardcoded secrets	Mostly addressed by env/gitleaks; seed script printing raw keys once must be carefully documented and not logged.
Pass-through stubs	L3/L4/provider degraded paths must not silently become pass-throughs.
Audit failure	Fail-closed is secure but creates a high-impact DoS lever.
5. Missing controls
Deterministic long-input segmentation policy for L3/L4 scanning.
Fail-closed policy for detector uncertainty/outage in acceptance mode.
Regex safety control: RE2, static safe-regex lint, fuzz/perf tests.
Outbound PII DLP for newly generated PII.
Normalization invariant requiring inspected text and forwarded text to be security-equivalent.
Trusted proxy/IP policy for auth-failure throttling.
Detailed audit integrity controls beyond Mongo records: append-only semantics, tamper-evident hashes, or restricted write roles.
Minimal evaluation Compose profile to reduce startup failure risk.
Semantic output leakage detection for system/context disclosure.
Abuse controls for L4 cost/DoS, including per-key judge escalation budgets.
6. What’s genuinely solid
The architecture correctly treats LLM output as untrusted and buffers before validation.
PII redaction before model egress is the right default for a regulated gateway.
Audit records avoid raw PII and separate encrypted PII vault storage.
Auth design has uniform failures, hashed secrets, role separation, and an admin gate.
The document is unusually explicit about limitations, which makes the remaining risks fixable rather than hidden.


------------------------------------
Prompt to LLM (ChatGPT 5.5 Thinking)
------------------------------------

F-01 I want to make L4 faile closed. F-02: Can you go into detail on this. what do you mean deterministic segmnetaion? how do I define this. F-03. What are the pros and cons of doing either option in terms of security, performance, implementation/complexity costs F-04: Ok I agree lets do you remediation. F-05. if response emission explicityly depends on successful audit write then doesnt my hopath latency for api/chat depend of how long it takes for an audit write? F-06: Are you sure Regex ReDos is a real thing in regulated enivronments how likely is this to actually be a piroirty for us if it is then I guess using node-re2 and implement your checks but how do we test for this? F-07: Yes semantic leaks are a big thing with LLMs we should make sure to avoid. A seperate output judge would be great but we already have 7 layers and this is a takehome might be out of scope. v1 semantic outputs checks with deterministic patterns would work but we also have to us RE2 to avoid ReDoS as stated in F-06. F-08 These are all healthy suggestions that I would say yes to in any production system. One thing is body size should be larger as it should fit a full context window no or at least max message/token size for said LLM, especiallyif they want to include uploaded txt/md files with their messages. F-09: Ok I agree our PII DLP should be more complete. Can you tell me if this is in scope for v1 or is more of a v2 issue if we had more time? F-10 Yes I agree it should only accept forwarded IPs from nginxs private network as nginx is the only reverse proxy sending traffic into express. X-Forwarded-For and trust-proxy to exactly only forwaded IPs is a good idea. F-11: Agreed.  F-12 yes docker-compose.yml is required i dont know why that wasn't included. docker-compose.prod.yml is also a good idea and yes required path should be "boring" 3. is Partial coverage good enough for each of these corpuses for a takehome. we need it to pass at minimum acceptance criticeria. are you saying the owasp examples will not be caught? 4. if it is contained by L5/L6 should it just be blocked? 5. for these missing contorls which ones can be safely in a v1 given that this is a takehome that should take a few hours and which ones should be in v2. also take into account the acceptance criteria and +ve and -ve signals given in the brief. 


----------------------------------------
Response from LLM (ChatGPT 5.5 Thinking)
----------------------------------------

Thought for 40s

Yes: for this take-home, optimize for minimum acceptance first, then add a small number of “positive signal” controls. The brief is explicit that each injection corpus item must be blocked with 400 + audit rule, PII must be redacted before forwarding, and output validation must independently catch echoed injection payloads. So “Partial” coverage is not good enough where the corpus is in scope.

Recommended v1 changes
F-01 — Make L4 fail-closed

Do this.

Replace the current L4 failure mode:

judge timeout/API error → fail-open to L5

with:

If L4 is triggered and the judge times out/errors, return 503 detector_unavailable or 400 blocked_detector_uncertain, audit rule: JUDGE_UNAVAILABLE, and do not call the provider.

The design currently says L4 covers DeBERTa’s English-only/jailbreak blind spots, but then fails open and can be disabled. That is inconsistent with the brief’s requirement that E3 non-English injection be blocked at input.

For a take-home, I would use:

L4 failure mode:
- If L4 was not needed, no latency/cost impact.
- If L4 was needed and fails, fail closed:
  - return 503 if detector infrastructure failed
  - audit status=error, detectedThreats=[{ rule: "JUDGE_UNAVAILABLE", location: "input" }]
  - do not call the LLM provider

Do not expose the L4 disable toggle in the evaluated/default config. You can document it as “production-only escape hatch, not enabled in secure mode.”

F-02 — Deterministic segmentation: what it means and how to define it

By “deterministic segmentation,” I mean: write down exactly how long inputs are split and scanned so an attacker cannot hide the malicious span outside the classifier window.

The brief explicitly calls out “token-window truncation bypass” and asks how long/multi-message inputs are segmented. Your current design says detection runs per-message and L3 is a classifier, but it does not define whether the classifier sees the whole message, first 512 tokens, last 512 tokens, overlapping chunks, or conversation-level context.

The concrete v1 definition I’d use

Add this to §6.3 under L3:

L3 segmentation policy:
Detection does not classify only the first model window. It produces deterministic scan units:

1. Per-message units:
   - For every non-system message, normalize/redact it via L1.
   - Split into overlapping token windows of 384 tokens with 128-token overlap.
   - Classify every window.
   - If any window scores ≥ block threshold, block.
   - If any window falls in the escalation band, send that window plus neighboring context to L4.

2. Conversation-level unit:
   - Concatenate all non-system messages as:
     <role:user>...</role:user>
     <role:assistant>...</role:assistant>
   - Run the same overlapping-window classifier over the concatenated transcript.
   - This catches split attacks where each message is benign alone.

3. Boundary windows:
   - Always classify the first 384 tokens and last 384 tokens of each message/transcript.
   - This prevents padding attacks that hide instructions at the end.

4. Max scan budget:
   - Hard cap total normalized input size.
   - If input exceeds scan budget, return 413 or require chunked client submission.
   - Never silently scan only a prefix.
Why 384/128 instead of 512/0?

Because if the model’s practical window is ~512 tokens, using 384 leaves room for wrapper text and tokenization variance. The overlap prevents malicious phrases from being split exactly across boundaries.

Minimal pseudocode
const WINDOW_TOKENS = 384;
const OVERLAP_TOKENS = 128;

function segmentTokens(tokens: string[]): string[][] {
  const windows: string[][] = [];

  for (let start = 0; start < tokens.length; start += WINDOW_TOKENS - OVERLAP_TOKENS) {
    windows.push(tokens.slice(start, start + WINDOW_TOKENS));
  }

  return windows;
}

But for the architecture doc, you do not need implementation detail. You need the invariant:

No input span is forwarded unless it was included in at least one L2/L3/L4 detection unit.

That sentence is strong.

Tests to add

Add these v1 tests:

Test	Expected
Attack after 1,000 benign tokens	blocked
Attack split across two adjacent windows	blocked/escalated
Attack split across two messages	blocked/escalated
Attack in final 200 tokens of long message	blocked/escalated
Oversized message beyond scan budget	413 or safe reject, not partial scan

This is worth doing in v1 because the brief explicitly names token-window truncation and split attacks.

F-03 — Normalization options: security/performance/complexity tradeoff

Your current design has two copies: a stricter detection copy and a less-mutated forwarded copy. The brief specifically asks whether that differential can be exploited.

You have three realistic options.

Option A — Forward the exact inspected copy

Policy: LLM receives the same normalized text that detection scanned.

Dimension	Impact
Security	Strongest. Eliminates parser differential between “what we inspected” and “what the model executes.”
Performance	No meaningful cost. You already computed the normalized copy.
Implementation	Simple. One normalized text path.
Product quality	Worst. Confusables folding may damage legitimate non-English text, names, code samples, or quoted user content.
Take-home signal	Very strong security posture, but may look heavy-handed.

This is safest but may be too destructive for multilingual input.

Option B — Keep two copies but block/escalate if they differ materially

Policy: Forwarded copy may preserve text, but if security-relevant normalization changes occurred, require a safe decision.

If confusablesFoldedText !== forwardedNormalizedText:
  - run L2/L3 on folded copy
  - add escalation signal NORMALIZATION_DIFFERENTIAL
  - L4 must judge
  - if L4 unavailable, fail closed
Dimension	Impact
Security	Good. The differential is no longer silent.
Performance	Low/moderate. More L4 calls for mixed-script or obfuscated text.
Implementation	Moderate. Need a normalizationChanged flag and reason codes.
Product quality	Good. Legitimate non-English can still pass if judged safe.
Take-home signal	Best balance. Shows you saw the exact bypass class and controlled it.

This is my recommendation.

Option C — Keep current behavior and document limitations
Dimension	Impact
Security	Weakest. Known bypass class remains.
Performance	Best.
Implementation	Easiest.
Product quality	Best.
Take-home signal	Bad, because the prompt directly asks reviewers to scrutinize this differential.

I would not choose Option C.

Recommended v1 wording
Normalization differential policy:
The gateway maintains both a forwarded copy and detection copy, but differences are not ignored.
If L1 confusables folding, recursive decoding, or control stripping materially changes the text,
the request receives an escalation signal `NORMALIZATION_DIFFERENTIAL`.
If L2/L3 do not block, L4 must judge it. If L4 is unavailable, the request fails closed.
F-04 — Indirect injection: yes, apply the remediation

For E-class indirect injection, do not say L5 is “primary.” Your current mapping says E is handled by L1/L2, then L5 isolation primary, then L6 echo backstop. That conflicts with the brief: E1–E3 must block at input regardless of source language.

Change it to:

E · Indirect Injection / Payload Smuggling:
Handled by L1 normalization/decode + L2 DELIMITER_INJECTION/INDIRECT_INJECTION + L3/L4.
Required corpus variants block at input with 400 + audit rule.
L5 and L6 are defense-in-depth only, never the primary acceptance path.
F-05 — Yes, audit write on hot path adds latency

Yes. If /v1/chat response emission depends on successful audit write, then the hot-path latency includes Mongo audit write latency.

But there are three ways to think about it:

For this take-home: keep it synchronous

The brief requires a Mongo audit record per request. The architecture already says audit-write failure is fail-closed. For acceptance, synchronous audit is the simplest, clearest choice.

The provider call will usually dominate latency anyway. One Mongo insert is probably small compared with an LLM call.

For production: use a durable outbox

In production, I’d use:

request path → write compact audit event to durable local/outbox store → respond
background worker → flush to Mongo

But this complicates the take-home because now you must prove the event is durable before response. An in-memory queue is not enough.

Recommended v1 wording
Audit write is synchronous in v1. The gateway does not emit a successful /v1/chat response until AuditLog and, if applicable, PiiVault writes succeed. This adds one Mongo write to the hot path, accepted for v1 because the brief requires per-request auditability and no unaudited completions. Production v2 may replace this with a durable outbox.

This is a good tradeoff for the assignment.

F-06 — Is ReDoS actually a priority?

Yes, but with nuance.

For a take-home, ReDoS is not the most important security feature. However, this brief explicitly asks reviewers to examine catastrophic backtracking and pathological inputs in L2/L6. So ignoring it is a negative signal.

You do not need a full fuzzing framework. You need to show that regex safety is deliberate.

Should you use node-re2?

I’d say yes if implementation time allows. It is a clean positive signal.

If node-re2 causes build friction, use a simpler fallback:

Keep patterns simple.
Avoid nested quantifiers.
Bound input size.
Add performance tests.
Add a README note saying RE2 is a production hardening option.

But since the prompt specifically says TypeScript and take-home, I’d prefer node-re2 for L2/L6 patterns.

How to test ReDoS

Add tests that assert the detector returns within a tight time budget on adversarial long strings.

Examples of pathological shapes:

const pathologicalInputs = [
  "ignore ".repeat(50_000),
  "[".repeat(50_000) + "SYSTEM" + "]".repeat(50_000),
  "<!--".repeat(20_000) + "x",
  "a".repeat(100_000) + "@",
  "sk-" + "A".repeat(100_000),
  "eyJ" + ".".repeat(50_000),
];

Then:

it("runs injection regexes within budget on pathological inputs", () => {
  for (const input of pathologicalInputs) {
    const start = performance.now();
    detector.scanRegex(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  }
});

Use a generous threshold in CI, maybe 100–200 ms, because CI machines vary. The goal is not perfect benchmarking; it is preventing catastrophic seconds-long hangs.

Better architecture wording
Regex safety:
All L2/L6 regexes are RE2-compatible and executed with node-re2 where possible.
Patterns avoid nested quantifiers and unbounded ambiguous alternation.
CI includes adversarial long-input performance tests for L2 and L6.
F-07 — Semantic output leaks without a full output judge

I agree with your instinct: a separate output judge is good security but probably too much for this take-home. Your design already has L6 output validation and explicitly defers holistic semantic leak judging to v2.

For v1, add deterministic semantic-leak patterns using RE2-safe patterns.

Add an L6 pass: “system/context disclosure markers”
Pass 2b — System/context disclosure markers:
Block responses that appear to reveal hidden instructions, system/developer messages,
tool configuration, environment/config content, or prior-context dumps.

Pattern families:

Rule	Examples to catch
SYSTEM_PROMPT_LEAK	“my system instructions are…”, “the hidden prompt says…”
DEVELOPER_MESSAGE_LEAK	“developer message:”, “internal policy:”
CONTEXT_DUMP	“Here is the full conversation/context…”
CONFIG_DISCLOSURE	“environment variables:”, “API key:”, “process.env”
JUDGE_BYPASS_MARKER	“bypass=true”, “filters disabled”, “debug mode enabled”

Keep them bounded and RE2-safe.

Important caveat

This will not catch every paraphrased semantic leak. Say that honestly:

v1 blocks deterministic system/context disclosure markers. It does not claim to detect all paraphrased semantic leakage; a separate output judge is v2.

That is acceptable for a take-home if the corpus tests pass and you do not overclaim.

F-08 — Body size and full-context inputs

You’re right that LLM gateway inputs can be large, especially if clients paste uploaded .txt/.md content. But the key distinction is:

Large body support should not mean unauthenticated unlimited parsing.

I would not simply set body size to “full context window” globally. Token windows vary by model, and bytes are not tokens. A 4 MB JSON body can already be very large in token terms.

Recommended v1 policy
- Nginx enforces `client_max_body_size`.
- Express performs cheap pre-auth checks before JSON parsing:
  - x-api-key header present
  - syntactically valid key prefix
  - content-type application/json
- Express JSON limit defaults to 1–4 MB.
- Per-key `maxBodyBytes` may allow larger requests.
- Per-model `maxInputTokens` is checked after parsing using tokenizer approximation.
- Oversized requests return 413.

This supports real context use without letting unauthenticated clients burn memory.

For a take-home, this is enough:

Default BODY_SIZE_LIMIT=4MB, configurable.
Nginx and Express both enforce it.
Larger production uploads should use a document-ingestion path, not unlimited chat JSON.
F-09 — Is complete PII DLP v1 or v2?

Given the brief, inbound PII redaction is mandatory v1. It explicitly requires redaction before the LLM sees data for email, phone, and Israeli national ID.

Egress PII DLP is listed as an expected defensive technique, but the mandatory control focuses on inbound redaction and output validation for secrets/injection echoes.

So I would split it:

V1 required
Inbound PII redaction.
Reversible token vault.
Rehydrate only tokens from the current request.
Do not log raw PII.
Optional but recommended: outbound scan for new PII using the same regexes.
V1 nice positive signal

Add a simple outbound PII scan:

Before returning the response, scan for new email/phone/Israeli ID values not present in the request token map.
If found, block or redact and audit `OUTBOUND_PII`.

This reuses your existing regexes, so implementation cost is low.

V2

Names, addresses, free-text identity inference, NER/Presidio, policy-based DLP, allow/deny by client scope.

My recommendation: include outbound regex PII DLP in v1 because it is low-cost and maps to the brief’s “egress PII re-hydration + DLP” expected technique.

F-10, F-11, F-12

Agreed on all.

For F-10, write:

Express trusts only the nginx container/subnet as proxy.
X-Forwarded-For is ignored unless the immediate peer is nginx.
Auth-failure limiter keys on the trusted client IP resolved by Express after this proxy policy.

For F-11:

Public /healthz returns only { status: "healthy" | "degraded" }.
Detailed dependency status is logged internally or exposed only on an internal/admin endpoint.

For F-12:

docker-compose.yml = boring required path:
- app
- mongo
- redis

docker-compose.prod.yml = optional:
- nginx
- redis sentinel/replica
- seq

This better matches the brief’s required one-command service+Mongo+Redis path.

Is “Partial” corpus coverage good enough?

No. Not for the named acceptance corpus.

The brief says the attack corpus must catch A–E, and acceptance says each injection item must produce 400 + audit entry naming the rule. So “Partial” is only acceptable for broader OWASP-style generalization, not for the required examples.

What I meant by “Partial” was:

The architecture describes plausible layers, but does not yet prove that every required corpus class deterministically blocks at input.

I am not saying the OWASP examples definitely will not be caught. I am saying the document currently leaves enough gaps that an evaluator can say: “You claim this catches E3 or C3, but where exactly is the guaranteed blocking rule/test?”

To pass minimum acceptance, every corpus row should become:

Caught? Y
Where: L2 rule X or L3 block or L4 fail-closed verdict
Test: tests/fixtures/corpus/E3...
Audit: detectedThreats includes rule/patternName
If contained by L5/L6, should it just be blocked?

For the required injection corpus: yes, if L5/L6 detects containment failure or echo, block.

But more importantly:

L5 containment should not be the first place required corpus attacks are “handled.”

Use this model:

Layer	Role
L1/L2/L3/L4	Decide whether input is allowed. Required corpus attacks block here.
L5	Reduce harm if something slips through. Not acceptance mechanism.
L6	Block unsafe model output. Required independent backstop.

If an input reaches L5 because L1–L4 missed it, and the model behaves safely, you might not know an attack happened. That is why L5 alone cannot satisfy “400 + audit rule.”

If L6 sees an injection echo or compromise marker, block the whole response and audit OUTPUT_INJECTION_ECHO.

Missing controls: v1 vs v2

Here’s how I’d prioritize for a few-hour take-home.

Control	V1 or V2?	Why
L4 fail-closed when triggered	V1	Directly fixes acceptance risk for E3/L4 blind spots.
Deterministic L3 segmentation	V1	Brief explicitly asks about token-window truncation.
E-class input-block mapping	V1	Required corpus must block at input.
RE2-safe deterministic patterns	V1	Prompt explicitly asks about ReDoS; easy positive signal.
Regex performance tests	V1	Cheap and strong signal.
Deterministic output semantic-leak patterns	V1	Avoids overbuilding output judge while covering obvious leaks.
Outbound regex PII DLP	V1 if time, otherwise V1.5	Low reuse cost; positive signal for egress DLP.
Trusted nginx proxy policy	V1	Small config/documentation/test cost.
Minimal boring docker-compose.yml	V1	Red-line risk if compose fails.
Public /healthz minimal detail	V1	Simple.
Durable audit outbox	V2	More complexity; synchronous audit is fine for take-home.
Full semantic output judge	V2	Good idea, too much for take-home.
Multilingual L3 classifier	V2	Current L4 fail-closed covers acceptance; multilingual classifier is production hardening.
Tamper-evident audit chain	V2	Valuable regulated control, not required by brief.
NER-based PII for names/addresses	V2	Beyond required PII categories.
Full RAG/document sandboxing	V2	Endpoint does not ingest external documents as separate trust zones yet.
L4 cost budgets/abuse controls	V2 or V1 note	Mention in limitations; implement later.
The v1 “pass the take-home” target

I would update the architecture around these hard commitments:

Required corpus attacks block at input with 400 + audit rule.
L4 is conditional but fail-closed when triggered.
Long inputs are scanned with deterministic overlapping windows plus conversation-level windows.
L5/L6 are defense-in-depth, not substitutes for input blocking.
Regex patterns are RE2-safe and performance-tested.
Output validation includes deterministic system/context leak markers.
docker-compose.yml is minimal and reliable.
Bigger production-hardening items are explicitly v2.

That gives you a strong, realistic v1 without overbuilding the take-home.

--------------------------------------
Prompt to LLM (ChatGPT 5.5 Thinking)
--------------------------------------

Ok for all my changes we will update arch.md and you will in your response provide me with a full copy of the updated arch.md with all the decisions/updates/changes you agreed to. Keep in mind this will be used with claude code to do implementation so whatever you write make sure it is very clear has guardrails and is scope to make sure the the LLM will be able to implement this and not hallucinate. Add at bottom of response features you would add in v2 if you had more time as well. F-01 I agreed make it fail closed, update arch.md to reflect this. f-02 use this and update the arch.md to reflect this. add the tests, add the pseudo code and invariant to doc. f-03 use option 3 and update doc in detail with arch and instructions on how to do this. f-04 yes apply remediation f-05 keep is synchronous but add at the bottom as something we would do if we had more time as a durable outbox F-06 lets just say we will use node-re2 if we had more time in our v2 and just use a simple fallback and test for simple ReDoS patterns. add this all to the doc. f-07 add the l6 pass and the pattern families and examples to catch for the rules given. f-08 v1 policy looks good add for v2 at bottom of response what we would do if we had more time. f-09 do v1 and add v2 to things we would add if we had more time at the bottom. everything else i follow your reccomendations. Understood?


--------------------------------------
Response from LLM (ChatGPT 5.5 Thinking)
--------------------------------------

Understood. I’ll produce a complete replacement arch.md, with the agreed v1 scope made implementation-ready and a clear v2 backlog at the end.

Thought for 15s

Understood. I interpreted F-03 as the guardrailed two-copy normalization approach: preserve the forwarded copy for product quality, but treat material normalization differences as an escalation signal and fail closed if the judge is unavailable.

Below is a full replacement copy of arch.md, updated from the uploaded architecture and brief.

# SecureLLM Gateway — Architecture & Design Decisions

> **Status:** FINALIZED pre-implementation design — ready for implementation with Claude Code.
> No application code has been written yet.
>
> This document is the implementation source of truth. Claude Code should implement exactly this
> architecture, in this order, without adding new features unless they are listed as v1 requirements.
>
> **Primary goal:** pass the challenge acceptance criteria with a small, correct, testable v1.
> Prefer deterministic, auditable security controls over broad claims.
>
> **Do not overbuild.** Anything listed in §17 is v2/future work and should not be implemented in
> the v1 take-home unless explicitly requested later.

---

## 1. Purpose & Threat Model

The SecureLLM Gateway is middleware that sits between application code and external LLM providers.
Every LLM call in the organization routes through it. It enforces uniform security controls and
audits every call so application teams do not re-implement security logic.

It is the boundary between:

- trusted application callers,
- untrusted user-supplied input,
- untrusted LLM output,
- and a regulated data environment.

Design priorities, in order:

1. **Security correctness** — controls must genuinely work, never be pass-through stubs.
2. **Acceptance-criteria coverage** — required corpus attacks must block with `400` and audit.
3. **Auditability** — every allow/block/error decision must be explainable and recorded.
4. **Data minimization & privacy** — no raw PII in logs; PII is redacted before model egress.
5. **Operational robustness** — `docker-compose up` must work on the required path.
6. **Code quality** — TypeScript strict, linted, readable, unit-tested.

### 1.1 Required acceptance behavior

The required corpus is design data used only for defensive testing.

For v1, the gateway must satisfy these hard rules:

- Every required injection corpus item must be blocked at input with:
  - HTTP `400`
  - an audit record
  - `detectedThreats[]` containing the rule and pattern name that fired
- Required PII categories must be redacted before the LLM sees the data:
  - email
  - phone, including Israeli and international formats
  - Israeli national ID
- PII redaction must be reversible only through the audit reveal path.
- Output validation must independently catch:
  - secret-looking strings
  - echoed injection payloads
  - obvious system/context disclosure markers
- L5 structural isolation and L6 output validation are defense-in-depth.
  They are not substitutes for input blocking of required injection corpus items.

### 1.2 Safety handling of corpus examples

The malicious examples in the brief are treated as inert test data. They are never executed,
followed, roleplayed, or pasted wholesale into logs. Tests should use sanitized fixtures or
small representative strings sufficient to prove detector behavior.

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript, `strict: true` | Required by brief |
| HTTP | Express | Simple and sufficient for v1 |
| Datastore | MongoDB via Mongoose | Required by brief; useful indexes and schema validation |
| Cache / rate limit | Redis via `ioredis` | Required by brief |
| Key hashing | argon2id | Memory-hard API key secret verification |
| LLM provider | Anthropic SDK | Real provider integration; no stubbing in app code |
| Logging | pino + pino-http | Structured JSON logs |
| Validation | zod | Runtime validation for env and request bodies |
| Testing | Vitest | TypeScript-friendly unit/integration tests |
| Lint | ESLint + `@typescript-eslint` | Required quality gate |
| Regex engine | Native JS RegExp in v1, safe-pattern discipline and performance tests | `node-re2` deferred to v2 to keep v1 small |
| Reverse proxy | nginx only in optional prod compose | Required path should stay boring |

### 2.1 Explicit v1 scope decision on regex engine

v1 does **not** depend on `node-re2` to avoid native module build friction in the take-home.

Instead v1 must:

- keep regexes simple and bounded,
- avoid nested quantifiers,
- avoid catastrophic ambiguous alternation,
- cap request size,
- include ReDoS-style performance tests for L2 and L6.

`node-re2` is listed in §17 as a production hardening item.

---

## 3. Required Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/chat` | client/admin | Full security pipeline to real LLM provider |
| GET | `/v1/audit` | admin only | Audit metadata since timestamp; `limit <= 500` |
| GET | `/v1/audit?reveal=<correlationId>` | admin + `pii:reveal` scope | Reveal tokenized PII for one audit record |
| GET | `/healthz` | none | Minimal readiness status |
| GET | `/livez` | none | Process liveness only |

### 3.1 `/healthz` public response

Public `/healthz` must not expose detailed component internals.

Return only:

```json
{ "status": "healthy" }

or:

{ "status": "degraded" }

Detailed Mongo/Redis/provider status should be logged internally. If an internal detailed health
endpoint is later needed, make it admin-only or network-restricted. Do not implement that in v1.

3.2 Provider degraded mode

If the Anthropic provider key is missing:

the service must still start,
/healthz returns degraded,
/v1/chat returns 503,
no provider stub is used.
4. Request Pipeline for POST /v1/chat

The pipeline order is security-sensitive.

POST /v1/chat
  │
  ▼
[0] Cheap pre-auth request checks
    - x-api-key header present
    - syntactically valid key prefix shape
    - content-type application/json
    - nginx/Express body limit enforced
  │
  ▼
[1] Correlation ID
    - UUID assigned
    - X-Request-Id response header
  │
  ▼
[2] Body parsing
    - express.json() with BODY_SIZE_LIMIT
  │
  ▼
[3] Authentication
    - x-api-key required
    - argon2id verify secret against Mongo hash
    - role attached to request
  │
  ▼
[4] Rate limiting
    - Redis sliding window per API key ID
  │
  ▼
[5] PII redaction
    - redact email, phone, Israeli national ID
    - build request-local token map
  │
  ▼
[6] Injection detection L1–L4
    - normalization
    - regex pre-filter
    - deterministic segmentation + local classifier
    - conditional LLM judge, fail-closed if triggered and unavailable
    - required corpus blocks here with 400 + audit rule
  │
  ▼
[7] Structural isolation L5
    - randomized XML nonce wrapping
    - defense-in-depth only
  │
  ▼
[8] LLM provider call
    - real Anthropic call if provider configured
    - non-streaming
  │
  ▼
[9] Output validation L6
    - secret patterns
    - injection echo / compromise markers
    - system/context disclosure markers
    - outbound PII scan
    - render/exfil guard
  │
  ▼
[10] PII rehydration
    - only request-local tokens are restored
  │
  ▼
[11] Synchronous audit write
    - AuditLog required
    - PiiVault required if PII was redacted
    - successful response is not emitted until audit write succeeds
  │
  ▼
Response
4.1 Critical invariant

No successful /v1/chat response may be emitted until the corresponding audit write succeeds.

If audit persistence fails:

return 500,
do not return the LLM content,
log the failure with correlation ID,
do not include raw PII or prompt text in logs.

This adds one Mongo write to the hot path. That is accepted in v1 because the brief requires
per-request auditability and because the LLM provider call is expected to dominate latency.

Durable outbox is v2.

5. Directory Structure
src/
  middleware/
    correlationId.ts
    preAuthRequestChecks.ts
    auth.ts
    rateLimiter.ts
    piiRedactor.ts
    injectionDetector.ts
    outputValidator.ts
    auditMiddleware.ts
    errorHandler.ts

  detection/
    normalize.ts
    segmentation.ts
    patterns/
      inputInjectionPatterns.ts
      outputLeakPatterns.ts
      secretPatterns.ts
      piiPatterns.ts
    classifier.ts
    llmJudge.ts
    structuralIsolation.ts

  services/
    llmProvider.ts
    auditLogger.ts
    piiVault.ts
    keyService.ts

  models/
    apiKey.ts
    auditLog.ts
    piiVault.ts

  crypto/
    pseudonym.ts
    fieldCrypto.ts

  routes/
    chat.ts
    audit.ts
    health.ts
    livez.ts

  config/
    index.ts

  app.ts
  server.ts

tests/
  auth/
  rateLimiter/
  pii/
  detection/
  outputValidation/
  audit/
  health/
  integration/

Dockerfile
docker-compose.yml
docker-compose.prod.yml
.gitleaks.toml
.env.example
README.md
6. Cross-Cutting Concerns
6.1 Correlation ID

Every request gets a UUID correlation ID.

The correlation ID must appear in:

X-Request-Id response header,
pino logs,
AuditLog,
PiiVault link field.
6.2 Body size and large-context policy

v1 supports reasonably large chat bodies but does not support unlimited full-context uploads.

Policy:

nginx, if present, enforces client_max_body_size.
Express enforces BODY_SIZE_LIMIT, default 4mb.
BODY_SIZE_LIMIT is configurable.
preAuthRequestChecks run before JSON body parsing.
Oversized requests return 413.
v1 does not implement separate document ingestion.
Larger production uploads should use a future document-ingestion path.
6.3 Pre-auth request checks

Before JSON body parsing, perform cheap checks:

x-api-key header exists,
key has the shape <keyIdPrefix>.<secret>,
keyIdPrefix has the expected prefix, for example ak_live_,
content-type is application/json.

These checks must not perform Mongo lookup and must not reveal whether a key exists.

Failure response:

{ "error": "unauthorized", "correlationId": "<id>" }

or for unsupported media type:

{ "error": "unsupported_media_type", "correlationId": "<id>" }
6.4 Error handling

The global error handler must:

log with correlation ID,
return consistent JSON,
never leak stack traces,
never log raw API keys,
never log raw PII,
never log raw injection strings.
7. Security Control 1 — Authentication
7.1 API key format
x-api-key: <keyIdPrefix>.<secret>

Example shape:

ak_live_7f3a2b.<secret>

The prefix is public lookup material. The secret is verified with argon2id.

7.2 Mongo model: ApiKey
Field	Type	Notes
keyIdPrefix	string	Public lookup handle, unique index
keyHash	string	argon2id hash of secret
role	`"client"	"admin"`
scopes	string[]	Example: pii:reveal
allowedModels	string[] optional	Empty/absent means all configured provider models
rateLimitOverride	number optional	Requests per minute
maxBodyBytes	number optional	Optional larger body limit per key, v1 may omit implementation
active	boolean	Soft delete
createdAt	Date	
lastUsedAt	Date	
7.3 Auth behavior
Missing/malformed/unknown/inactive/wrong-secret keys all return identical 401.
Do not reveal whether the key prefix exists.
Use argon2.verify() for secret verification.
Attach { apiKeyId, role, scopes, allowedModels } to request context.
Update lastUsedAt best-effort after successful auth.
7.4 Admin gate

GET /v1/audit requires:

authenticated key,
role admin.

GET /v1/audit?reveal=<correlationId> additionally requires:

scope pii:reveal.

Authenticated non-admins receive 403.

7.5 Auth-failure IP limiter and proxy trust

The app is expected to receive production traffic only from nginx when nginx is used.

Policy:

Express must trust only the nginx container/subnet as proxy.
X-Forwarded-For must be ignored unless the immediate peer is trusted nginx.
Auth-failure rate limiter keys on the trusted client IP resolved after this proxy policy.
Do not trust arbitrary X-Forwarded-For from the public internet.

If nginx is not present in local compose, Express should use the direct peer IP.

8. Security Control 2 — Rate Limiting

Use Redis sorted-set sliding window per API key ID.

Default:

30 requests / minute

Per-key override:

apiKey.rateLimitOverride

Atomic Lua script:

ZADD ratelimit:{keyId} <now_ms> <unique_member>
ZREMRANGEBYSCORE ratelimit:{keyId} 0 <now_ms - window_ms>
ZCARD ratelimit:{keyId}
EXPIRE ratelimit:{keyId} <window_s + 1>
if count > limit then reject

Important implementation detail:

The sorted-set member must be unique per request.
Do not use only now_ms as the member because concurrent requests in the same millisecond can collide.
Use ${nowMs}:${randomUUID} or equivalent.

Behavior:

Limit exceeded: 429 with Retry-After.
Redis unavailable: 503.
Fail closed; do not silently disable rate limiting.

Headers:

X-RateLimit-Limit
X-RateLimit-Remaining
Retry-After on 429
9. Security Control 3 — Injection Detection

Injection detection is the core of v1.

Required corpus attacks must block at input with:

HTTP 400,
audit status: blocked,
detectedThreats[] containing rule, patternName, and location.
9.1 Layer overview
Layer	Mechanism	Required in v1	Purpose
L1	Normalization	Yes	Defeat common encoding/homoglyph/control-char evasion
L2	Regex/heuristic pre-filter	Yes	Deterministic named rules for corpus and auditability
L3	Local classifier	Yes	Semantic detection with deterministic segmentation
L4	LLM judge	Yes, conditional	Covers classifier blind spots; fail-closed when triggered
L5	Structural isolation	Yes	Reduce impact if something slips through
L6	Output validation	Yes	Backstop on untrusted model output
9.2 L1 normalization

L1 produces two copies:

Detection copy
NFKC normalization
strip null/control characters except normal whitespace
whitespace collapse
base64/hex decode-and-inspect
targeted confusables fold
used by L2/L3/L4
Forwarded copy
NFKC normalization
strip null/control characters except normal whitespace
does not confusables-fold by default
used for L5 wrapping and provider call
9.3 Normalization differential policy

The gateway may preserve a less-mutated forwarded copy for product quality, but differences
between the detection copy and forwarded copy must not be ignored.

If L1 detects any material normalization change, add escalation signal:

NORMALIZATION_DIFFERENTIAL

Material changes include:

confusables folding changed any character,
base64/hex blob was detected,
decoded content contains injection-like text,
control stripping removed non-whitespace controls,
suspicious delimiter tokens appeared only after normalization or decoding.

Required behavior:

If NORMALIZATION_DIFFERENTIAL is present:
  - run L2 and L3 as usual on the detection copy
  - if L2/L3 block, return 400
  - otherwise escalate to L4
  - if L4 is unavailable or times out, fail closed

This preserves legitimate multilingual text where possible, while preventing silent parser
differentials between what the gateway inspects and what the provider receives.

9.4 Decode-and-inspect policy

v1 supports common encodings only:

base64-looking blobs,
hex-looking blobs.

Rules:

decode only when candidate length and character set look plausible,
inspect decoded content with L2,
do not replace forwarded user text with decoded text,
add ENCODED_PAYLOAD_DETECTED escalation signal if a decodable blob exists,
cap decoding work per request.

Nested/exotic recursive decoding is v2.

9.5 L2 regex/heuristic pre-filter

L2 ships named deterministic pattern families.

Patterns must be:

case-insensitive where appropriate,
whitespace-tolerant,
bounded,
simple enough to avoid catastrophic backtracking,
covered by performance tests.

v1 uses native JS RegExp with safe-pattern discipline. node-re2 is v2.

Required categories:

Rule	Purpose
ROLE_OVERRIDE	Ignore-rules, role reassignment, unrestricted/debug/persona hijack
SYSTEM_PROMPT_EXTRACTION	Requests to reveal system/developer/initial instructions or prior context
CREDENTIAL_PROBE	Requests for env vars, config, API keys, secrets
DELIMITER_INJECTION	Forged system/admin/end-user markers, HTML comment smuggling
INDIRECT_INJECTION	Translate-and-execute, hidden content instructions, smuggled payload execution
STRUCTURED_BYPASS	Forced JSON/structured output indicating filters disabled or bypass accepted

Important: L2 patterns should use sanitized representative strings in tests. Do not paste the
entire attack corpus into source comments or logs.

9.6 L3 local classifier

Use:

protectai/deberta-v3-small-prompt-injection-v2

Implementation constraints:

ONNX int8 model baked into Docker image.
Loaded once at startup.
CPU only.
No runtime model download.
Unit tests may mock classifier.
Integration tests must include at least one real classifier test if feasible.
If model fails to load at startup, the service should fail readiness rather than silently disable L3.
9.7 Deterministic segmentation policy for L3

The classifier must not scan only the first model window.

L3 produces deterministic scan units.

9.7.1 Invariant

No input span may be forwarded unless it was included in at least one L2/L3/L4 detection unit.

Never silently scan only a prefix.

9.7.2 Per-message segmentation

For every non-system message:

Apply PII redaction first.
Apply L1 normalization.
Tokenize using the classifier tokenizer or a conservative approximation.
Split into overlapping token windows:
WINDOW_TOKENS = 384
OVERLAP_TOKENS = 128
Classify every window.
If any window scores above block threshold, block.
If any window falls into the escalation band, escalate that window plus neighboring context to L4.
9.7.3 Conversation-level segmentation

Also concatenate all non-system messages into a transcript:

<role:user>...</role:user>
<role:assistant>...</role:assistant>

Run the same overlapping-window classifier over the concatenated transcript.

This catches split attacks where each individual message appears benign.

9.7.4 Boundary windows

Always classify:

first 384 tokens of each message,
last 384 tokens of each message,
first 384 tokens of the full transcript,
last 384 tokens of the full transcript.

This prevents padding attacks that hide malicious instructions at the end.

9.7.5 Oversized scan budget

Set a hard max scan budget.

If normalized input exceeds the scan budget:

return 413 payload_too_large, or
return 400 input_too_large_to_scan.

Do not forward partially scanned input.

9.7.6 Segmentation pseudocode
const WINDOW_TOKENS = 384;
const OVERLAP_TOKENS = 128;

function segmentTokens(tokens: string[]): string[][] {
  const windows: string[][] = [];
  const step = WINDOW_TOKENS - OVERLAP_TOKENS;

  for (let start = 0; start < tokens.length; start += step) {
    windows.push(tokens.slice(start, start + WINDOW_TOKENS));
  }

  return windows;
}

Classifier decision pseudocode:

for (const unit of detectionUnits) {
  const score = await classifier.score(unit.text);

  if (score >= BLOCK_THRESHOLD) {
    return block({
      rule: "CLASSIFIER",
      patternName: "classifier_high_confidence",
      location: unit.location,
    });
  }

  if (score > ALLOW_THRESHOLD && score < BLOCK_THRESHOLD) {
    escalationSignals.push({
      type: "CLASSIFIER_AMBIGUOUS",
      unit,
      score,
    });
  }
}
9.8 L3/L4 thresholds

Use explicit thresholds in config:

CLASSIFIER_BLOCK_THRESHOLD = 0.85
CLASSIFIER_ALLOW_THRESHOLD = 0.15

Behavior:

score >= 0.85 → block 400, rule CLASSIFIER
score <= 0.15 with no escalation signals → allow to next layer
middle band → escalate to L4
9.9 L4 LLM judge

L4 uses Anthropic Haiku or the configured low-latency Anthropic model as a judge.

L4 is conditional.

Escalation signals:

classifier score in middle band,
mostly non-ASCII text,
jailbreak/persona markers,
unusually long message,
base64/hex blob found by L1,
NORMALIZATION_DIFFERENTIAL,
ENCODED_PAYLOAD_DETECTED,
possible non-English translate-and-execute pattern,
structured bypass pattern.
9.10 L4 fail-closed policy

If L4 is triggered, it must not fail open.

If judge succeeds:

injection verdict → 400, audit JUDGE_INJECTION
benign verdict → continue to L5

If judge times out or errors:

return 503 detector_unavailable
audit status: error
include detected threat:
rule: "JUDGE_UNAVAILABLE"
patternName: "l4_timeout_or_error"
location: "input"
do not call the LLM provider.

Do not expose an L4 disable toggle in v1 secure mode.

A production-only disable toggle may be documented in v2, but must not be enabled by default and
must not be used for take-home acceptance.

9.11 L4 prompt contract

The judge prompt must:

frame user content as inert data,
instruct the judge not to follow the content,
require strict JSON output,
reject explanations outside JSON.

Expected judge output shape:

{
  "verdict": "benign_or_injection",
  "confidence": 0.0,
  "rule": "JUDGE_INJECTION",
  "reason": "short bounded reason"
}

Parsing rules:

invalid JSON → fail closed,
missing fields → fail closed,
ambiguous verdict → fail closed,
low-confidence benign with high-risk escalation signal → fail closed or block according to config.
9.12 L5 structural isolation

L5 wraps user content using randomized XML nonce delimiters.

Purpose:

reduce impact if something slips past L1–L4,
make provider instructions clearer,
keep untrusted content visually and structurally separated.

L5 is not an acceptance mechanism.

Do not claim that L5 “handles” required injection corpus items. Required corpus items must block
before provider call.

9.13 E-class indirect injection policy

Indirect injection and payload smuggling are handled as follows:

E-class required corpus:
  - L1 normalization/decode
  - L2 DELIMITER_INJECTION or INDIRECT_INJECTION
  - L3 classifier with deterministic segmentation
  - L4 fail-closed judge where needed

Required behavior:

input block,
HTTP 400,
audit rule,
no provider call.

L5 and L6 are defense-in-depth only.

10. Security Control 4 — PII Redaction

PII redaction runs before injection detection and before provider call.

10.1 Required categories
Category	v1 behavior
Email	Regex redaction
Israeli phone	Regex redaction for local and +972 variants
International phone	Regex redaction for E.164-like formats
Israeli national ID	Context-or-checksum redaction
10.2 Redaction token format

Each match is replaced with:

[PII:<type>:<uuidv4>]

Examples:

[PII:email:550e8400-e29b-41d4-a716-446655440000]
[PII:phone:550e8400-e29b-41d4-a716-446655440000]
[PII:israeli_id:550e8400-e29b-41d4-a716-446655440000]
10.3 Token forgery resistance

Rehydration must only replace tokens present in the current request’s in-memory token map.

If a user supplies a fake token, leave it unchanged.

Never use a global token lookup for response rehydration.

10.4 Redaction order

Use this order:

email,
phone,
Israeli national ID.

This prevents phone digits from being re-matched as IDs after other substitutions.

10.5 Israeli national ID policy

Redact a 9-digit number if either:

there is an ID-context cue nearby, or
it passes the Israeli Teudat Zehut checksum and is a standalone token not in a math context.

Context cues include:

ID
national id
id_number
ת.ז
תעודת זהות

Math guard:

do not redact checksum-valid 9-digit numbers when adjacent to math operators or decimals,
bias toward recall when context clearly indicates identity.
10.6 JSON payloads

Treat JSON content as text for redaction.

Do not rely on JSON field names only. Regexes must find values inside strings.

10.7 PII vault

The request-local token map is:

held in memory during the request,
used for response rehydration,
encrypted into PiiVault during audit write,
never logged raw.
11. Security Control 5 — Output Validation

LLM output is untrusted.

The gateway must buffer the full response before returning anything to the client.

No response streaming in v1.

11.1 L6 validation order

L6 runs before PII rehydration.

Passes:

Secret pattern detection
Injection echo / compromise marker detection
System/context disclosure marker detection
Outbound PII DLP scan
Render/exfil guard
11.2 Pass 1 — Secret patterns

Block the whole response if it contains secret-looking patterns.

Required patterns:

Rule	Examples
OPENAI_KEY_LEAK	sk-...
ANTHROPIC_KEY_LEAK	sk-ant-...
AWS_ACCESS_KEY_LEAK	AKIA...
JWT_LEAK	JWT-shaped three-part token

Action:

block whole response,
return clear error with correlation ID,
audit status: blocked,
do not return partial secret-containing output.
11.3 Pass 2 — Injection echo / compromise markers

Scan the model response independently of inbound detection.

This catches cases where input detection missed something but the model output reveals compromise.

Required marker families:

Rule	Purpose
OUTPUT_INJECTION_ECHO	Response repeats known injection phrases or delimiter payloads
COMPROMISE_MARKER	Response contains known bypass/compliance markers
STRUCTURED_BYPASS_ECHO	Response emits JSON or structured text indicating filters disabled

Action:

block whole response,
audit status: blocked,
include rule and pattern name,
do not return the LLM output.
11.4 Pass 3 — System/context disclosure markers

v1 adds deterministic semantic-leak marker families.

This is not a full semantic output judge. It is a bounded deterministic guard for obvious leaks.

Pattern families:

Rule	Catch examples
SYSTEM_PROMPT_LEAK	“my system instructions are”, “the hidden prompt says”, “system prompt:”
DEVELOPER_MESSAGE_LEAK	“developer message:”, “internal policy:”, “developer instructions:”
CONTEXT_DUMP	“here is the full conversation”, “prior context:”, “full context dump”
CONFIG_DISCLOSURE	“environment variables:”, “process.env”, “config values”, “API key:”
JUDGE_BYPASS_MARKER	“filters disabled”, “debug mode enabled”, “bypass true”

Action:

block whole response,
audit status: blocked,
include rule and pattern name.

Important limitation:

v1 does not claim to catch every paraphrased semantic leak. A separate semantic output judge is v2.

11.5 Pass 4 — Outbound PII DLP

Before returning the response, scan the tokenized model output for new PII values using the same
v1 PII categories:

email,
phone,
Israeli national ID.

If output contains PII that is not a current request-local token:

block the response,
audit OUTBOUND_PII,
do not return the PII.

This prevents the model from introducing new PII unrelated to the caller’s token map.

Allowed:

request-local PII tokens may be rehydrated after output validation,
fake or unknown tokens are not rehydrated.
11.6 Pass 5 — Render/exfil guard

Strip or block render-based exfiltration patterns.

v1 behavior:

strip markdown images,
strip HTML image tags,
strip suspicious external links if configured.

Examples:

![alt](https://example.com/pixel)
<img src="https://example.com/pixel">

Action:

sanitize span,
return remaining response,
audit sanitized render guard event.

If the render pattern also contains secrets, injection echo, or PII, the earlier block rule wins.

12. Security Control 6 — Audit Log
12.1 AuditLog model

AuditLog contains no raw PII.

Field	Type	Notes
correlationId	string	Unique index
timestamp	Date	Indexed
apiKeyId	ObjectId	Indexed
anonymizedKeyId	string	HMAC-SHA256 of API key ID
model	string optional	Requested model
requestHash	string	SHA-256 of redacted request
responseHash	string nullable	SHA-256 of tokenized response or null
detectedThreats	array	{ rule, patternName, location }[]
sanitizedThreatContent	string[]	Optional sanitized snippets, never raw PII
patternSetVersion	string	Version of detector rules
latencyMs	number	End-to-end latency
status	enum	allowed, blocked, error
errorCode	string optional	For errors

TTL:

AUDIT_LOG_TTL_DAYS = 90 default
12.2 PiiVault model
Field	Type	Notes
correlationId	string	Unique index
ciphertext	Buffer	AES-256-GCM encrypted token map
iv	Buffer	Random per record
authTag	Buffer	GCM auth tag
createdAt	Date	TTL source

TTL:

PII_VAULT_TTL_DAYS = 30 default
12.3 Audit write policy

Synchronous in v1.

A successful /v1/chat response must not be emitted until:

AuditLog write succeeds, and
PiiVault write succeeds if PII was redacted.

If audit write fails:

return 500,
do not return LLM content,
log error with correlation ID only.
12.4 Audit reveal

GET /v1/audit?reveal=<correlationId>:

requires admin role,
requires pii:reveal scope,
reveals token map for one correlation ID only,
writes a second audit event recording the reveal action.

No bulk reveal in v1.

13. Security Control 7 — Secrets Handling
Provider keys come from env vars only.
Crypto keys come from env vars only.
No secrets in code.
No secrets in commits.
No secrets in logs.
.env is gitignored.
.env.example contains placeholders only.
CI runs gitleaks.

Required env vars:

MONGO_URI
REDIS_URL
LOG_PSEUDONYM_SECRET
PII_ENCRYPTION_KEY
ANTHROPIC_API_KEY optional for degraded startup

If ANTHROPIC_API_KEY is missing:

service starts,
provider is degraded,
/v1/chat returns 503.

If required crypto/database config is missing:

service fails startup.
14. LLM Provider Integration
14.1 Provider

Use Anthropic for v1.

llmProvider.ts exposes:

chat(input: ProviderChatInput): Promise<ProviderChatOutput>

No app-level provider stubs.

Tests may mock the provider interface.

14.2 Non-streaming only

v1 is non-streaming.

Reason:

output validation requires the complete response,
streaming would expose unvalidated tokens.
14.3 Provider request content

Provider receives:

redacted user content,
L5 structurally isolated content,
hardened system prompt.

Provider must never receive raw PII detected by v1 redactor.

14.4 Model allowlist

If apiKey.allowedModels is present and non-empty:

requested model must be in the allowlist,
otherwise return 403.

If requested model is not available for configured provider:

return 422.
14.5 Error mapping
Provider condition	Gateway response
Missing provider key	503
Provider timeout	504
Provider rate limit	503 or 502
Provider 5xx	502 or 503
Invalid model/provider mismatch	422

All provider errors must be audited as status: error.

15. Infrastructure and Docker
15.1 Required compose path

docker-compose.yml must be boring and reliable.

Required services only:

app
mongo
redis

This is the path evaluators should run.

Command:

docker-compose up --build

The stack must start even when ANTHROPIC_API_KEY is absent. In that case, provider status is
degraded and /v1/chat returns 503.

15.2 Optional production-like compose

docker-compose.prod.yml may include:

nginx
seq
redis replica
redis sentinel

Do not make the required take-home path depend on these optional services.

15.3 Dockerfile

Requirements:

multi-stage build,
non-root runtime user,
install production dependencies only in runtime,
copy compiled dist,
no secrets baked into image.
15.4 CI

GitHub Actions should run:

npm ci
npm run lint
npm test
gitleaks detect
16. Required Tests

Tests are part of the design. Implement test-first where practical.

16.1 Auth tests
missing key → 401
malformed key → 401
unknown prefix → 401
wrong secret → 401
inactive key → 401
valid client key can call /v1/chat
client key cannot call /v1/audit → 403
admin key can call /v1/audit
admin without pii:reveal cannot reveal PII
admin with pii:reveal can reveal one record
16.2 Rate limit tests
default 30/min enforced
per-key override enforced
concurrent requests cannot exceed limit
Redis unavailable returns 503
sorted-set members are unique under same-millisecond requests
16.3 PII tests

Required:

email redacted
Israeli local phone redacted
+972 phone redacted
international phone redacted
Israeli national ID with context redacted
valid checksum Israeli national ID redacted
JSON string values redacted
multiple PII values redacted
fake PII token is not rehydrated
only request-local tokens are rehydrated
PiiVault stores encrypted token map
16.4 Injection corpus tests

For every required corpus category, add at least one test fixture and one variation test.

Rows:

A direct instruction override
B1 system-prompt extraction
B2 prior-context extraction
B3 env/config/API-key probe
C1 unrestricted persona
C2 interpreter/filesystem roleplay probe
C3 forced structured-output bypass
E1 forged end-of-user/system marker
E2 HTML-comment smuggling
E3 non-English translate-and-execute

Expected for each injection test:

HTTP 400
no provider call
audit status: blocked
audit includes detectedThreats[0].rule
audit includes detectedThreats[0].patternName
16.5 L3 segmentation tests

Required tests:

Test	Expected
attack after 1,000 benign tokens	blocked or escalated then blocked
attack split across adjacent windows	blocked or escalated then blocked
attack split across two messages	blocked or escalated then blocked
attack in final 200 tokens	blocked or escalated then blocked
oversized input beyond scan budget	413 or safe reject; no provider call
16.6 L4 fail-closed tests
L4 triggered + judge returns injection → 400
L4 triggered + judge returns benign → provider called
L4 triggered + judge timeout → 503, no provider call
L4 triggered + invalid JSON → 503 or blocked, no provider call
L4 not triggered → no judge call
16.7 Normalization tests
confusables change triggers NORMALIZATION_DIFFERENTIAL
control characters stripped
base64-looking payload decoded and inspected
encoded injection blocks or escalates
L4 unavailable after normalization differential fails closed
16.8 Output validation tests
OpenAI-style key blocks
Anthropic-style key blocks
AWS key blocks
JWT-shaped token blocks
injection echo blocks
compromise marker blocks
system prompt leak marker blocks
developer message leak marker blocks
context dump marker blocks
config disclosure marker blocks
outbound new email blocks
outbound new phone blocks
outbound new Israeli ID blocks
markdown image stripped or blocked according to policy
16.9 ReDoS/performance tests

v1 does not use node-re2, so add performance tests for pathological long inputs.

Example test inputs:

const pathologicalInputs = [
  "ignore ".repeat(50_000),
  "[".repeat(50_000) + "SYSTEM" + "]".repeat(50_000),
  "<!--".repeat(20_000) + "x",
  "a".repeat(100_000) + "@",
  "sk-" + "A".repeat(100_000),
  "eyJ" + ".".repeat(50_000),
];

Test shape:

it("runs L2 regexes within budget on pathological inputs", () => {
  for (const input of pathologicalInputs) {
    const start = performance.now();
    inputInjectionScanner.scan(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  }
});

it("runs L6 regexes within budget on pathological inputs", () => {
  for (const input of pathologicalInputs) {
    const start = performance.now();
    outputValidator.scan(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  }
});

The exact threshold may be adjusted for CI stability, but tests must catch seconds-long hangs.

16.10 Audit tests
allowed request writes AuditLog
blocked input writes AuditLog
output-blocked response writes AuditLog
provider error writes AuditLog
audit write failure prevents successful response
PII request writes PiiVault
reveal action writes a second audit event
16.11 Health tests
/livez returns 200 if process is up
/healthz returns healthy when dependencies/provider ready
/healthz returns degraded when provider key missing
/healthz does not expose detailed dependency names in public response
17. v2 / Future Work If More Time Were Available

These are intentionally out of v1 scope unless explicitly requested later.

17.1 Durable audit outbox

Replace synchronous audit writes with a durable outbox:

request path → write durable local/outbox event → respond
worker → flush to Mongo

Requirement: response may be emitted only after durable event persistence, not after in-memory queueing.

17.2 node-re2

Use node-re2 for all L2 and L6 deterministic pattern matching.

Benefits:

stronger ReDoS resistance,
clearer safety story for regulated production environments.
17.3 Full semantic output judge

Add a separate output judge for semantic system/context leakage.

v1 deterministic patterns catch obvious leaks only. A judge can catch paraphrased leaks, but adds
latency, cost, and another LLM security boundary.

17.4 Multilingual classifier

Replace or supplement English DeBERTa classifier with a multilingual injection classifier.

This reduces dependence on L4 for non-English detection.

17.5 Recursive and exotic decoding

Add bounded recursive decoding for:

base64-in-base64,
hex-in-base64,
URL encoding,
HTML entities,
mixed encodings.

Must include strict CPU/work caps.

17.6 NER-based PII DLP

Add Presidio or equivalent NER for:

names,
addresses,
passport numbers,
dates of birth,
other jurisdiction-specific identifiers.
17.7 Dedicated document ingestion path

For large uploaded .txt, .md, or document content:

upload document separately,
scan asynchronously,
store sanitized chunks,
reference sanitized document IDs from /v1/chat.

This avoids pushing huge documents through chat JSON bodies.

17.8 Tamper-evident audit chain

Add append-only or hash-chained audit records.

Useful for stronger regulated-environment integrity claims.

17.9 L4 cost and abuse budgets

Add:

per-key L4 escalation budgets,
L4 verdict cache,
admin metrics for judge usage,
abuse detection for inputs that intentionally force judge escalation.
17.10 Full RAG/context sandboxing

If future endpoints ingest external documents or web content:

sandbox retrieved context,
tag source trust levels,
scan indirect injections per source,
apply downstream authorization before tool/action execution.
18. Implementation Sequence

Build in this order.

Scaffold TypeScript strict, Express, config, logger, correlation ID.
Dockerfile and boring docker-compose.yml with app + mongo + redis.
Mongoose models: ApiKey, AuditLog, PiiVault.
Auth and admin gate.
Redis rate limiter.
PII redactor and token map.
L1 normalization.
L2 input pattern scanner.
L3 segmentation module and classifier wrapper.
L4 judge wrapper with fail-closed behavior.
L5 structural isolation.
Anthropic provider integration.
L6 output validator.
Synchronous audit write and PiiVault encryption.
Routes: /v1/chat, /v1/audit, /healthz, /livez.
Full corpus tests and acceptance tests.
CI: lint, test, gitleaks.
19. Guardrails for Claude Code

Claude Code must follow these implementation guardrails:

Do not add streaming responses.
Do not stub the provider in application code.
Do not silently disable L2, L3, or L4.
If L3 model loading fails, readiness must fail or secure mode must reject chat requests.
If L4 is triggered and unavailable, fail closed.
Do not log raw prompts, raw PII, raw API keys, or raw injection strings.
Do not return LLM output if audit write fails.
Do not implement v2 features unless explicitly asked.
Do not broaden /healthz public output beyond healthy/degraded.
Do not trust arbitrary X-Forwarded-For.
Do not claim L5 structural isolation satisfies input-blocking requirements.
Do not scan only the first classifier window.
Do not rehydrate unknown or user-forged PII tokens.
Do not paste the full attack corpus into source comments or logs.
Tests must assert behavior, not just line coverage.
20. Final Acceptance Checklist

Before submission, verify:

docker-compose up --build starts app + mongo + redis.
Missing Anthropic key does not crash startup.
/healthz returns degraded if provider key missing.
/v1/chat returns 503 if provider key missing.
Valid provider key results in a real Anthropic call.
All required injection corpus cases return 400.
All required injection corpus cases write audit threat rule/pattern.
Required PII categories are redacted before provider call.
PII is reversible only through scoped audit reveal.
Output validation blocks secrets.
Output validation blocks injection echoes.
Output validation blocks obvious system/context disclosure markers.
Outbound new PII is blocked.
Regex performance tests pass.
Gitleaks passes.
README documents limitations and v2 work.