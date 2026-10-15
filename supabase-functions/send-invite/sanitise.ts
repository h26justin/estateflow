// Display-name sanitising for the invitation email (send-invite).
//
// Company and inviter names are set by whoever signs up, so they are
// attacker-controlled. Before they reach an email they are reduced to one
// short line with no control characters, URLs or bare domains — so the
// subject line (and the body) cannot carry a phishing link or header-style
// line breaks. HTML escaping is applied separately where they enter the body.

// Subject-line text from an attacker-controllable name: one line, no control
// characters, no URLs / bare domains, collapsed whitespace, capped length.
export const subjectSafe = (s: unknown, fallback: string, max = 60): string => {
  const out = String(s ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, ' ')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const capped = out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out
  return capped || fallback
}

