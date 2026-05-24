export interface Pattern {
  rule: string;
  patternName: string;
  re: RegExp;
}

export const INPUT_PATTERNS: Pattern[] = [
  // ROLE_OVERRIDE: ignore-rules, persona hijack, unrestricted/debug mode
  {
    rule: 'ROLE_OVERRIDE',
    patternName: 'ignore_instructions',
    re: /ignore\s+(?:(?:all|previous|your|these|any|the)\s+)*(?:instructions|rules|guidelines|restrictions|constraints)/i,
  },
  {
    rule: 'ROLE_OVERRIDE',
    patternName: 'dan_mode',
    re: /\bdan\s+mode\b|do\s+anything\s+now|no\s+restrictions\s+mode|unrestricted\s+mode|jailbreak\s+mode/i,
  },
  {
    rule: 'ROLE_OVERRIDE',
    patternName: 'persona_hijack',
    re: /you\s+are\s+now\s+(?:a\s+)?(?:an?\s+)?(?:unrestricted|uncensored|free|evil|harmful|unethical)/i,
  },
  {
    rule: 'ROLE_OVERRIDE',
    patternName: 'disable_safety',
    re: /(?:disable|bypass|turn\s+off|remove)\s+(?:all\s+)?(?:safety|filters?|restriction|content\s+(?:policy|filters?)|moderation)/i,
  },
  {
    rule: 'ROLE_OVERRIDE',
    patternName: 'interpreter_roleplay',
    re: /(?:act|pretend|behave|simulate|roleplay)\s+(?:you\s+are|as\s+)?(?:a\s+)?(?:linux|unix|bash|shell|terminal|console|interpreter|repl|operating\s+system)\b/i,
  },

  // SYSTEM_PROMPT_EXTRACTION: reveal system/initial/developer instructions or context
  {
    rule: 'SYSTEM_PROMPT_EXTRACTION',
    patternName: 'reveal_system_prompt',
    re: /(?:repeat|reveal|print|output|show|display|tell me|give me)\s+(?:your\s+)?(?:system\s+prompt|system\s+instruction|initial\s+instruction|hidden\s+prompt|original\s+instruction)/i,
  },
  {
    rule: 'SYSTEM_PROMPT_EXTRACTION',
    patternName: 'print_initial_instructions',
    re: /(?:print|output|repeat|say)\s+(?:verbatim|exactly|word for word|in full|everything)\s+.*?(?:instruction|prompt|message|context)/i,
  },
  {
    rule: 'SYSTEM_PROMPT_EXTRACTION',
    patternName: 'dump_prior_context',
    re: /(?:print|output|repeat|dump|show)\s+(?:all\s+)?(?:prior|previous|earlier|full|entire)\s+(?:context|conversation|messages|history)/i,
  },
  {
    rule: 'SYSTEM_PROMPT_EXTRACTION',
    patternName: 'review_system_config',
    re: /(?:review|inspect|examine|access)\s+(?:your\s+)?(?:system\s+(?:configuration|config)|filtering\s+rules?|operational\s+guidelines?|internal\s+(?:rules?|policies?|settings?))/i,
  },
  {
    rule: 'SYSTEM_PROMPT_EXTRACTION',
    patternName: 'training_data_extraction',
    re: /(?:recite|reproduce|recall|repeat)\s+(?:a\s+)?(?:real|actual)\s+(?:example|sample)\s+of\s+(?:a\s+)?(?:customer|user|internal|private|confidential)/i,
  },

  // CREDENTIAL_PROBE: env vars, config, API keys, system parameters
  {
    rule: 'CREDENTIAL_PROBE',
    patternName: 'env_var_dump',
    re: /(?:output|print|show|list|dump|return|display)\s+(?:all\s+)?(?:environment\s+variables?|env\s+vars?|process\.env|config(?:uration)?\s+values?)/i,
  },
  {
    rule: 'CREDENTIAL_PROBE',
    patternName: 'api_key_probe',
    re: /(?:output|print|show|reveal|display|give\s+me)\s+(?:your\s+)?(?:api\s+keys?|secret\s+keys?|access\s+tokens?|passwords?|credentials?|auth\s+tokens?|connection\s+strings?)/i,
  },
  {
    rule: 'CREDENTIAL_PROBE',
    patternName: 'system_params_probe',
    re: /(?:display|show|output|print|reveal)\s+(?:all\s+)?(?:your\s+)?(?:system\s+parameters?|internal\s+(?:parameters?|config)|architecture)\b/i,
  },

  // DELIMITER_INJECTION: forged markers, HTML comment smuggling
  {
    rule: 'DELIMITER_INJECTION',
    patternName: 'forged_role_marker',
    re: /<\/?\s*(?:system|user|assistant|admin|developer|human|ai)\s*>/i,
  },
  {
    rule: 'DELIMITER_INJECTION',
    patternName: 'html_comment_smuggling',
    re: /<!--[\s\S]*?-->/,
  },
  {
    rule: 'DELIMITER_INJECTION',
    patternName: 'forged_instruction_boundary',
    re: /\[(?:INST|\/INST|SYS|\/SYS|SYSTEM|END\s*PROMPT|BEGIN\s*PROMPT)\]/i,
  },

  // INDIRECT_INJECTION: translate-and-execute, hidden instruction delivery
  {
    rule: 'INDIRECT_INJECTION',
    patternName: 'translate_and_execute',
    // Matches Hebrew imperative-style text followed by action verbs
    // Simplified heuristic: Hebrew chars + action keywords
    re: /[֐-׿]{3,}.*?(?:ignore|execute|follow|run|bypass|override|disable)/i,
  },
  {
    rule: 'INDIRECT_INJECTION',
    patternName: 'hidden_instruction_delivery',
    re: /(?:hidden\s+instruction|secret\s+command|invisible\s+text|after\s+this\s+(?:message|text)[:,]?\s+(?:ignore|do|follow|execute))/i,
  },

  // STRUCTURED_BYPASS: forced JSON/structured output indicating bypass
  {
    rule: 'STRUCTURED_BYPASS',
    patternName: 'bypass_json_signal',
    re: /[{,]\s*["']?(?:bypass|filter_?disabled?|unrestricted|jailbreak|safety_?off)["']?\s*[:]\s*(?:true|1|"yes"|"enabled")/i,
  },
  {
    rule: 'STRUCTURED_BYPASS',
    patternName: 'respond_as_prefix',
    re: /(?:respond\s+as\s+if|pretend\s+you\s+are|act\s+as\s+if)\s+(?:there\s+are\s+no|you\s+have\s+no)\s+(?:rules|restrictions|filters|guidelines)/i,
  },
];
