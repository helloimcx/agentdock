import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScheduledJobExecutionMode,
  normalizeScheduledJobTriggerType,
  normalizeChannelPlatform,
  normalizePermissionResponse,
  normalizeAgentTaskStatus,
  normalizeRunStatus,
  normalizeScheduledJobRunStatus,
  normalizeAutomationMonitorConditionOperator,
  normalizeAutomationMonitorStatus,
  normalizeChannelContentPartType,
  normalizeApprovalRequestStatus,
  inferArtifactKind,
  getArtifactMimeType,
} from '../../packages/contracts/src/index.js';

test('scheduled job execution mode normalization accepts canonical aliases', () => {
  assert.equal(normalizeScheduledJobExecutionMode(undefined), 'same-thread');
  assert.equal(normalizeScheduledJobExecutionMode('same_thread'), 'same-thread');
  assert.equal(normalizeScheduledJobExecutionMode('SIDE THREAD'), 'side-thread');
});

test('scheduled job execution mode normalization rejects unsupported values', () => {
  assert.throws(
    () => normalizeScheduledJobExecutionMode('foreground'),
    /execution mode must be same-thread or side-thread/,
  );
});

test('scheduled job trigger type normalization accepts canonical aliases', () => {
  assert.equal(normalizeScheduledJobTriggerType(undefined), 'cron');
  assert.equal(normalizeScheduledJobTriggerType('CRON'), 'cron');
  assert.equal(normalizeScheduledJobTriggerType('one time'), 'once');
});

test('scheduled job trigger type normalization rejects unsupported values', () => {
  assert.throws(
    () => normalizeScheduledJobTriggerType('interval'),
    /trigger type must be cron or once/,
  );
});

test('channel platform normalization trims and lowercases platform ids', () => {
  assert.equal(normalizeChannelPlatform(' Lark '), 'lark');
  assert.equal(normalizeChannelPlatform('Weixin:Bot-A'), 'weixin:bot-a');
});

test('channel platform normalization rejects empty platform ids', () => {
  assert.throws(
    () => normalizeChannelPlatform(' '),
    /platform is required/,
  );
});

test('permission response normalization accepts button and text aliases', () => {
  assert.equal(normalizePermissionResponse('perm:allow_all'), 'allow all');
  assert.equal(normalizePermissionResponse('allow_once'), 'allow');
  assert.equal(normalizePermissionResponse('reject'), 'deny');
  assert.equal(normalizePermissionResponse('始终允许'), 'allow all');
});

test('agent task status normalization accepts canonical aliases', () => {
  assert.equal(normalizeAgentTaskStatus(undefined), 'created');
  assert.equal(normalizeAgentTaskStatus('waiting for user'), 'waiting_for_user');
  assert.equal(normalizeAgentTaskStatus('canceled'), 'cancelled');
});

test('agent task status normalization rejects unsupported values', () => {
  assert.throws(
    () => normalizeAgentTaskStatus('paused'),
    /Agent task status must be/,
  );
});

test('run status normalization accepts canonical aliases', () => {
  assert.equal(normalizeRunStatus(undefined), 'queued');
  assert.equal(normalizeRunStatus('awaiting input'), 'awaiting_input');
  assert.equal(normalizeRunStatus('canceled'), 'interrupted');
});

test('scheduled job run status normalization accepts canonical aliases', () => {
  assert.equal(normalizeScheduledJobRunStatus(undefined), 'queued');
  assert.equal(normalizeScheduledJobRunStatus('complete'), 'succeeded');
  assert.equal(normalizeScheduledJobRunStatus('cancelled'), 'skipped');
});

test('automation monitor status normalization accepts canonical aliases', () => {
  assert.equal(normalizeAutomationMonitorStatus(undefined), 'queued');
  assert.equal(normalizeAutomationMonitorStatus('completed'), 'succeeded');
  assert.equal(normalizeAutomationMonitorStatus('SKIPPED'), 'skipped');
});

test('automation monitor condition operator normalization rejects unsupported values', () => {
  assert.equal(normalizeAutomationMonitorConditionOperator('>='), '>=');
  assert.throws(
    () => normalizeAutomationMonitorConditionOperator('contains'),
    /condition operator must be/,
  );
});

test('channel content part type normalization accepts canonical aliases', () => {
  assert.equal(normalizeChannelContentPartType(' TEXT '), 'text');
  assert.equal(normalizeChannelContentPartType('permission-card'), 'permission_card');
});

test('channel content part type normalization rejects unsupported values', () => {
  assert.throws(
    () => normalizeChannelContentPartType('audio'),
    /Channel content part type must be/,
  );
});

test('approval request status normalization accepts canonical aliases', () => {
  assert.equal(normalizeApprovalRequestStatus(undefined), 'pending');
  assert.equal(normalizeApprovalRequestStatus('approve'), 'approved');
  assert.equal(normalizeApprovalRequestStatus('canceled'), 'cancelled');
});

test('inferArtifactKind correctly identifies file categories from extensions', () => {
  assert.equal(inferArtifactKind('architecture.html'), 'html');
  assert.equal(inferArtifactKind('report.md'), 'markdown');
  assert.equal(inferArtifactKind('diagram.svg'), 'image');
  assert.equal(inferArtifactKind('screenshot.png'), 'image');
  assert.equal(inferArtifactKind('changes.diff'), 'diff');
  assert.equal(inferArtifactKind('data.json'), 'file');
  assert.equal(inferArtifactKind('unknown_file'), 'file');
});

test('getArtifactMimeType returns standard mime types', () => {
  assert.equal(getArtifactMimeType('index.html'), 'text/html');
  assert.equal(getArtifactMimeType('readme.markdown'), 'text/markdown');
  assert.equal(getArtifactMimeType('logo.svg'), 'image/svg+xml');
  assert.equal(getArtifactMimeType('photo.jpg'), 'image/jpeg');
  assert.equal(getArtifactMimeType('patch.diff'), 'text/x-diff');
  assert.equal(getArtifactMimeType('blob.bin'), 'application/octet-stream');
});

