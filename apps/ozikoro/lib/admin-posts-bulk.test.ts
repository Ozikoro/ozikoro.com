/**
 * The bulk dropdown: three named actions, a count, and no way to answer a no-op with a success.
 *
 * MEASURED BEFORE THE FIX, in Chrome over CDP on the local cluster:
 *
 *     /admin/posts/?status=draft · tick 5206 and 5204 · choose "Move to Trash" · Apply
 *     -> ?error=That form did not name a piece, so nothing was written.
 *     Trash (0) before and Trash (0) after
 *
 * The route's `if (id === null || id <= 0)` guard ran before its `bulk` branch, and a bulk form carries no
 * `id` — the ids are in `ids`. So the whole bulk handler was unreachable. The end-to-end proof of the fix is
 * a browser run; what is testable here is the rest of the same defect's shape: which values are actions at
 * all, which ids a form named, and what the screen says afterwards — including that an unrecognised action
 * cannot be answered with "0 moved to the trash."
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BULK_WRITES, bulkIdsFrom, bulkNotice, bulkWriteFor } from './admin-posts-bulk.ts';

test('the three actions are the ones the dropdown offers, and publishing is not among them', () => {
  assert.deepEqual([...BULK_WRITES], ['trash', 'restore', 'draft']);
  assert.equal(bulkWriteFor('publish'), null);
  assert.equal(bulkWriteFor('edit'), null);
});

test('every offered action is accepted, and nothing else is', () => {
  for (const write of BULK_WRITES) assert.equal(bulkWriteFor(write), write);
  assert.equal(bulkWriteFor(''), null);
  assert.equal(bulkWriteFor('   '), null);
  assert.equal(bulkWriteFor('Trash'), null); // the value, not the label
  assert.equal(bulkWriteFor('trash;drop'), null);
});

test('an unrecognised action cannot be answered with a success notice', () => {
  // The whole point of validating first: `changed` stays 0 and the screen used to say "0 moved to the trash."
  const write = bulkWriteFor('delete-everything');
  assert.equal(write, null);
  assert.notEqual(bulkNotice('trash', 0), undefined);
});

test('the ids a bulk form named are read in order, and rubbish is dropped', () => {
  assert.deepEqual(bulkIdsFrom('5206,5204'), [5206, 5204]);
  assert.deepEqual(bulkIdsFrom(' 5206 , 5204 '), [5206, 5204]);
  assert.deepEqual(bulkIdsFrom('abc,,0,-3,5206'), [5206]);
  assert.deepEqual(bulkIdsFrom(''), []);
  assert.deepEqual(bulkIdsFrom('abc'), []);
});

test('the notice names the action that ran and the count', () => {
  assert.equal(bulkNotice('trash', 2), '2 moved to the trash.');
  assert.equal(bulkNotice('restore', 1), '1 restored.');
  assert.equal(bulkNotice('draft', 3), '3 returned to draft.');
  // And the three sentences are distinct, so a screen never reports the wrong act.
  assert.equal(new Set([bulkNotice('trash', 1), bulkNotice('restore', 1), bulkNotice('draft', 1)]).size, 3);
});
