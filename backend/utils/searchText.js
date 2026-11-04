const normalizeSearchText = (value) => String(value || '').normalize('NFKC').toLowerCase();

const containsSearchText = (value, search) =>
  normalizeSearchText(value).includes(normalizeSearchText(search));

module.exports = { normalizeSearchText, containsSearchText };
