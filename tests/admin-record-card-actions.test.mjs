import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shared = readFileSync(new URL('../admin/css/shared-ui.css', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../admin/js/admin-ui.js', import.meta.url), 'utf8');
const projects = readFileSync(new URL('../admin/js/projects.js', import.meta.url), 'utf8');

test('shared record selection owns and groups commands for every participating card', () => {
  assert.match(adminUi, /const directCommands = \[\.\.\.actions\.querySelectorAll\(":scope > button, :scope > a"\)\]/);
  assert.match(adminUi, /directCommands\.forEach\(\(command\) => commandGroup\.append\(command\)\)/);
  assert.match(projects, /actionSelector: "\.project-actions"/);
  assert.match(shared, /\[data-lan-record-card\] \[data-lan-record-actions\]:has\(>\.lan-record-command-group\)\{display:flex;[^}]*flex-wrap:wrap\}/);
});

test('narrow card footer retains select control and one shared flex command group, not a competing two-column grid', () => {
  const narrowStart = shared.indexOf('@container (max-width:24rem){.custom-module-entry-card');
  assert.ok(narrowStart >= 0, 'narrow card component rules must exist');
  const narrow = shared.slice(narrowStart, shared.indexOf('\n', narrowStart));
  assert.doesNotMatch(narrow, /\[data-lan-record-actions="true"\]:has\(>\.lan-record-command-group\)\{display:block/);
  assert.doesNotMatch(narrow, /\.lan-record-command-group\{display:grid;[^}]*grid-template-columns:repeat\(2/);
  assert.doesNotMatch(narrow, /\.lan-record-command-group>button[^}]*width:100%/);
  assert.match(shared, /\.lan-record-command-group\{display:flex;[^}]*flex-wrap:wrap\}/);
  assert.match(shared, /html:is\(\[data-lan-admin-mode="compact"\],\[data-lan-admin-mode="mobile"\]\) \.lan-record-command-group \.lan-record-command\[data-lan-record-action-kind\]/);
});

test('record card layout retains footer location in media and no-media card flows', () => {
  assert.match(shared, /\[data-lan-record-card="true"\]\[data-lan-record-flow="grid"\]\[data-lan-record-has-media="true"\]>\[data-lan-record-actions\]\{grid-row:4\}/);
  assert.match(shared, /\[data-lan-record-card="true"\]\[data-lan-record-flow="grid"\]\[data-lan-record-has-media="false"\]>\[data-lan-record-actions\]\{grid-row:3\}/);
  assert.match(shared, /\[data-lan-record-library="true"\]\[data-lan-view="list"\]>\[data-lan-record-card="true"\]>\[data-lan-record-actions="true"\]\{grid-column:2;grid-row:2\}/);
});
