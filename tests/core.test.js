import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT,
  SCHEMA,
  normalizePaper,
  extractTextMetadata,
  parseBibTeX,
  parseRIS,
  safeSegment,
  isSafeArchivePath,
  originalArchivePath,
  splitEditedList,
  filteredPapers,
  reviewOutline,
  validateManifest,
  sha256,
  demoPapers,
} from "../core.js";

test("labelled bilingual text slices title, authors, source, abstract, keywords and DOI", () => {
  const paper = extractTextMetadata(
    "标题：算法管理中的程序保障\n作者：研究者甲；研究者乙\n期刊：测试期刊\n年份：2025\n摘要：讨论劳动场景中的程序保障。\n第二行摘要。\n关键词：劳动法；算法管理\nDOI: 10.1234/test.2025",
    "paper.txt",
  );
  assert.equal(paper.title, "算法管理中的程序保障");
  assert.deepEqual(paper.authors, ["研究者甲", "研究者乙"]);
  assert.equal(paper.journal, "测试期刊");
  assert.equal(paper.year, "2025");
  assert.match(paper.abstract, /第二行摘要/);
  assert.doesNotMatch(paper.abstract, /关键词/);
  assert.deepEqual(paper.keywords, ["劳动法", "算法管理"]);
  assert.equal(paper.doi, "10.1234/test.2025");
  assert.equal(paper.verified, false);
});
test("unlabelled documents do not invent source, year or author", () => {
  const paper = extractTextMetadata(
    "# A paper title\nA sentence containing 2024 and an author-like name.",
  );
  assert.equal(paper.title, "A paper title");
  assert.equal(paper.year, "");
  assert.deepEqual(paper.authors, []);
  assert.equal(paper.journal, "");
  assert.equal(paper.abstract, "");
});
test("abstract ends at Chinese, numbered and Markdown introduction headings", () => {
  for (const heading of [
    "引言",
    "导论",
    "一、引言",
    "1. Introduction",
    "# Introduction",
  ]) {
    const paper = extractTextMetadata(
      `标题：某研究\n摘要：这是摘要。\n${heading}\n这是正文。`,
    );
    assert.equal(paper.abstract, "这是摘要。", heading);
  }
});
test("editor lists use semicolons and retain commas inside author and keyword values", () => {
  assert.deepEqual(splitEditedList("Doe, Jane; Li, Ming"), [
    "Doe, Jane",
    "Li, Ming",
  ]);
  assert.deepEqual(splitEditedList("Law, technology；Accountability"), [
    "Law, technology",
    "Accountability",
  ]);
});
test("BibTeX supports nested braces, quoted fields, numeric year and author lists", () => {
  const [paper] = parseBibTeX(
    '@article{sample, title={The {AI} governance question}, author={Doe, Jane and Li, Ming}, journal="Test Review", year=2025, abstract={A nested {argument}, with punctuation.}, keywords={AI; Labour}, doi={10.1234/test}}',
  );
  assert.equal(paper.title, "The AI governance question");
  assert.deepEqual(paper.authors, ["Doe, Jane", "Li, Ming"]);
  assert.equal(paper.journal, "Test Review");
  assert.equal(paper.year, "2025");
  assert.match(paper.abstract, /argument, with punctuation/);
  assert.deepEqual(paper.keywords, ["AI", "Labour"]);
});
test("BibTeX rejects malformed data and unsupported concatenation without partial import", () => {
  assert.throws(
    () => parseBibTeX("@article{bad, title={unclosed}"),
    /Unclosed/,
  );
  assert.throws(
    () => parseBibTeX("@article{bad, title={A} # {B}}"),
    /concatenation/,
  );
  assert.throws(
    () => parseBibTeX("@article{bad, title=unexpandedMacro}"),
    /macros/,
  );
  assert.throws(() => parseBibTeX("not bibliography"), /No supported/);
});
test("RIS preserves multiple authors/keywords, joins continuation and requires end marker", () => {
  const [paper] = parseRIS(
    "TY  - JOUR\nTI  - Test title\nAU  - Author A\nAU  - Author B\nJO  - Journal X\nPY  - 2024/01/02\nAB  - First line\n  second line\nKW  - labour\nKW  - AI\nER  - ",
  );
  assert.deepEqual(paper.authors, ["Author A", "Author B"]);
  assert.equal(paper.year, "2024");
  assert.equal(paper.abstract, "First line second line");
  assert.deepEqual(paper.keywords, ["labour", "AI"]);
  assert.throws(() => parseRIS("TY  - JOUR\nTI  - Missing end"), /missing ER/);
});
test("archive names are safe across OS and reject traversal and prototype paths", () => {
  assert.equal(safeSegment("../../Sensitive: work?"), "-..-Sensitive- work-");
  assert.equal(safeSegment("CON"), "Unclassified");
  assert.equal(safeSegment("NUL.txt"), "Unclassified");
  assert.equal(safeSegment("__proto__"), "Unclassified");
  for (const value of [
    "../paper.pdf",
    "/tmp/paper",
    "C:/paper",
    "dir\\paper",
    "a/../b",
    "a//b",
    "__proto__/x",
    "constructor/x",
    "a/\u0000b",
  ])
    assert.equal(isSafeArchivePath(value), false, value);
  assert.equal(isSafeArchivePath("劳动与平台/42-paper.pdf"), true);
});
test("organized original paths retain full IDs so same-prefix papers cannot overwrite each other", () => {
  const first = { id: "paper000A", fileName: "paper.txt", theme: "Test" },
    second = { ...first, id: "paper000B" };
  assert.equal(originalArchivePath(first), "Test/paper000A-paper.txt");
  assert.equal(originalArchivePath(second), "Test/paper000B-paper.txt");
  assert.notEqual(originalArchivePath(first), originalArchivePath(second));
  assert.throws(
    () => originalArchivePath({ ...first, id: "../unsafe" }),
    /Invalid/,
  );
});
test("record IDs cannot create reserved filesystem or object-property directories", () => {
  for (const id of ["__proto__", "constructor", "prototype", "CON", "COM1"]) {
    assert.throws(
      () => normalizePaper({ id, title: "Record" }, { strict: true }),
      /ID/,
    );
    assert.throws(
      () =>
        originalArchivePath({ id, fileName: "paper.txt" }, { backup: true }),
      /ID/,
    );
  }
});
test("metadata strict validation rejects forged flags, sizes, IDs and field types", () => {
  for (const data of [
    { title: {} },
    { authors: "Someone" },
    { verified: "true" },
    { size: -1 },
    { year: "twenty" },
    { hash: "not-a-hash" },
    { id: "../../x" },
    { pages: -2 },
    { sourceUrl: "javascript:alert(1)" },
  ])
    assert.throws(() => normalizePaper(data, { strict: true }));
  const candidate = normalizePaper({
    year: "forthcoming",
    sourceUrl: "file:///private/source",
  });
  assert.equal(candidate.year, "");
  assert.equal(candidate.sourceUrl, "");
  assert.match(candidate.notes, /forthcoming/);
  assert.match(candidate.notes, /file:\/\/\/private/);
});
test("backup manifest validates version, uniqueness and safe file references before writes", () => {
  const record = normalizePaper({
    id: "p1",
    title: "Paper",
    hash: "a".repeat(64),
    size: 3,
  });
  const valid = {
    format: FORMAT,
    schema: SCHEMA,
    papers: [{ ...record, blobPath: "originals/p1/file.txt" }],
  };
  assert.equal(validateManifest(valid).length, 1);
  assert.throws(
    () => validateManifest({ ...valid, schema: 99 }),
    /Unsupported/,
  );
  assert.throws(
    () => validateManifest({ ...valid, papers: [record, record] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateManifest({
        ...valid,
        papers: [{ ...record, blobPath: "../file.txt" }],
      }),
    /Invalid original/,
  );
  assert.throws(
    () =>
      validateManifest({
        ...valid,
        papers: [{ ...record, hash: "", blobPath: "file.txt" }],
      }),
    /Invalid original/,
  );
});
test("multidimensional filters compose, search abstract/full text and review status", () => {
  const records = [
    normalizePaper({
      title: "One",
      journal: "J",
      authors: ["A"],
      keywords: ["AI"],
      year: "2025",
      theme: "Labour",
      abstract: "Procedural safeguards",
      verified: false,
    }),
    normalizePaper({
      title: "Two",
      journal: "K",
      authors: ["B"],
      keywords: ["AI"],
      year: "2024",
      theme: "Labour",
      text: "Full text token",
      verified: true,
    }),
  ];
  assert.equal(
    filteredPapers(records, {
      query: "safeguards",
      journal: "J",
      author: "A",
      year: "2025",
      keyword: "AI",
      theme: "Labour",
      status: "review",
    }).length,
    1,
  );
  assert.equal(filteredPapers(records, { query: "full text token" }).length, 1);
  assert.equal(
    filteredPapers(records, { query: "One", journal: "K" }).length,
    0,
  );
});
test("review outline preserves provenance, marks unconfirmed/synthetic sources and escapes Markdown", () => {
  const outline = reviewOutline([
    normalizePaper({
      title: "[Untrusted](link)",
      abstract: "Source abstract",
      theme: "# AI",
      synthetic: true,
    }),
  ]);
  assert.match(outline, /SYNTHETIC DEMO/);
  assert.match(outline, /Needs review/);
  assert.match(outline, /Source abstract/);
  assert.match(outline, /Which gaps require further reading/);
  assert.match(outline, /\\\[Untrusted\\\]/);
  assert.match(outline, /does not generate findings/);
});
test("SHA-256 matches the published abc test vector", async () =>
  assert.equal(
    await sha256(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  ));
test("educational examples are synthetic and do not claim attached originals", () => {
  for (const p of demoPapers()) {
    assert.equal(p.synthetic, true);
    assert.equal(p.size, 0);
    assert.equal(p.hash, "");
    assert.equal(p.verified, false);
  }
});
