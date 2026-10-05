import test from 'node:test';
import assert from 'node:assert/strict';
import { navItemsWithoutGroup, sidebarNavGroups } from './sidebar-nav-model';

// Statically hidden registry entries (visible: () => false) never need a sidebar group.
const HIDDEN_NAV_IDS = new Set(['projects', 'sessions']);

// Every nav entry the registry contributes and does not statically hide must be
// reachable from the desktop sidebar, i.e. belong to exactly one nav group.
// Regression: 'costs' and 'skills' were registered but absent from every group,
// so the desktop sidebar hid them while the mobile bottom bar still showed them.
const REQUIRED_VISIBLE_NAV_IDS = [
  'dashboard',
  'chat',
  'workspace',
  'providers',
  'costs',
  'knowledge',
  'skills',
  'automations',
  'mesh',
  'system',
];

test('every visible nav entry belongs to exactly one sidebar group', () => {
  const ungrouped = navItemsWithoutGroup(REQUIRED_VISIBLE_NAV_IDS);
  assert.deepEqual(ungrouped, []);

  for (const id of REQUIRED_VISIBLE_NAV_IDS) {
    const groups = sidebarNavGroups.filter((group) => group.ids.includes(id));
    assert.equal(groups.length, 1, `nav id ${id} must belong to exactly one sidebar group`);
  }
});

test('group ids stay unique across groups', () => {
  const allIds = sidebarNavGroups.flatMap((group) => group.ids);
  assert.equal(new Set(allIds).size, allIds.length, 'a nav id may not appear in two groups');
});

test('automations is grouped by its own purpose, not under Knowledge', () => {
  const knowledgeGroup = sidebarNavGroups.find((group) => group.ids.includes('knowledge'));
  assert.ok(knowledgeGroup, 'knowledge entry must keep a group');
  assert.equal(knowledgeGroup!.ids.includes('automations'), false);

  const automationGroup = sidebarNavGroups.find((group) => group.ids.includes('automations'));
  assert.ok(automationGroup, 'automations entry must keep a group');
  assert.equal(automationGroup!.label, 'Automation');
});

test('costs and skills are reachable under their purpose-matched groups', () => {
  const coreGroup = sidebarNavGroups.find((group) => group.ids.includes('costs'));
  assert.equal(coreGroup?.label, 'Core');
  const knowledgeGroup = sidebarNavGroups.find((group) => group.ids.includes('skills'));
  assert.equal(knowledgeGroup?.label, 'Knowledge');
});
