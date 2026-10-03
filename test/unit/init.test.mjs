import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { IGNORE_LINES, withIgnoreBlock } from '../../skills/review-board/scripts/init.mjs';

const BLOCK = `# review-board: generated review pages stay local, the skeleton is shared\n${IGNORE_LINES.join('\n')}\n`;

describe('withIgnoreBlock', () => {
  test('empty file gets just the block', () => {
    assert.deepEqual(withIgnoreBlock(''), { content: BLOCK, missing: IGNORE_LINES });
  });

  test('keeps existing content and separates the block by one blank line', () => {
    assert.equal(withIgnoreBlock('node_modules/\n').content, `node_modules/\n\n${BLOCK}`);
    assert.equal(withIgnoreBlock('node_modules/').content, `node_modules/\n\n${BLOCK}`);
  });

  test('adds only the missing lines and is a no-op once complete', () => {
    const partial = withIgnoreBlock('reviews/*.html\r\n');
    assert.deepEqual(partial.missing, ['!reviews/skeleton.html', 'reviews/*.review.json']);
    assert.deepEqual(withIgnoreBlock(partial.content).missing, []);
  });
});
