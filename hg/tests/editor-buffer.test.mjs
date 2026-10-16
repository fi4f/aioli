import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Compiler } from '../compiler.js';
import { Bindings } from '../bindings.js';
import { Forms } from '../forms.js';
import { Data } from '../data.js';

const source = readFileSync(new URL('../../editor/buffer.lisp', import.meta.url), 'utf8');

for (const trace of [true, false]) {
  test(`a completed save preserves newer edits and undoing to the saved text becomes clean (trace=${trace})`, () => {
    const module = Compiler.run(Compiler.compileModule(source, Bindings, Forms, { trace }));
    const Buffer = Data.get(module, 'Buffer');
    const call = (name, ...args) => Data.get(Buffer, name)(...args);
    const buffer = call('new', '/project/main.lisp', 'original', 1);
    buffer.source = 'first edit'; buffer.version++;
    call('changed', buffer);
    const version = buffer.version;
    buffer.source = 'newer edit'; buffer.version++;
    call('changed', buffer);
    call('saved', buffer, 'first edit', 2, version);
    assert.equal(buffer.source, 'newer edit');
    assert.equal(buffer['saved-source'], 'first edit');
    assert.deepEqual([buffer.dirty, buffer.pending, buffer.status], [true, true, 'Unsaved']);
    buffer.source = 'first edit'; buffer.version++;
    call('changed', buffer);
    assert.deepEqual([buffer.dirty, buffer.pending, buffer.status], [false, false, 'Saved']);
    buffer.source = 'newer edit'; buffer.version++;
    call('changed', buffer);
    call('saved', buffer, buffer.source, 3, buffer.version);
    assert.deepEqual([buffer.dirty, buffer.pending, buffer['file-revision']], [false, false, 3]);
  });
}
