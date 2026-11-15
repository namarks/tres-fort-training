import { describe, expect, it } from 'vitest';
import { isMethodSection, METHOD_SECTIONS, methodologyHref } from '../src/MethodologyPage';

describe('methodology links', () => {
  it('opens the page or one of its sections, and knows its sections', () => {
    expect(methodologyHref()).toBe('#analysis/methodology');
    expect(methodologyHref('load')).toBe('#analysis/methodology/load');
    expect(METHOD_SECTIONS.map((s) => s.id)).toContain('fitness');
    expect(isMethodSection('records')).toBe(true);
    expect(isMethodSection('nope')).toBe(false);
    expect(isMethodSection(null)).toBe(false);
  });
});
