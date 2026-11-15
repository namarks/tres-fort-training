export interface BetaGroup {
  id: string;
  attributes?: { name?: string; isInternalGroup?: boolean; [key: string]: unknown };
}

export type DistributionStep =
  | { step: 'enableAutoNotify' }
  | { step: 'notifyTesters' }
  | { step: 'whatToTest' }
  | { step: 'addToGroup'; groupId: string }
  | { step: 'submitForReview' };

export function pickExternalGroups(groups: BetaGroup[], names?: string[]): BetaGroup[];
export function distributionSteps(input: {
  processingState: string | null | undefined;
  externalBuildState: string | null | undefined;
  hasWhatToTest: boolean;
  groupIds: string[];
  groupIdsWithBuild: string[];
  autoNotifyEnabled?: boolean | null;
}): { wait: string } | { blocked: string } | { steps: DistributionStep[] };
export function defaultWhatToTest(version: string): string;
