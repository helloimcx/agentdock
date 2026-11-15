import test from 'node:test';
import assert from 'node:assert/strict';
import type { ButlerBotEndpoint, ButlerProfile, WorkspaceSummary } from '@cc/superai-contracts';
import { applyButlerReload, type ButlerReloadParts } from './butler-page-model';

const profile = { threadId: 'thread:ws-butler::4f8d3a20-1c6b-4e7f-9a2d-8e5f1b7c6d90' } as ButlerProfile | null;
const workspaces = { workspaces: [{ id: 'workspace-butler-primary', name: 'workspace-butler-primary' }] } as { workspaces: WorkspaceSummary[] };
const bots = { bots: [{ id: 'bot-lark-manager-01', connected: true }] } as { bots: ButlerBotEndpoint[] };

type ProfilePart = PromiseSettledResult<ButlerProfile | null>;
type WorkspacesPart = PromiseSettledResult<{ workspaces: WorkspaceSummary[] }>;
type BotsPart = PromiseSettledResult<{ bots: ButlerBotEndpoint[] }>;

function fulfilled<T>(value: T): PromiseSettledResult<T> {
  return { status: 'fulfilled', value };
}

function rejected<T>(reason: unknown): PromiseSettledResult<T> {
  return { status: 'rejected', reason };
}

function parts(overrides: { profile?: ProfilePart; workspaces?: WorkspacesPart; bots?: BotsPart } = {}): ButlerReloadParts {
  return [
    overrides.profile ?? fulfilled(profile),
    overrides.workspaces ?? fulfilled(workspaces),
    overrides.bots ?? fulfilled(bots),
  ];
}

test('applyButlerReload keeps every part when all reloads succeed', () => {
  const outcome = applyButlerReload(parts());
  assert.equal(outcome.profile, profile);
  assert.deepEqual(outcome.workspaces, workspaces.workspaces);
  assert.deepEqual(outcome.bots, bots.bots);
  assert.equal(outcome.failure, '');
});

test('applyButlerReload keeps profile and bots when workspace discovery fails', () => {
  const outcome = applyButlerReload(parts({
    workspaces: rejected(new Error('Workspace "workspace-butler-orphan" references missing provider "provider-deepseek-ghost".')),
  }));
  assert.equal(outcome.profile, profile);
  assert.deepEqual(outcome.bots, bots.bots);
  assert.deepEqual(outcome.workspaces, [], 'failed workspace part must fall back to an empty list');
  assert.match(outcome.failure, /workspace-butler-orphan/);
  assert.match(outcome.failure, /provider-deepseek-ghost/);
});

test('applyButlerReload blanks the profile when the profile reload fails', () => {
  const outcome = applyButlerReload(parts({ profile: rejected(new Error('butler profile unavailable')) }));
  assert.equal(outcome.profile, null);
  assert.deepEqual(outcome.workspaces, workspaces.workspaces);
  assert.equal(outcome.failure, 'butler profile unavailable');
});

test('applyButlerReload joins every failure message and tolerates non-Error reasons', () => {
  const outcome = applyButlerReload(parts({
    profile: rejected(new Error('profile failed')),
    workspaces: rejected('plain string workspace failure'),
  }));
  assert.deepEqual(outcome.bots, bots.bots);
  assert.equal(outcome.failure, 'profile failed; plain string workspace failure');
});
