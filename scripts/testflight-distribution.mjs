// Pure decisions for giving a TestFlight build to external test groups.
// Used by scripts/testflight-distribute.mjs and unit tested; kept free of
// node: imports so the test can load it under the Workers pool.

/**
 * The groups a build should go to. With no names, every external group;
 * otherwise exactly the named ones (case-insensitive). A named group that is
 * missing or internal is an error, so a typo never silently skips testers.
 */
export function pickExternalGroups(groups, names = []) {
  const external = groups.filter((g) => !g.attributes?.isInternalGroup);
  if (!names.length) return external;
  return names.map((name) => {
    const match = groups.find((g) => (g.attributes?.name || "").toLowerCase() === name.toLowerCase());
    if (!match) throw new Error(`No TestFlight group named "${name}"`);
    if (match.attributes?.isInternalGroup) {
      throw new Error(`"${name}" is an internal group; internal testers get every build already`);
    }
    return match;
  });
}

// externalBuildState values (App Store Connect buildBetaDetails) that mean
// the build can never reach external testers as it is.
const BLOCKED = {
  MISSING_EXPORT_COMPLIANCE: "export compliance is missing; answer it in App Store Connect",
  PROCESSING_EXCEPTION: "Apple could not process the build",
  BETA_REJECTED: "beta review rejected this build",
  EXPIRED: "the build has expired",
};

/**
 * What still has to happen for external testers to get the build.
 *
 * Returns `{ wait: reason }` while Apple is still processing, `{ blocked:
 * reason }` when it cannot go external, else `{ steps }`, in order:
 * "whatToTest" (the tester-facing notes external review needs),
 * "addToGroup" per group still missing it, "submitForReview" when the build
 * has never been sent to beta review, "notifyTesters" when an approved build
 * was never distributed because auto-notify was off, and "enableAutoNotify"
 * when the build's "Automatically notify testers" is off (otherwise an
 * approved build waits for a manual distribution). Empty `steps` means done.
 */
export function distributionSteps({
  processingState,
  externalBuildState,
  hasWhatToTest,
  groupIds,
  groupIdsWithBuild,
  autoNotifyEnabled,
}) {
  if (processingState === "PROCESSING" || !processingState) return { wait: "Apple is still processing the build" };
  if (processingState !== "VALID") return { blocked: `build processing ended ${processingState}` };
  if (externalBuildState === "PROCESSING") return { wait: "Apple is still preparing the build for testing" };
  if (BLOCKED[externalBuildState]) return { blocked: BLOCKED[externalBuildState] };
  const have = new Set(groupIdsWithBuild);
  const steps = [];
  const manual = autoNotifyEnabled === false;
  if (!hasWhatToTest) steps.push({ step: "whatToTest" });
  const missing = groupIds.filter((id) => !have.has(id));
  for (const id of missing) steps.push({ step: "addToGroup", groupId: id });
  if (externalBuildState === "READY_FOR_BETA_SUBMISSION") steps.push({ step: "submitForReview" });
  // Turning auto-notify on after approval does not notify anyone by itself.
  const approved = externalBuildState === "BETA_APPROVED" || externalBuildState === "IN_BETA_TESTING";
  if (manual && approved && (externalBuildState === "BETA_APPROVED" || missing.length)) {
    steps.push({ step: "notifyTesters" });
  }
  // Last, so a failed notification above stays retryable: a re-run still
  // sees auto-notify off and schedules it again.
  if (manual) steps.push({ step: "enableAutoNotify" });
  return { steps };
}

/** Default tester-facing "What to Test" text when none is given. */
export function defaultWhatToTest(version) {
  return `Build ${version}: the latest Tres Fort beta. To report a problem, take a screenshot in the app and send it as TestFlight feedback.`;
}
