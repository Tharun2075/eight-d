// Pure 5-Why scaffold: a chain of five "why" levels, prefilled with candidate answers taken
// from similar past root causes. A human picks or edits every level; nothing is chosen for them.

export const WHY_LEVELS = 5;

// Past root causes are stored as "1. ... \n 2. ..." chains; split them back into levels.
export function splitChain(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(why\s*)?\d+[.):-]\s*/i, '').trim())
    .filter(Boolean);
}

// past: [{ key, rootCause }] from findSimilarNonconformances.
export function scaffoldFiveWhy(problem, past = []) {
  const levels = [];
  for (let i = 0; i < WHY_LEVELS; i += 1) {
    const seen = new Set();
    const candidates = [];
    for (const p of past) {
      const text = splitChain(p.rootCause)[i];
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        candidates.push({ text, source: p.key });
      }
    }
    levels.push({ level: i + 1, question: i === 0 ? `Why did this happen: ${problem || 'unknown problem'}?` : `Why ${i + 1}?`, candidates, picked: null });
  }
  return { problem: problem || 'unknown', levels, status: 'draft', note: 'Draft only. Pick or write each answer, then press Approve on D4.' };
}

// The human's picks: { level: text }. Returns a new scaffold; unknown levels are ignored.
export function pickWhy(scaffold, level, text) {
  if (!scaffold.levels.some((l) => l.level === level)) throw new Error(`Unknown level ${level}`);
  return { ...scaffold, levels: scaffold.levels.map((l) => (l.level === level ? { ...l, picked: String(text ?? '').trim() || null } : l)) };
}

// Text for the D4 fiveWhys field. Unpicked levels stay visible as gaps for the reviewer.
export function formatFiveWhy(scaffold) {
  return scaffold.levels.map((l) => `${l.level}. ${l.picked ?? '(not answered yet)'}`).join('\n');
}
