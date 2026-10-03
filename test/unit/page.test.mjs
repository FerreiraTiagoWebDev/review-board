import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, escapeJsonForScript, fillSkeleton } from '../../skills/review-board/scripts/lib/page.mjs';

const SKELETON = '<html><head><title>Review board</title></head><body><script id="review-data" type="application/json">{}</script></body></html>';

describe('fillSkeleton', () => {
  test('replaces the data and the title', () => {
    const html = fillSkeleton(SKELETON, { meta: { title: 'PR #1' } });
    assert.match(html, /<title>PR #1<\/title>/);
    assert.match(html, /<script id="review-data" type="application\/json">\{"meta":\{"title":"PR #1"\}\}<\/script>/);
  });

  test('a hostile title can neither break the markup nor inject replacement patterns', () => {
    const title = `</title><script>alert(1)</script> $& $1 "q" & 'a'`;
    const html = fillSkeleton(SKELETON, { meta: { title } });
    assert.ok(html.includes(`<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1 &quot;q&quot; &amp; &#39;a&#39;</title>`));
    assert.equal(html.match(/<script/g)?.length, 1);
  });

  test('data containing </script> or <!-- stays inside the data element', () => {
    const data = { meta: { title: 't' }, patch: '</script><script>alert(1)</script><!--' };
    const html = fillSkeleton(SKELETON, data);
    assert.equal(html.match(/<\/script>/g)?.length, 1);
    const json = /type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    assert.deepEqual(JSON.parse(json), data);
  });

  test('fails loudly when the placeholder is missing', () => {
    assert.throws(() => fillSkeleton('<html></html>', { meta: { title: 't' } }), /placeholder/);
  });
});

describe('escaping helpers', () => {
  test('escapeHtml covers the five significant characters', () => {
    assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  test('escapeJsonForScript round-trips', () => {
    const value = { a: '<b>', c: [' ', '</SCRIPT>'] };
    assert.deepEqual(JSON.parse(escapeJsonForScript(value)), value);
    assert.equal(escapeJsonForScript(value).includes('<'), false);
  });
});
