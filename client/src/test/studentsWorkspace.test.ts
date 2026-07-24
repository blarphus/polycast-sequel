import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/pages/Students.tsx'), 'utf8');

describe('teacher student workspace', () => {
  it('keeps the selected-student overview and full dashboard path on the roster page', () => {
    expect(source).toContain('className="students-workspace"');
    expect(source).toContain('api.getStudentStats(activeClassroomId, selectedStudentId)');
    expect(source).toContain('cards due today');
    expect(source).toContain('Open full dashboard');
    expect(source).toContain('Recent activity');
    expect(source).toContain('Search students…');
  });
});
