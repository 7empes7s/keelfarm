import { describe, expect, it } from 'vitest';
import { demoPdf, demoPng } from './demoFiles.ts';

describe("the demo CEO's files", () => {
  it('makes a PDF and a PNG', () => {
    const pdf = demoPdf('Report', ['line (1)']).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(line \\(1\\)) Tj');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(demoPng([0.5], 10, 10).subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
