// Display-name sanitising for the invitation email (send-invite).
//
// Company and inviter names are set by whoever signs up, so they are
// attacker-controlled. Before they reach an email they are reduced to one
// short line with no control characters, URLs or bare domains — so the
// subject line (and the body) cannot carry a phishing link or header-style
// line breaks. HTML escaping is applied separately where they enter the body.

// Subject-line text from an attacker-controllable name: one line, no control
// characters, no URLs / bare domains, collapsed whitespace, capped length.
// Control characters (C0, DEL, C1) and the Unicode line / paragraph
// separators become spaces. Done by code point rather than a regex of
// backslash-u escapes: the deploy tooling turns those into the literal
// characters, and a literal U+2028 inside a regex is a syntax error.
const isControl = (n: number) => n < 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029
const stripControl = (t: string) => Array.from(t, c => (isControl(c.charCodeAt(0)) ? ' ' : c)).join('')

export const subjectSafe = (s: unknown, fallback: string, max = 60): string => {
  const out = stripControl(String(s ?? ''))
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, ' ')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const capped = out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out
  return capped || fallback
}
