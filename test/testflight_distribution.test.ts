import { describe, expect, it } from 'vitest';
import {
  defaultWhatToTest,
  distributionSteps,
  pickExternalGroups,
} from '../scripts/testflight-distribution.mjs';

// scripts/testflight-distribute.mjs gives each uploaded build to the external
// TestFlight groups; these decisions keep a re-run idempotent and stop it from
// acting on a build Apple has not finished processing.
const groups = [
  { id: 'int', attributes: { name: 'Internal', isInternalGroup: true } },
  { id: 'ext', attributes: { name: 'Friends', isInternalGroup: false } },
  { id: 'ext2', attributes: { name: 'Garmin testers', isInternalGroup: false } },
];
const ready = {
  processingState: 'VALID',
  externalBuildState: 'READY_FOR_BETA_SUBMISSION',
  hasWhatToTest: false,
  groupIds: ['ext'],
  groupIdsWithBuild: [],
};

describe('TestFlight external distribution', () => {
  it('defaults to every external group and never an internal one', () => {
    expect(pickExternalGroups(groups).map((g) => g.id)).toEqual(['ext', 'ext2']);
  });

  it('picks named groups exactly and rejects typos and internal groups', () => {
    expect(pickExternalGroups(groups, ['friends']).map((g) => g.id)).toEqual(['ext']);
    expect(() => pickExternalGroups(groups, ['Freinds'])).toThrow('No TestFlight group named "Freinds"');
    expect(() => pickExternalGroups(groups, ['Internal'])).toThrow('internal group');
  });

  it('plans notes, group and review for a fresh build', () => {
    expect(distributionSteps(ready)).toEqual({
      steps: [{ step: 'whatToTest' }, { step: 'addToGroup', groupId: 'ext' }, { step: 'submitForReview' }],
    });
  });

  it('does only what is missing on a re-run', () => {
    expect(
      distributionSteps({
        ...ready,
        hasWhatToTest: true,
        externalBuildState: 'WAITING_FOR_BETA_REVIEW',
        groupIdsWithBuild: ['ext'],
      }),
    ).toEqual({ steps: [] });
    expect(
      distributionSteps({ ...ready, hasWhatToTest: true, externalBuildState: 'BETA_APPROVED' }),
    ).toEqual({ steps: [{ step: 'addToGroup', groupId: 'ext' }] });
  });

  it('turns on auto-notify so an approved build is not left undistributed', () => {
    expect(distributionSteps({ ...ready, hasWhatToTest: true, autoNotifyEnabled: false })).toEqual({
      steps: [{ step: 'addToGroup', groupId: 'ext' }, { step: 'submitForReview' }, { step: 'enableAutoNotify' }],
    });
    expect(
      distributionSteps({
        ...ready,
        hasWhatToTest: true,
        autoNotifyEnabled: false,
        externalBuildState: 'BETA_APPROVED',
        groupIdsWithBuild: ['ext'],
      }),
    ).toEqual({ steps: [{ step: 'notifyTesters' }, { step: 'enableAutoNotify' }] });
    expect(
      distributionSteps({
        ...ready,
        hasWhatToTest: true,
        autoNotifyEnabled: false,
        externalBuildState: 'IN_BETA_TESTING',
        groupIdsWithBuild: ['ext'],
      }),
    ).toEqual({ steps: [{ step: 'enableAutoNotify' }] });
    expect(
      distributionSteps({ ...ready, hasWhatToTest: true, autoNotifyEnabled: true, groupIdsWithBuild: ['ext'] }),
    ).toEqual({ steps: [{ step: 'submitForReview' }] });
  });

  it('waits while Apple processes and stops on a build that cannot go external', () => {
    expect(distributionSteps({ ...ready, processingState: 'PROCESSING' })).toHaveProperty('wait');
    expect(distributionSteps({ ...ready, processingState: undefined })).toHaveProperty('wait');
    expect(distributionSteps({ ...ready, externalBuildState: 'PROCESSING' })).toHaveProperty('wait');
    expect(distributionSteps({ ...ready, processingState: 'INVALID' })).toEqual({
      blocked: 'build processing ended INVALID',
    });
    expect(distributionSteps({ ...ready, externalBuildState: 'MISSING_EXPORT_COMPLIANCE' })).toHaveProperty('blocked');
    expect(distributionSteps({ ...ready, externalBuildState: 'EXPIRED' })).toHaveProperty('blocked');
  });

  it('writes a short default What to Test note', () => {
    expect(defaultWhatToTest('82')).toContain('Build 82');
  });
});
