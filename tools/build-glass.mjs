#!/usr/bin/env node
// tools/build-glass.mjs
//
// Builds data/glass/catalog.json (an array of GlassEntry, see src/engine/lens-types.ts) from the local copy of the
// refractiveindex.info-database in .local/glass/database/ (gitignored; see "Getting the database" below).
//
// Usage:
//   node tools/build-glass.mjs            build data/glass/catalog.json, print the validation + nearest-match report
//   node tools/build-glass.mjs --check     build in memory only, print the report, do not write catalog.json
//
// Getting the database (also recorded in research/glass-sources.md):
//   Release zip used: https://github.com/polyanskiy/refractiveindex.info-database/releases/download/v2026-05-24/rii-database-2026-05-24.zip
//   Tag v2026-05-24, commit aa6abb827d852dac62e30a3add14a4bf1b49c176. License: CC0-1.0 (public domain dedication).
//   Unzip so this script sees .local/glass/database/data/... (i.e. unzip the release zip's "database/" folder into
//   .local/glass/, or `git clone` the repo into .local/glass/refractiveindex.info-database and point DB_DATA below
//   at its data/ folder).
//
// Dispersion formulas used here, verbatim from the database's own doc/Dispersion formulas.pdf (RefractiveIndex.INFO,
// 2014-06-29), lambda in micrometers:
//   formula 1 (Sellmeier, preferred): n^2 - 1 = c0 + B1*lam^2/(lam^2 - c1^2) + B2*lam^2/(lam^2 - c2^2) + B3*lam^2/(lam^2 - c3^2) + ...
//     (the yml lists c0, B1, c1, B2, c2, B3, c3, ...  -- note c_i here is a WAVELENGTH, not its square)
//   formula 2 (Sellmeier-2): n^2 - 1 = c0 + B1*lam^2/(lam^2 - C1) + B2*lam^2/(lam^2 - C2) + B3*lam^2/(lam^2 - C3) + ...
//     (the yml lists c0, B1, C1, B2, C2, B3, C3, ...  -- here C_i IS already lambda_i^2, um^2)
//   formula 3 (Polynomial): n^2 = c0 + a1*lam^e1 + a2*lam^e2 + ...  (yml lists c0, a1, e1, a2, e2, ...)
//     The classic "Schott formula" (6 coefficients a0..a5: n^2 = a0 + a1*lam^2 + a2/lam^2 + a3/lam^4 + a4/lam^6 +
//     a5/lam^8) is formula 3 with the fixed exponent set [2, -2, -4, -6, -8] -- that's what GlassEntry.formula
//     'schott' means here, and it is what SCHOTT/OHARA/CDGM/HOYA/SUMITA/HIKARI mostly ship as "formula 3".
//
// Conversion policy (see research/glass-sources.md "Formula notes" for the full writeup):
//   - formula 1 or 2, exactly 3 Sellmeier terms, constant term c0 == 0  -> GlassEntry.formula = 'sellmeier3',
//     coef = [B1, C1, B2, C2, B3, C3] with C in um^2 (formula 1's per-term wavelengths are squared to get there).
//   - formula 3, exactly 11 coefficients with exponents [2, -2, -4, -6, -8] -> GlassEntry.formula = 'schott',
//     coef = [a0, a1, a2, a3, a4, a5].
//   - formula 3 with MORE terms (some HIKARI extended-range glasses carry 4 or 6 terms) -> GlassEntry.formula =
//     'other', coef = the raw [c0, a1, e1, a2, e2, ...] list, i.e. formula 3's own layout, unmodified. This is a
//     single, unambiguous convention: n^2 = coef[0] + sum_i coef[2i-1] * lam^coef[2i] for i = 1..(coef.length-1)/2,
//     lam in um. This is the ONLY thing 'other' means in this catalog -- see research/glass-sources.md before
//     adding anything else under 'other', or extend GlassEntry with a formula-variant field instead of overloading it.
//   - Anything else (tabulated-only entries with no formula, e.g. LZOS; a formula we don't recognize) is skipped
//     and counted, never guessed.
//
// This script has no YAML dependency: the refractiveindex.info yml files we read are a narrow, regular subset
// (REFERENCES/DATA/PROPERTIES blocks with simple scalar and one-line-list values), so a few targeted regexes parse
// them exactly; see parseGlassYml(). We do not attempt to parse arbitrary YAML.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_DATA = path.join(ROOT, '.local', 'glass', 'database', 'data');
const OUT_PATH = path.join(ROOT, 'data', 'glass', 'catalog.json');

const DB_COMMIT = 'aa6abb827d852dac62e30a3add14a4bf1b49c176';
const DB_TAG = 'v2026-05-24';
const LICENSE = 'CC0-1.0';
const ACCESSED = '09/28/2026';

// Fraunhofer lines, nm -- matches src/engine spectrum.ts per docs/ENGINE.md.
const ND_NM = 587.5618;
const NF_NM = 486.1327;
const NC_NM = 656.2725;

const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------------------------------------------
// Minimal parser for the RII yml subset we need.
// ---------------------------------------------------------------------------------------------------------------

function parseGlassYml(text) {
  // The first "type: formula N" block under DATA: is the dispersion (index) formula. A "tabulated k" block, if
  // present, is absorption and is ignored here.
  const dataMatch = text.match(
    /type:\s*formula\s+(\d+)\s*\r?\n\s*wavelength_range:\s*([\d.eE+-]+)\s+([\d.eE+-]+)\s*\r?\n\s*coefficients:\s*([^\r\n]+)/
  );
  let formulaNum = null, range = null, coefs = null;
  if (dataMatch) {
    formulaNum = Number(dataMatch[1]);
    range = [Number(dataMatch[2]), Number(dataMatch[3])];
    coefs = dataMatch[4].trim().split(/\s+/).map(Number);
  }
  // nd/Vd are usually plain decimals ("1.5168") but a handful of SCHOTT entries print scientific notation
  // ("1.79457E+00" / "4.55300E+01") -- match both.
  const ndMatch = text.match(/\bnd:\s*([\d.]+(?:[eE][+-]?\d+)?)/);
  const vdMatch = text.match(/\bVd:\s*([\d.]+(?:[eE][+-]?\d+)?)/);
  const refMatch = text.match(/REFERENCES:\s*\|\s*\r?\n([\s\S]*?)\r?\n[A-Z][A-Z_]*:/);
  let refText = refMatch ? refMatch[1] : '';
  refText = refText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([),.])/g, '$1').trim();
  return {
    formulaNum, range, coefs,
    nd: ndMatch ? Number(ndMatch[1]) : null,
    vd: vdMatch ? Number(vdMatch[1]) : null,
    refText,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Formula conversion.
// ---------------------------------------------------------------------------------------------------------------

function toSellmeier3(formulaNum, coefs) {
  if (!coefs || coefs.length !== 7) return null;
  if (formulaNum !== 1 && formulaNum !== 2) return null;
  const [c0, B1, X1, B2, X2, B3, X3] = coefs;
  if (Math.abs(c0) > 1e-9) return null; // not exactly a 3-term Sellmeier without a constant offset
  if (formulaNum === 2) return [B1, X1, B2, X2, B3, X3]; // Sellmeier-2: X_i already lambda_i^2 (um^2)
  return [B1, X1 * X1, B2, X2 * X2, B3, X3 * X3]; // Sellmeier (preferred): X_i is lambda_i, square it
}

const SCHOTT_EXPONENTS = [2, -2, -4, -6, -8];

function toSchott(formulaNum, coefs) {
  if (formulaNum !== 3 || !coefs || coefs.length !== 11) return null;
  const exps = [coefs[2], coefs[4], coefs[6], coefs[8], coefs[10]];
  if (!exps.every((e, i) => e === SCHOTT_EXPONENTS[i])) return null;
  return [coefs[0], coefs[1], coefs[3], coefs[5], coefs[7], coefs[9]];
}

function toOtherPoly3(formulaNum, coefs) {
  if (formulaNum !== 3 || !coefs) return null;
  if ((coefs.length - 1) % 2 !== 0) return null;
  return coefs.slice();
}

function classify(formulaNum, coefs) {
  let coef = toSellmeier3(formulaNum, coefs);
  if (coef) return { formula: 'sellmeier3', coef };
  coef = toSchott(formulaNum, coefs);
  if (coef) return { formula: 'schott', coef };
  coef = toOtherPoly3(formulaNum, coefs);
  if (coef) return { formula: 'other', coef };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation (used both to derive nd/vd for entries with no vendor PROPERTIES block, and to validate every entry).
// ---------------------------------------------------------------------------------------------------------------

function n2Sellmeier3(coef, umLambda) {
  const l2 = umLambda * umLambda;
  let n2 = 1;
  for (let i = 0; i < 3; i++) {
    const B = coef[2 * i], C = coef[2 * i + 1];
    n2 += (B * l2) / (l2 - C);
  }
  return n2;
}

function n2Schott(coef, umLambda) {
  const [a0, a1, a2, a3, a4, a5] = coef;
  const l2 = umLambda * umLambda;
  return a0 + a1 * l2 + a2 / l2 + a3 / l2 ** 2 + a4 / l2 ** 3 + a5 / l2 ** 4;
}

function n2OtherPoly3(coef, umLambda) {
  let n2 = coef[0];
  for (let i = 1; i < coef.length; i += 2) {
    n2 += coef[i] * umLambda ** coef[i + 1];
  }
  return n2;
}

function indexAt(formula, coef, nm) {
  const um = nm / 1000;
  const n2 =
    formula === 'sellmeier3' ? n2Sellmeier3(coef, um) :
    formula === 'schott' ? n2Schott(coef, um) :
    n2OtherPoly3(coef, um);
  return Math.sqrt(n2);
}

function computeNdVd(formula, coef) {
  const nd = indexAt(formula, coef, ND_NM);
  const nF = indexAt(formula, coef, NF_NM);
  const nC = indexAt(formula, coef, NC_NM);
  const vd = (nd - 1) / (nF - nC);
  return { nd, vd };
}

// ---------------------------------------------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------------------------------------------

const MAKER_CATALOGS = [
  { dir: 'schott', key: 'SCHOTT', name: 'Schott' },
  { dir: 'ohara', key: 'OHARA', name: 'Ohara' },
  { dir: 'hikari', key: 'HIKARI', name: 'Hikari' },
  { dir: 'cdgm', key: 'CDGM', name: 'CDGM' },
  { dir: 'hoya', key: 'HOYA', name: 'Hoya' },
  { dir: 'sumita', key: 'SUMITA', name: 'Sumita' },
];

// Non-maker-catalog materials the brief asks for by name: fused silica, CaF2 (fluorite), MgF2 (coatings). These
// live under the database's "main" shelf (elemental/simple-compound materials), not "specs", and carry no vendor
// PROPERTIES block, so nd/vd are derived here by evaluating the cited Sellmeier equation at d/F/C (noted in source).
const SPECIALS = [
  {
    key: 'RII:FUSED-SILICA', catalog: 'RefractiveIndex.INFO', name: 'Fused silica (Malitson 1965)',
    file: 'main/SiO2/nk/Malitson.yml',
  },
  {
    key: 'RII:CAF2', catalog: 'RefractiveIndex.INFO', name: 'Calcium fluoride / fluorite (Malitson 1963)',
    file: 'main/CaF2/nk/Malitson.yml',
  },
  {
    key: 'RII:MGF2-O', catalog: 'RefractiveIndex.INFO', name: 'Magnesium fluoride, ordinary ray (Dodge 1984)',
    file: 'main/MgF2/nk/Dodge-o.yml',
  },
  {
    key: 'RII:MGF2-E', catalog: 'RefractiveIndex.INFO', name: 'Magnesium fluoride, extraordinary ray (Dodge 1984)',
    file: 'main/MgF2/nk/Dodge-e.yml',
  },
];

// Glasses skipped that we looked at and could not include, with the reason, for the note in research/glass-sources.md.
const SKIPPED = []; // { key, reason }

function relPath(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function sourceLine(filePath, refText, extra) {
  let s = `refractiveindex.info database (${LICENSE}), commit ${DB_COMMIT} (tag ${DB_TAG}), ${relPath(filePath)}`;
  if (refText) s += `; upstream: ${refText}`;
  if (extra) s += `; ${extra}`;
  return s;
}

function buildMakerCatalogs() {
  const entries = [];
  const stats = { filesSeen: 0, sellmeier3: 0, schott: 0, other: 0, skipped: 0 };
  for (const cat of MAKER_CATALOGS) {
    const dir = path.join(DB_DATA, 'specs', cat.dir, 'optical');
    if (!fs.existsSync(dir)) {
      throw new Error(`Expected catalog directory missing: ${dir}. Is .local/glass/database populated? See the header of this script.`);
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort();
    for (const fn of files) {
      stats.filesSeen++;
      const glassName = fn.slice(0, -4);
      const key = `${cat.key}:${glassName}`;
      const filePath = path.join(dir, fn);
      const text = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseGlassYml(text);

      if (!parsed.coefs) {
        stats.skipped++;
        SKIPPED.push({ key, reason: 'no "formula N" dispersion block found (tabulated-only, e.g. LZOS)' });
        continue;
      }
      const cls = classify(parsed.formulaNum, parsed.coefs);
      if (!cls) {
        stats.skipped++;
        SKIPPED.push({ key, reason: `formula ${parsed.formulaNum} with ${parsed.coefs.length} coefficients not in {sellmeier3, schott, other-poly3}` });
        continue;
      }
      if (parsed.nd == null || parsed.vd == null) {
        stats.skipped++;
        SKIPPED.push({ key, reason: 'no PROPERTIES.nd/Vd in source file' });
        continue;
      }

      entries.push({
        key,
        catalog: cat.name,
        name: `${cat.name} ${glassName}`,
        nd: parsed.nd,
        vd: parsed.vd,
        formula: cls.formula,
        coef: cls.coef,
        range: parsed.range,
        source: sourceLine(filePath, parsed.refText),
        accessed: ACCESSED,
      });
      stats[cls.formula]++;
    }
  }
  return { entries, stats };
}

function buildSpecials() {
  const entries = [];
  for (const sp of SPECIALS) {
    const filePath = path.join(DB_DATA, sp.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Expected special-material file missing: ${filePath}`);
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseGlassYml(text);
    const cls = classify(parsed.formulaNum, parsed.coefs);
    if (!cls) {
      SKIPPED.push({ key: sp.key, reason: `formula ${parsed.formulaNum} not convertible` });
      continue;
    }
    const { nd, vd } = computeNdVd(cls.formula, cls.coef);
    entries.push({
      key: sp.key,
      catalog: sp.catalog,
      name: sp.name,
      nd,
      vd,
      formula: cls.formula,
      coef: cls.coef,
      range: parsed.range,
      source: sourceLine(
        filePath,
        parsed.refText,
        'nd/vd derived by evaluating this Sellmeier equation at d/F/C -- no vendor PROPERTIES block for this entry'
      ),
      accessed: ACCESSED,
    });
  }
  return entries;
}

// Optical cement looked at and NOT converted -- kept here (not in the output) purely so the reason is grep-able and
// this script is the single source of truth research/glass-sources.md quotes from.
function noteSkippedCement() {
  SKIPPED.push({
    key: 'other/optical adhesives/NOA-61 (Norland Optical Adhesive 61)',
    reason:
      'formula 5 (Cauchy: n = C1 + C2*lam^C3 + ..., n itself not n^2) is a different shape than the formula:"other" ' +
      'convention adopted here (RII formula-3 polynomial in n^2); rather than overload "other" with two incompatible ' +
      'coefficient layouts, this one glass is skipped. See research/glass-sources.md.',
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Validation: recompute nd/vd from coef for every entry and compare to the stored (catalog or derived) nd/vd.
// ---------------------------------------------------------------------------------------------------------------

function validate(entries) {
  const ND_TOL = 1e-4;
  const VD_TOL = 0.1;
  let within = 0;
  const outliers = [];
  for (const e of entries) {
    const { nd, vd } = computeNdVd(e.formula, e.coef);
    const dNd = Math.abs(nd - e.nd);
    const dVd = Math.abs(vd - e.vd);
    if (dNd <= ND_TOL && dVd <= VD_TOL) {
      within++;
    } else {
      outliers.push({ key: e.key, catalogNd: e.nd, computedNd: nd, dNd, catalogVd: e.vd, computedVd: vd, dVd });
    }
  }
  return { total: entries.length, within, outliers };
}

// ---------------------------------------------------------------------------------------------------------------
// Nearest-match check for typical patent (nd, vd) pairs.
// ---------------------------------------------------------------------------------------------------------------

const PATENT_PAIRS = [
  [1.80400, 46.58],
  [1.49700, 81.54],
  [1.92286, 18.90],
  [1.58913, 61.14],
  [1.43875, 94.95],
  [1.51633, 64.14],
  [1.84666, 23.78],
  [1.72916, 54.68],
  [1.83481, 42.72],
  [1.61800, 63.33],
];

function nearestMatches(entries, k = 3) {
  const nds = entries.map((e) => e.nd);
  const vds = entries.map((e) => e.vd);
  const spreadNd = Math.max(...nds) - Math.min(...nds);
  const spreadVd = Math.max(...vds) - Math.min(...vds);
  const results = [];
  for (const [nd0, vd0] of PATENT_PAIRS) {
    const scored = entries
      .map((e) => {
        const dNd = (e.nd - nd0) / spreadNd;
        const dVd = (e.vd - vd0) / spreadVd;
        return { key: e.key, nd: e.nd, vd: e.vd, dist: Math.sqrt(dNd * dNd + dVd * dVd) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k);
    results.push({ nd0, vd0, matches: scored });
  }
  return { spreadNd, spreadVd, results };
}

// ---------------------------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------------------------

function main() {
  const { entries: makerEntries, stats } = buildMakerCatalogs();
  const specialEntries = buildSpecials();
  noteSkippedCement();

  const all = [...makerEntries, ...specialEntries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  console.log('=== build-glass: catalog stats ===');
  console.log(`maker-catalog files seen: ${stats.filesSeen}`);
  console.log(`  sellmeier3: ${stats.sellmeier3}`);
  console.log(`  schott:     ${stats.schott}`);
  console.log(`  other:      ${stats.other}`);
  console.log(`  skipped:    ${stats.skipped}`);
  console.log(`special materials added: ${specialEntries.length}`);
  console.log(`TOTAL entries: ${all.length}`);
  console.log();
  console.log('=== skipped (with reasons) ===');
  for (const s of SKIPPED) console.log(`  ${s.key} -- ${s.reason}`);
  console.log(`(${SKIPPED.length} skipped total)`);
  console.log();

  const val = validate(all);
  console.log('=== validation: recomputed nd/vd vs stored, tolerance 1e-4 / 0.1 ===');
  console.log(`within tolerance: ${val.within} / ${val.total}`);
  console.log(`outliers: ${val.outliers.length}`);
  for (const o of val.outliers) {
    console.log(
      `  ${o.key}: nd catalog=${o.catalogNd} computed=${o.computedNd.toFixed(6)} d=${o.dNd.toExponential(2)} | ` +
      `vd catalog=${o.catalogVd} computed=${o.computedVd.toFixed(4)} d=${o.dVd.toExponential(2)}`
    );
  }
  console.log();

  const nm = nearestMatches(all);
  console.log(`=== nearest-match check (normalized distance; spreadNd=${nm.spreadNd.toFixed(5)}, spreadVd=${nm.spreadVd.toFixed(4)}) ===`);
  for (const r of nm.results) {
    console.log(`patent nd=${r.nd0} vd=${r.vd0}:`);
    for (const m of r.matches) {
      console.log(`    ${m.key}: nd=${m.nd} vd=${m.vd} dist=${m.dist.toFixed(4)}`);
    }
  }

  if (!CHECK_ONLY) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2) + '\n', 'utf-8');
    console.log();
    console.log(`Wrote ${all.length} entries to ${relPath(OUT_PATH)}`);
  }
}

main();
