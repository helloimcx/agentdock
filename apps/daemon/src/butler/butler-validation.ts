import type { ButlerAssignmentInput, ButlerTaskCreateInput } from '@cc/superai-contracts';
import { ButlerError } from './butler-error.js';

export function validateTask(input: ButlerTaskCreateInput) {
  if (!requiredText(input.title) || !requiredText(input.requestId) || input.requestId.length > 200) throw new ButlerError('A title and requestId (maximum 200 characters) are required.');
  if (input.completionCriteria !== undefined && typeof input.completionCriteria !== 'string') throw new ButlerError('Completion criteria must be text.');
  if (!Array.isArray(input.assignments) || !input.assignments.length || input.assignments.length > 32) throw new ButlerError('Assign 1 to 32 managed bot tasks.');
  validateAssignments(input.assignments);
  validateGraph(input.assignments);
}

function validateAssignments(assignments: ButlerAssignmentInput[]) {
  const keys = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment || ![assignment.key, assignment.title, assignment.prompt, assignment.botId].every(requiredText)) throw new ButlerError('Each assignment needs a key, managed bot, title and prompt.');
    if (assignment.dependsOn !== undefined && !Array.isArray(assignment.dependsOn)) throw new ButlerError('Assignment dependencies must be an array of keys.');
    if (keys.has(assignment.key)) throw new ButlerError('Assignment keys must be unique.');
    keys.add(assignment.key);
  }
  for (const assignment of assignments) {
    if (assignment.dependsOn?.some((key) => !keys.has(key) || key === assignment.key)) throw new ButlerError('Invalid assignment dependency.');
  }
}

function requiredText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

function validateGraph(assignments: ButlerAssignmentInput[]) {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new ButlerError('Assignment dependencies contain a cycle.');
    visiting.add(key);
    for (const dependency of assignments.find((assignment) => assignment.key === key)!.dependsOn || []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const assignment of assignments) visit(assignment.key);
}
