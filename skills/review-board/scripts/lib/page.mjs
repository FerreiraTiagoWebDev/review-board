const DATA_PLACEHOLDER = /(<script id="review-data" type="application\/json">)[\s\S]*?(<\/script>)/;
const TITLE = /<title>[\s\S]*?<\/title>/;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {string} text */
export const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[/** @type {keyof typeof HTML_ESCAPES} */ (char)]);

/** JSON that can sit inside a <script> element without closing it or opening a comment. */
export const escapeJsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * @param {string} skeleton
 * @param {{ meta: { title: string } }} data
 */
export function fillSkeleton(skeleton, data) {
  if (!DATA_PLACEHOLDER.test(skeleton)) throw new Error('skeleton has no <script id="review-data" type="application/json"> placeholder');
  return skeleton
    .replace(DATA_PLACEHOLDER, (_, open, close) => open + escapeJsonForScript(data) + close)
    .replace(TITLE, () => `<title>${escapeHtml(data.meta.title)}</title>`);
}
