export interface FeedbackScreenshot {
  url: string;
  expirationDate: string | null;
}

export interface FeedbackSummary {
  id: string;
  kind: 'screenshot' | 'crash';
  createdDate: string | null;
  comment: string;
  build: string | null;
  tester: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  locale: string | null;
  timeZone: string | null;
  batteryPercentage: number | null;
  appUptimeInMilliseconds: number | null;
  connectionType: string | null;
  screenshots: FeedbackScreenshot[];
}

export function summarizeSubmission(
  kind: 'screenshot' | 'crash',
  sub: { id: string; attributes?: Record<string, any>; relationships?: Record<string, any> },
  buildsById: Map<string, { version?: string }>,
  testersById: Map<string, { firstName?: string; lastName?: string; email?: string }>,
): FeedbackSummary;
export function screenshotUrl(s: Record<string, any> | null | undefined): string | null;
export function isOnOrAfter(createdDate: string | null | undefined, cutoffMs: number): boolean;
export function submissionFolderName(summary: Pick<FeedbackSummary, 'id' | 'kind' | 'createdDate'>): string;
export function screenshotFileName(index: number, url: string | null | undefined): string;
export function summaryLine(s: FeedbackSummary): string;
export function feedbackMarkdown(s: FeedbackSummary, files?: string[]): string;
