import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function loadPublicCapabilities(');
const end = app.indexOf('\nasync function initFirebase(', start);
assert.ok(start >= 0 && end > start, 'Canonical Public capabilities loader is required');
const actualOwner = app.slice(start, end);

function harness({ documents, danglingIds = [] }) {
  const calls = { queries: [], individualReads: [] };
  const firebase = {
    db: {},
    collection: (_db, name) => { assert.equal(name, 'skills'); return name; },
    where: (field, operation, value) => ({ field, operation, value }),
    query: (_collection, ...filters) => filters,
    getDocs: async (filters) => {
      calls.queries.push(filters);
      const type = filters[0]?.field === 'active' ? 'legacy' : 'published';
      return { docs: documents[type].map(({ id, data }) => ({ id, data: () => data })) };
    },
    getDoc: async (ref) => {
      calls.individualReads.push(ref);
      return { exists: () => false };
    },
    doc: (_db, name, id) => ({ name, id })
  };
  // Only the already-authorized, published/legacy query results may enter the
  // public capability indexes. Dangling references must not trigger an
  // additional per-record Firestore read, including attempts against drafts.
  const make = new Function(
    'firebase', 'looseList', 'projectToolIds', 'projectPublicTagRefs',
    'linkedSourceForProject', 'cleanText',
    'let publicSkillsById, publicToolsById;\n' + actualOwner +
      '\nreturn { loadPublicCapabilities, indexes: () => ({ skills: publicSkillsById, tools: publicToolsById }) };'
  );
  const impl = make(
    firebase,
    value => Array.isArray(value) ? value : [],
    () => [],
    () => [],
    () => ({}),
    value => String(value ?? '').trim()
  );
  const projects = [{ skillIds: ['published-skill', ...danglingIds], toolIds: ['legacy-tool'] }];
  return { ...impl, projects, calls };
}

test('Public capability loading reads the approved query sets once, not one Firestore document per dangling ID', async () => {
  const documents = {
    published: [
      { id: 'published-skill', data: { name: 'Published', status: 'published', visible: true, recordType: 'skill' } },
      { id: 'overlap-tool', data: { name: 'Overlap', status: 'published', visible: true, active: true, recordType: 'tool' } }
    ],
    legacy: [
      { id: 'legacy-tool', data: { name: 'Legacy', active: true, recordType: 'tool' } },
      { id: 'overlap-tool', data: { name: 'Overlap', status: 'published', visible: true, active: true, recordType: 'tool' } }
    ]
  };
  const danglingIds = Array.from({ length: 60 }, (_, i) => 'deleted-skill-' + i);
  const ctx = harness({ documents, danglingIds });
  await ctx.loadPublicCapabilities(ctx.projects);

  assert.equal(ctx.calls.queries.length, 2, 'Preserve canonical published and legacy active query semantics');
  assert.equal(ctx.calls.individualReads.length, 0, 'No extra per-document reads for deleted/draft references');
  const indexes = ctx.indexes();
  assert.deepEqual([...indexes.skills.keys()], ['published-skill']);
  assert.deepEqual([...indexes.tools.keys()].sort(), ['legacy-tool', 'overlap-tool']);
  assert.equal(indexes.skills.has('deleted-skill-0'), false);
});

test('No private/hidden skills leak into public indexes when present in a query result', async () => {
  const ctx = harness({
    documents: {
      published: [
        { id: 'private', data: { name: 'Private', status: 'draft', visible: false, active: false, recordType: 'skill' } },
        { id: 'visible', data: { name: 'Visible', status: 'published', visible: true, recordType: 'skill' } }
      ],
      legacy: []
    }
  });
  await ctx.loadPublicCapabilities(ctx.projects);
  assert.equal(ctx.indexes().skills.has('private'), false);
  assert.equal(ctx.indexes().skills.has('visible'), true);
});
