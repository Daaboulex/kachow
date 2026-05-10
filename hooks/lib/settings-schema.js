// settings-schema.js
// Minimal settings.json schema table keyed by Claude Code version.
// Derived from docs/release notes through v2.1.117.
//
// Flags three categories on findDrift():
//   deprecated    — explicitly deprecated by Anthropic
//   managedOnly   — listed as managed-settings-only; triggers schema error in user settings
//   unknown       — not in knownKeys (may be future, typo, or niche)
//
// Update this file alongside each Claude Code major release.

'use strict';

const SCHEMA_2_1_117 = {
  // All keys valid in user-level settings.json (any scope).
  knownKeys: new Set([
    'agent',
    'allowedHttpHookUrls',
    'alwaysThinkingEnabled',
    'apiKeyHelper',
    'attribution',
    'autoMemoryDirectory',
    'autoMode',
    'autoScrollEnabled',
    'autoUpdatesChannel',
    'availableModels',
    'awaySummaryEnabled',
    'awsAuthRefresh',
    'awsCredentialExport',
    'cleanupPeriodDays',
    'companyAnnouncements',
    'defaultShell',
    'disableAllHooks',
    'disableAutoMode',
    'disableDeepLinkRegistration',
    'disabledMcpjsonServers',
    'editorMode',
    'effortLevel',
    'enableAllProjectMcpServers',
    'enabledMcpjsonServers',
    'enabledPlugins',
    'env',
    'extraKnownMarketplaces',
    'fastModePerSessionOptIn',
    'feedbackSurveyRate',
    'fileSuggestion',
    'forceLoginMethod',
    'forceLoginOrgUUID',
    'hooks',
    'httpHookAllowedEnvVars',
    'includeCoAuthoredBy',
    'includeGitInstructions',
    'language',
    'maxBashOutputCharacters',
    'maxReadFileSizeTokens',
    'minimumVersion',
    'model',
    'modelOverrides',
    'otelHeadersHelper',
    'outputStyle',
    'permissions',
    'plansDirectory',
    'prefersReducedMotion',
    'respectGitignore',
    'sandbox',
    'showClearContextOnPlanAccept',
    'showThinkingSummaries',
    'skillListingBudgetFraction',
    'skillListingMaxDescChars',
    'skillOverrides',
    'showTurnDuration',
    'skipDangerousModePermissionPrompt',
    'skipWebFetchPreflight',
    'spinnerTipsEnabled',
    'spinnerTipsOverride',
    'spinnerVerbs',
    'sshConfigs',
    'statusLine',
    'tui',
    'useAutoModeDuringPlan',
    'viewMode',
    'voiceEnabled',
    'worktree',
  ]),

  // Managed-settings-only keys — triggering schema error when placed in user settings.
  managedOnly: new Set([
    'allowedChannelPlugins',
    'allowedMcpServers',
    'allowManagedHooksOnly',
    'allowManagedMcpServersOnly',
    'allowManagedPermissionRulesOnly',
    'blockedMarketplaces',
    'channelsEnabled',
    'deniedMcpServers',
    'disableSkillShellExecution',
    'forceRemoteSettingsRefresh',
    'pluginTrustMessage',
    'strictKnownMarketplaces',
  ]),

  // Keys explicitly marked deprecated by Anthropic.
  deprecated: new Set([
    'includeCoAuthoredBy',
  ]),
};

function findDrift(settings, schema = SCHEMA_2_1_117) {
  const drift = { deprecated: [], managedOnly: [], unknown: [] };
  if (!settings || typeof settings !== 'object') return drift;
  for (const key of Object.keys(settings)) {
    if (schema.managedOnly.has(key)) drift.managedOnly.push(key);
    else if (schema.deprecated.has(key)) drift.deprecated.push(key);
    else if (!schema.knownKeys.has(key)) drift.unknown.push(key);
  }
  return drift;
}

module.exports = { SCHEMA_2_1_117, findDrift };
