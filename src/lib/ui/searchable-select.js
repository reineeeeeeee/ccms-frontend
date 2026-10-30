// Matching for the searchable dropdown, as a pure function so it can be tested directly.

/** The options whose text contains what was typed (case-insensitive). Each option's `search` text is used, else its label and secondary line. */
export function filterOptions(options, query) {
  const text = String(query ?? '').trim().toLowerCase();
  if (!text) return options;
  return options.filter((o) => (o.search ?? `${o.label} ${o.secondary ?? ''}`).toLowerCase().includes(text));
}
