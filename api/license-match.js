// Brainchild's own license matcher, used when GitHub or GitLab doesn't name the license
// (GitHub says NOASSERTION or "other"), or finds no license file at all.
//
// It looks for the full standard text of a supported license inside the LICENSE file. If the file is
// that text alone (give or take the title, the copyright lines and the usual "how to apply" appendix),
// the license is that one. If there's wording around it, the wording is returned so the maker can say
// whether it only explains what the license covers or adds conditions. A text with changes inside it
// is never matched: a modified license is not treated as a standard one.
//
// The standard texts are the ones in site/license-texts/ (from choosealicense.com), bundled with the
// Worker. Nothing is fetched at runtime.

import MIT from "../site/license-texts/MIT.txt";
import MIT0 from "../site/license-texts/MIT-0.txt";
import BSD0 from "../site/license-texts/0BSD.txt";
import BSD2 from "../site/license-texts/BSD-2-Clause.txt";
import BSD3 from "../site/license-texts/BSD-3-Clause.txt";
import ISC from "../site/license-texts/ISC.txt";
import ZLIB from "../site/license-texts/Zlib.txt";
import APACHE2 from "../site/license-texts/Apache-2.0.txt";
import MPL2 from "../site/license-texts/MPL-2.0.txt";
import GPL2 from "../site/license-texts/GPL-2.0.txt";
import GPL3 from "../site/license-texts/GPL-3.0.txt";
import LGPL21 from "../site/license-texts/LGPL-2.1.txt";
import LGPL3 from "../site/license-texts/LGPL-3.0.txt";
import AGPL3 from "../site/license-texts/AGPL-3.0.txt";
import UNLICENSE from "../site/license-texts/Unlicense.txt";
import CC0 from "../site/license-texts/CC0-1.0.txt";
import CCBY4 from "../site/license-texts/CC-BY-4.0.txt";
import CCBYSA4 from "../site/license-texts/CC-BY-SA-4.0.txt";

const GNU_START = "Everyone is permitted to copy and distribute verbatim copies";
const GNU_APPENDIX = "How to Apply These Terms to Your New";
// The Free Software Foundation's address appears in old and new forms.
const FSF_ADDRESS = /^\s*(51 franklin st(reet)?|59 temple place|675 mass(achusetts)? ave)/i;

// start: where the part that must match begins (the title before it may differ or be missing).
// optional: where an appendix begins that may be left out or filled in.
// vars: phrases that may be worded differently in real copies.
const SPECS = [
  { spdx: "MIT", text: MIT, start: "Permission is hereby granted" },
  { spdx: "MIT-0", text: MIT0, start: "Permission is hereby granted" },
  { spdx: "0BSD", text: BSD0, start: "Permission to use, copy, modify" },
  { spdx: "ISC", text: ISC, start: "Permission to use, copy, modify" },
  { spdx: "BSD-2-Clause", text: BSD2, start: "Redistribution and use in source" },
  { spdx: "BSD-3-Clause", text: BSD3, start: "Redistribution and use in source", vars: ["the copyright holder nor", "COPYRIGHT HOLDERS AND CONTRIBUTORS", "COPYRIGHT HOLDER OR CONTRIBUTORS"] },
  { spdx: "Zlib", text: ZLIB, start: "This software is provided" },
  { spdx: "Apache-2.0", text: APACHE2, start: "TERMS AND CONDITIONS FOR USE", optional: "APPENDIX: How to apply" },
  { spdx: "MPL-2.0", text: MPL2, start: "Definitions" },
  { spdx: "GPL-2.0", text: GPL2, start: GNU_START, optional: GNU_APPENDIX },
  { spdx: "GPL-3.0", text: GPL3, start: GNU_START, optional: GNU_APPENDIX },
  { spdx: "LGPL-2.1", text: LGPL21, start: GNU_START, optional: GNU_APPENDIX },
  { spdx: "LGPL-3.0", text: LGPL3, start: GNU_START },
  { spdx: "AGPL-3.0", text: AGPL3, start: GNU_START, optional: GNU_APPENDIX },
  { spdx: "Unlicense", text: UNLICENSE, start: "This is free and unencumbered" },
  { spdx: "CC0-1.0", text: CC0, start: "Statement of Purpose" },
  { spdx: "CC-BY-4.0", text: CCBY4, start: "Creative Commons Attribution 4.0 International Public License", optional: "Creative Commons is not a party" },
  { spdx: "CC-BY-SA-4.0", text: CCBYSA4, start: "Creative Commons Attribution-ShareAlike 4.0 International Public License", optional: "Creative Commons is not a party" }
];
export const SUPPORTED = SPECS.map((s) => s.spdx);

const MAX_GAP = 120; // characters a varying phrase may take in the normalised text
const VAR = "\u0000";

// Lower case, one spelling, no punctuation or markup, single spaces. Applied to each line.
function normLine(line) {
  return line
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/^\s*([-*+•>#]+|\(?[0-9]{1,2}(\.[0-9]{1,2})*[.)]|\(?[a-z][.)])\s+/, "") // list markers and headings
    .replace(/\blicen[cs]e/g, "license")
    .replace(/\bhttps:/g, "http:")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    // List markers ("2.", "(a)", "iv.") move about when a text is rewrapped, so single letters, small
    // numbers and small roman numerals are left out everywhere, in the standard text and the file alike.
    .filter((w) => w && !/^([a-z]|[0-9]{1,2}|ii|iii|iv|vi|vii|viii)$/.test(w))
    .join(" ");
}
function norm(text) { return text.split(/\r?\n/).map(normLine).filter(Boolean).join(" "); }

function isCopyrightLine(line) {
  const t = line.replace(/^[\s*_#>`-]+/, "").replace(/[*_`]+\s*$/, "").trim();
  if (t.length > 160) return false; // a long "copyright" line may carry conditions; it is kept and shown
  if (/^all rights reserved\.?$/i.test(t)) return true;
  if (/^(\(c\)|\u00a9)\s*([0-9]{4}|\[year\])/i.test(t)) return true;
  // "Copyright (c) 2024 Jane", not a wrapped line that happens to start "copyright on the Program ..."
  return /^copyright\s*(\(c\)|\u00a9|[0-9]{4}|\[year\]|<year>)/i.test(t);
}
function isAddressLine(line) { return FSF_ADDRESS.test(line); }

// Title words that may stand alone above a license ("The MIT License (MIT)", "GNU GENERAL PUBLIC LICENSE Version 3").
const TITLE_WORDS = new Set(("the license version mit bsd clause zero isc zlib apache mozilla public gnu general lesser library affero " +
  "creative commons attribution sharealike share alike international universal cc0 cc by sa unlicense legal code spdx identifier " +
  "new simplified revised modified 2 3 0 1 4 2 0 1 0 january february march april may june july august september october november december " +
  "http www org licenses opensource apache gnu fsf").split(" "));
function isTitle(n) {
  const words = n.split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 14 && words.every((w) => TITLE_WORDS.has(w) || /^(19|20)[0-9]{2}$/.test(w) || /^[0-9]{1,2}$/.test(w));
}

let compiled = null;
function compile() {
  if (compiled) return compiled;
  compiled = SPECS.map((s) => {
    const raw = s.text;
    const startAt = s.start ? raw.indexOf(s.start) : 0;
    const optAt = s.optional ? raw.indexOf(s.optional) : -1;
    const head = raw.slice(0, Math.max(0, startAt));
    const body = raw.slice(Math.max(0, startAt), optAt > 0 ? optAt : raw.length);
    const appendix = optAt > 0 ? raw.slice(optAt) : "";
    const bodyLines = body.split(/\r?\n/).filter((l) => !isCopyrightLine(l) && !isAddressLine(l) && !/\[(year|fullname)\]/.test(l));
    let n = norm(bodyLines.join("\n"));
    for (const v of s.vars || []) n = n.replace(normLine(v), VAR);
    const segments = n.split(VAR).map((x) => x.trim()).filter(Boolean);
    const nApp = norm(appendix);
    return { spdx: s.spdx, segments, length: n.length, head: norm(head), appendix: nApp, shingles: shingles(nApp) };
  });
  return compiled;
}

function shingles(n) {
  const w = n.split(" "), out = new Set();
  for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(" "));
  return out;
}

// Find the template's segments in order. Returns [start, end) in the normalised file, or null.
function locate(file, segments) {
  let from = 0;
  while (true) {
    const first = file.indexOf(segments[0], from);
    if (first < 0) return null;
    let pos = first + segments[0].length, ok = true;
    for (let i = 1; i < segments.length; i++) {
      const at = file.indexOf(segments[i], pos);
      if (at < 0 || at - pos > MAX_GAP) { ok = false; break; }
      pos = at + segments[i].length;
    }
    if (ok) return [first, pos];
    from = first + 1;
  }
}

// The file's lines, each with its place in the normalised text. Copyright and address lines are set aside.
function lay(text) {
  const lines = [];
  let n = "";
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = { raw, skip: isCopyrightLine(raw) || isAddressLine(raw), blank: !raw.trim() };
    const t = line.skip ? "" : normLine(raw);
    if (t) {
      if (n) n += " ";
      line.start = n.length;
      n += t;
      line.end = n.length;
    }
    lines.push(line);
  }
  return { lines, n };
}

// Wording outside the matched text, as paragraphs of the original lines. Titles, the license's own
// heading and its "how to apply" appendix don't count.
function extraWording(lines, span, tpl) {
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    const inside = l.start === undefined || (l.start >= span[0] && l.end <= span[1]);
    if (l.blank || l.skip || inside) {
      if (cur && (l.blank || inside)) { blocks.push(cur); cur = null; }
      continue;
    }
    (cur = cur || []).push(l.raw);
  }
  if (cur) blocks.push(cur);
  const out = [];
  for (const b of blocks) {
    const n = norm(b.join("\n"));
    if (!n || isTitle(n)) continue;
    if (n === "spdx license identifier " + tpl.spdx.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) continue;
    if (tpl.head && tpl.head.includes(n)) continue;
    if (tpl.appendix && (tpl.appendix.includes(n) || mostlyIn(n, tpl.shingles))) continue;
    out.push(b.map((x) => x.trimEnd()).join("\n").trim());
  }
  return out;
}
function mostlyIn(n, set) {
  const s = shingles(n);
  if (s.size < 3) return false;
  let hit = 0;
  for (const x of s) if (set.has(x)) hit++;
  return hit / s.size >= 0.85;
}

// The result: { spdx, extra: [paragraphs] } when one supported license's full text is in the file,
// { spdx: null, several: [ids] } when more than one is, or { spdx: null } when none is.
export function matchLicense(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: false }).decode(bytes); } catch { return { spdx: null }; }
  if (text.length > 200000) return { spdx: null };
  const { lines, n } = lay(text);
  const found = [];
  for (const tpl of compile()) {
    if (!tpl.segments.length) continue;
    const span = locate(n, tpl.segments);
    if (span) found.push({ tpl, span });
  }
  if (!found.length) return { spdx: null };
  // A shorter license found inside a longer one's span is part of it, not a second license.
  found.sort((a, b) => b.tpl.length - a.tpl.length);
  const kept = [];
  for (const f of found) if (!kept.some((k) => f.span[0] >= k.span[0] && f.span[1] <= k.span[1])) kept.push(f);
  let pick = kept[0];
  if (kept.length > 1) {
    // An LGPL file that also carries the GPL text it builds on is the LGPL.
    const ids = kept.map((k) => k.tpl.spdx);
    const lgpl = kept.find((k) => k.tpl.spdx === "LGPL-3.0");
    const gpl = kept.find((k) => k.tpl.spdx === "GPL-3.0");
    if (kept.length === 2 && lgpl && gpl) {
      pick = { tpl: { ...lgpl.tpl, head: lgpl.tpl.head + " " + gpl.tpl.head, appendix: gpl.tpl.appendix, shingles: gpl.tpl.shingles },
        span: [Math.min(lgpl.span[0], gpl.span[0]), Math.max(lgpl.span[1], gpl.span[1])] };
    }
    else return { spdx: null, several: ids.sort() };
  }
  // Email addresses are never shown on Brainchild, so they're masked in the wording kept and displayed.
  const extra = extraWording(lines, pick.span, pick.tpl).slice(0, 20)
    .map((p) => p.replace(/[^\s<>()@]+@[^\s<>()@]+\.[a-z]{2,}/gi, "[email address removed]").slice(0, 2000));
  return { spdx: pick.tpl.spdx, extra };
}
