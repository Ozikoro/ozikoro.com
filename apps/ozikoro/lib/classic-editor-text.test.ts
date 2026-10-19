import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseArchiveHtml } from '@ozikoro/platform';
import { READ_MORE_TAG } from './classic-editor-content.ts';
import { QUICKTAGS, applyQuickTag, quickTagById, wordpressDatetime } from './classic-editor-text.ts';

test('the Text tab has WordPress QuickTags in their default order', () => {
  assert.deepEqual(
    QUICKTAGS.map((tag) => tag.id),
    ['b', 'i', 'link', 'b-quote', 'del', 'ins', 'img', 'ul', 'ol', 'li', 'code', 'more', 'close']
  );
});

test('the tag strings are WordPress core defaults', () => {
  const tag = (id: string) => {
    const found = quickTagById(id);
    assert.ok(found, `missing QuickTag ${id}`);
    return found;
  };

  assert.equal(tag('b').open, '<strong>');
  assert.equal(tag('b').close, '</strong>');
  assert.equal(tag('i').open, '<em>');
  assert.equal(tag('i').close, '</em>');
  assert.equal(tag('b-quote').open, '\n\n<blockquote>');
  assert.equal(tag('b-quote').close, '</blockquote>\n\n');
  assert.equal(tag('del').open, '<del datetime="{datetime}">');
  assert.equal(tag('ins').open, '<ins datetime="{datetime}">');
  assert.equal(tag('ul').open, '<ul>\n');
  assert.equal(tag('ul').close, '</ul>\n\n');
  assert.equal(tag('ol').open, '<ol>\n');
  assert.equal(tag('ol').close, '</ol>\n\n');
  assert.equal(tag('li').open, '\t<li>');
  assert.equal(tag('li').close, '</li>\n');
  assert.equal(tag('link').prompt?.message, 'Enter the URL');
  assert.equal(tag('link').prompt?.initial, 'http://');
  assert.equal(tag('img').prompt?.message, 'Enter the URL of the image');
  assert.equal(tag('img').prompt?.initial, 'http://');
  assert.equal(tag('img').prompt?.altMessage, 'Enter the description of the image');
});

test('WordPress stamps del and ins with a UTC date and a numerical zero offset', () => {
  assert.equal(wordpressDatetime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02T03:04:05+00:00');
});

test('bold wraps the selected text and leaves the caret after it', () => {
  const bold = quickTagById('b');
  assert.ok(bold);
  const result = applyQuickTag('one two three', 4, 7, bold);
  assert.deepEqual(result, {
    value: 'one <strong>two</strong> three',
    selectionStart: 'one <strong>two</strong>'.length,
    selectionEnd: 'one <strong>two</strong>'.length,
    openTags: [],
  });
});

test('a first click opens the tag, and a second click closes it', () => {
  const italic = quickTagById('i');
  assert.ok(italic);
  const opened = applyQuickTag('<p>ab</p>', 4, 4, italic);
  assert.deepEqual(opened, {
    value: '<p>a<em>b</p>',
    selectionStart: '<p>a<em>'.length,
    selectionEnd: '<p>a<em>'.length,
    openTags: ['i'],
  });

  const closed = applyQuickTag(opened.value, opened.selectionStart, opened.selectionEnd, italic, {
    openTags: opened.openTags,
  });
  assert.deepEqual(closed, {
    value: '<p>a<em></em>b</p>',
    selectionStart: '<p>a<em></em>'.length,
    selectionEnd: '<p>a<em></em>'.length,
    openTags: [],
  });
});

test('a selected range loses one trailing newline before it is wrapped', () => {
  const bold = quickTagById('b');
  assert.ok(bold);
  const result = applyQuickTag('one\ntwo\nthree', 3, 8, bold);
  assert.equal(result.value, 'one<strong>\ntwo</strong>\nthree');
  assert.equal(result.selectionStart, 3 + '<strong>'.length + '\ntwo'.length + '</strong>'.length);
});

test('link opens an empty anchor and the second click closes it', () => {
  const link = quickTagById('link');
  assert.ok(link);
  const opened = applyQuickTag('Read this: ', 11, 11, link, { url: 'https://ozikoro.com/archive/' });
  assert.deepEqual(opened, {
    value: 'Read this: <a href="https://ozikoro.com/archive/">',
    selectionStart: 'Read this: <a href="https://ozikoro.com/archive/">'.length,
    selectionEnd: 'Read this: <a href="https://ozikoro.com/archive/">'.length,
    openTags: ['link'],
  });

  const closed = applyQuickTag(opened.value, opened.selectionStart, opened.selectionEnd, link, {
    openTags: opened.openTags,
  });
  assert.equal(closed.value, 'Read this: <a href="https://ozikoro.com/archive/"></a>');
  assert.deepEqual(closed.openTags, []);
});

test('link keeps the selected words as the anchor text', () => {
  const link = quickTagById('link');
  assert.ok(link);
  const result = applyQuickTag('<p>the archive</p>', 3, 14, link, { url: 'https://ozikoro.com/' });
  assert.equal(result.value, '<p><a href="https://ozikoro.com/">the archive</a></p>');
  assert.deepEqual(result.openTags, []);
});

test('image insertion escapes the address and alternative text', () => {
  const image = quickTagById('img');
  assert.ok(image);
  const result = applyQuickTag('', 0, 0, image, {
    url: '/media/a.jpg?x=1&y="2"',
    alt: 'A "quoted" <caption>',
  });
  assert.equal(
    result.value,
    '<img src="/media/a.jpg?x=1&amp;y=&quot;2&quot;" alt="A &quot;quoted&quot; &lt;caption&gt;" />'
  );
});

test('image is inserted after a selected range, not over it', () => {
  const image = quickTagById('img');
  assert.ok(image);
  const result = applyQuickTag('before after', 0, 6, image, { url: '/media/a.jpg', alt: '' });
  assert.equal(result.value, 'before<img src="/media/a.jpg" alt="" /> after');
  assert.deepEqual(result.openTags, []);
});

test('list tags open and close with WordPress line breaks and the list-item tab', () => {
  const ul = quickTagById('ul');
  const li = quickTagById('li');
  assert.ok(ul && li);

  const openedList = applyQuickTag('', 0, 0, ul);
  assert.deepEqual(openedList, {
    value: '<ul>\n',
    selectionStart: '<ul>\n'.length,
    selectionEnd: '<ul>\n'.length,
    openTags: ['ul'],
  });
  const closedList = applyQuickTag(openedList.value, openedList.selectionStart, openedList.selectionEnd, ul, {
    openTags: openedList.openTags,
  });
  assert.equal(closedList.value, '<ul>\n</ul>\n\n');

  const openedItem = applyQuickTag('', 0, 0, li);
  assert.deepEqual(openedItem, {
    value: '\t<li>',
    selectionStart: '\t<li>'.length,
    selectionEnd: '\t<li>'.length,
    openTags: ['li'],
  });
  const closedItem = applyQuickTag(openedItem.value, openedItem.selectionStart, openedItem.selectionEnd, li, {
    openTags: openedItem.openTags,
  });
  assert.equal(closedItem.value, '\t<li></li>\n');
});

test('more writes the exact tag and its two trailing newlines', () => {
  const more = quickTagById('more');
  assert.ok(more);
  const result = applyQuickTag('<p>before</p><p>after</p>', 13, 13, more);
  assert.equal(result.value, `<p>before</p>${READ_MORE_TAG}\n\n<p>after</p>`);
  assert.equal(result.selectionStart, 13 + READ_MORE_TAG.length + 2);
});

test('more is inserted after a selection, as WordPress does with a tag that has no end tag', () => {
  const more = quickTagById('more');
  assert.ok(more);
  const result = applyQuickTag('before after', 0, 6, more);
  assert.equal(result.value, `before${READ_MORE_TAG}\n\n after`);
});

test('close unwinds every open tag in last-in-first-out order', () => {
  const bold = quickTagById('b');
  const italic = quickTagById('i');
  const close = quickTagById('close');
  assert.ok(bold && italic && close);

  const openedBold = applyQuickTag('ab', 1, 1, bold);
  const openedItalic = applyQuickTag(openedBold.value, openedBold.selectionStart, openedBold.selectionEnd, italic, {
    openTags: openedBold.openTags,
  });
  assert.deepEqual(openedItalic.openTags, ['b', 'i']);

  const closed = applyQuickTag(openedItalic.value, openedItalic.selectionStart, openedItalic.selectionEnd, close, {
    openTags: openedItalic.openTags,
  });
  assert.equal(closed.value, 'a<strong><em></em></strong>b');
  assert.deepEqual(closed.openTags, []);
});

test('close inserts each closing tag in the reverse order of opening', () => {
  const link = quickTagById('link');
  const bold = quickTagById('b');
  const close = quickTagById('close');
  assert.ok(link && bold && close);

  const openedLink = applyQuickTag('', 0, 0, link, { url: 'https://ozikoro.com/' });
  const openedBold = applyQuickTag(openedLink.value, openedLink.selectionStart, openedLink.selectionEnd, bold, {
    openTags: openedLink.openTags,
  });
  const closed = applyQuickTag(openedBold.value, openedBold.selectionStart, openedBold.selectionEnd, close, {
    openTags: openedBold.openTags,
  });
  assert.equal(closed.value, '<a href="https://ozikoro.com/"><strong></strong></a>');
});

test('a missing prompt answer leaves the document and selection alone', () => {
  const link = quickTagById('link');
  assert.ok(link);
  assert.deepEqual(applyQuickTag('abc', 1, 2, link, { url: '' }), {
    value: 'abc',
    selectionStart: 1,
    selectionEnd: 2,
    openTags: [],
  });
});

test('out-of-range selections are clamped instead of splitting a string at a bad index', () => {
  const bold = quickTagById('b');
  assert.ok(bold);
  const result = applyQuickTag('abc', -10, 99, bold);
  assert.equal(result.value, '<strong>abc</strong>');
  assert.equal(result.selectionStart, '<strong>abc</strong>'.length);
});

test('del and ins carry a datetime that the archive keeps', () => {
  const del = quickTagById('del');
  const ins = quickTagById('ins');
  assert.ok(del && ins);
  const datetime = '2026-10-18T12:34:56+00:00';
  const deleted = applyQuickTag('old', 0, 3, del, { datetime });
  const inserted = applyQuickTag('new', 0, 3, ins, { datetime });
  const html = sanitiseArchiveHtml(`<p>${deleted.value} ${inserted.value}</p>`);
  assert.ok(html.includes(`<del datetime="${datetime}">old</del>`), html);
  assert.ok(html.includes(`<ins datetime="${datetime}">new</ins>`), html);
});

test('every QuickTag writes markup the archive keeps', () => {
  for (const tag of QUICKTAGS) {
    if (tag.kind === 'link' || tag.kind === 'image' || tag.kind === 'close') continue;
    const sample = tag.kind === 'more' ? 'before<br>after' : 'before selected after';
    const start = tag.kind === 'more' ? 6 : 7;
    const end = tag.kind === 'more' ? 6 : 15;
    const result = applyQuickTag(sample, start, end, tag, {
      datetime: '2026-10-18T12:34:56+00:00',
    });
    const kept = sanitiseArchiveHtml(result.value);
    for (const token of [tag.open?.match(/^<([a-z0-9]+)/i)?.[1], tag.open?.match(/<([a-z0-9]+)/i)?.[1]]) {
      if (!token) continue;
      assert.ok(kept.includes(`<${token}`), `${tag.id} writes <${token}>, which the sanitiser removes`);
    }
    if (tag.kind === 'more') assert.ok(kept.includes(READ_MORE_TAG));
  }
});
