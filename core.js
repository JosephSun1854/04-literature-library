export const FORMAT = "law-ai-literature-library";
export const SCHEMA = 1;
export const MAX_FILE = 40 * 1024 * 1024;
export const MAX_TOTAL = 200 * 1024 * 1024;
export const MAX_RECORDS = 1000;
const isPaperId = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z\d_-]{1,80}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value) &&
  !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value);
const fields = [
  "title",
  "journal",
  "year",
  "abstract",
  "doi",
  "sourceUrl",
  "theme",
  "notes",
  "fileName",
  "mime",
  "hash",
  "text",
  "extraction",
];
const strings = (value) =>
  Array.isArray(value)
    ? value
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100)
    : splitList(value);
export function splitList(value = "") {
  return String(value)
    .split(/[;；\n]|,(?!\s*\d)/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}
export function splitEditedList(value = "") {
  return String(value)
    .split(/[;；\n]/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}
export function safeSegment(input, fallback = "Unclassified") {
  let value = String(input || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/^\.+|[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  if (
    !value ||
    ["__proto__", "constructor", "prototype"].includes(value) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)
  )
    value = fallback;
  return value;
}
export function isSafeArchivePath(path) {
  return (
    typeof path === "string" &&
    path.length < 600 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !/^[a-z]:/i.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          !["__proto__", "constructor", "prototype"].includes(part) &&
          !/[\x00-\x1f]/.test(part),
      )
  );
}
export function originalArchivePath(
  paper,
  { backup = false, groupBy = "theme" } = {},
) {
  if (!isPaperId(paper.id)) throw new Error("Invalid paper ID for export");
  const path = backup
    ? `originals/${paper.id}/${safeSegment(paper.fileName, "original")}`
    : `${safeSegment(paper[groupBy])}/${paper.id}-${safeSegment(paper.fileName, "original")}`;
  if (!isSafeArchivePath(path)) throw new Error("Unsafe original export path");
  return path;
}
export function normalizePaper(input, { strict = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid paper record");
  if (strict) {
    if (input.id != null && !isPaperId(input.id))
      throw new Error("Invalid paper ID");
    for (const key of fields)
      if (input[key] != null && typeof input[key] !== "string")
        throw new Error(`Invalid ${key}`);
    for (const key of ["authors", "keywords"])
      if (
        input[key] != null &&
        (!Array.isArray(input[key]) ||
          input[key].some((x) => typeof x !== "string"))
      )
        throw new Error(`Invalid ${key}`);
    if (input.year && !/^(1[4-9]\d{2}|20\d{2}|21\d{2})$/.test(input.year))
      throw new Error("Invalid year");
    if (input.hash && !/^[a-f\d]{64}$/i.test(input.hash))
      throw new Error("Invalid file hash");
    if (input.verified != null && typeof input.verified !== "boolean")
      throw new Error("Invalid verified flag");
    if (
      input.size != null &&
      (!Number.isSafeInteger(input.size) ||
        input.size < 0 ||
        input.size > MAX_FILE)
    )
      throw new Error("Invalid file size");
    if (
      input.pages != null &&
      (!Number.isSafeInteger(input.pages) ||
        input.pages < 0 ||
        input.pages > 100000)
    )
      throw new Error("Invalid page count");
    if (input.sourceUrl) {
      const url = new URL(input.sourceUrl);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Source URL must use HTTP(S)");
    }
  }
  const out = {};
  for (const key of fields)
    out[key] = String(input[key] ?? "").slice(
      0,
      key === "text"
        ? 1000000
        : key === "abstract" || key === "notes"
          ? 30000
          : 3000,
    );
  if (out.year && !/^(1[4-9]\d{2}|20\d{2}|21\d{2})$/.test(out.year)) {
    out.notes += `\nSource year candidate / 来源年份候选: ${out.year}`;
    out.year = "";
  }
  if (out.sourceUrl) {
    try {
      const url = new URL(out.sourceUrl);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Unsupported URL");
    } catch {
      out.notes += `\nSource URL candidate / 来源链接候选: ${out.sourceUrl}`;
      out.sourceUrl = "";
    }
  }
  out.title ||= "Untitled / 未命名";
  out.authors = strings(input.authors);
  out.keywords = strings(input.keywords);
  out.id = isPaperId(input.id) ? input.id : crypto.randomUUID();
  out.verified = input.verified === true;
  out.synthetic = input.synthetic === true;
  out.size = Number.isSafeInteger(input.size) ? input.size : 0;
  out.pages = Number.isSafeInteger(input.pages) ? input.pages : 0;
  out.createdAt =
    typeof input.createdAt === "string"
      ? input.createdAt.slice(0, 40)
      : new Date().toISOString();
  out.updatedAt =
    typeof input.updatedAt === "string"
      ? input.updatedAt.slice(0, 40)
      : out.createdAt;
  return out;
}
export function missingFields(paper) {
  return ["authors", "journal", "year", "abstract", "keywords"].filter(
    (key) => !paper[key]?.length,
  );
}
export function extractTextMetadata(text, fileName = "") {
  const normalized = String(text).replace(/\r/g, "").slice(0, 1000000);
  const lines = normalized
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const labelled = (label) =>
    normalized
      .match(
        new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:：]\\s*([^\\n]+)`, "i"),
      )?.[1]
      ?.trim() || "";
  const title =
    labelled("title|标题|题名") ||
    lines
      .find(
        (x) =>
          !/^(---|authors?|作者|journal|期刊|year|年份|doi|keywords?|关键词|abstract|摘要)\s*[:：]?/i.test(
            x,
          ),
      )
      ?.replace(/^#+\s*/, "")
      .slice(0, 220) ||
    fileName.replace(/\.[^.]+$/, "");
  const abstract =
    normalized
      .match(
        /(?:^|\n)\s*(?:#{1,6}\s*)?(?:abstract|摘要)\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:(?:\d+(?:\.\d+)*[.、)]?|[一二三四五六七八九十]+[、.])\s*)?(?:keywords?\b|关键词|introduction\b|(?:引言|导论)(?=\s|[:：]|$)|references\b|参考文献)\s*[:：]?|$)/i,
      )?.[1]
      ?.trim()
      .slice(0, 12000) || "";
  const doi =
    normalized
      .match(/\b10\.\d{4,9}\/[\w.\-;()/:]+/i)?.[0]
      ?.replace(/[.,;]+$/, "") || "";
  return normalizePaper({
    title,
    authors: splitList(labelled("authors?|作者")),
    journal: labelled("journal|期刊|刊物"),
    year: labelled("year|年份|出版年份").match(/\d{4}/)?.[0] || "",
    abstract,
    keywords: splitList(labelled("keywords?|关键词")),
    doi,
    sourceUrl: labelled("url|source url|来源链接|链接"),
    text: normalized,
    extraction: "Heuristic candidates · 启发式候选",
    verified: false,
    fileName,
  });
}
function unbrace(value) {
  return value
    .replace(/[{}]/g, "")
    .replace(/\\(?:textit|textbf|emph)\s*/g, "")
    .replace(/\\&/g, "&")
    .trim();
}
export function parseBibTeX(source) {
  const result = [];
  let i = 0;
  while (i < source.length) {
    const head = /@([a-z]+)\s*([({])/gi;
    head.lastIndex = i;
    const match = head.exec(source);
    if (!match) break;
    let cursor = head.lastIndex,
      level = 1,
      quoted = false;
    const endChar = match[2] === "{" ? "}" : ")";
    const start = cursor;
    for (; cursor < source.length; cursor++) {
      const ch = source[cursor];
      if (ch === "\\") {
        cursor++;
        continue;
      }
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === match[2]) level++;
      if (!quoted && ch === endChar && --level === 0) break;
      if (!quoted && ch === endChar && level < 0)
        throw new Error("Malformed BibTeX nesting");
    }
    if (level !== 0) throw new Error("Unclosed BibTeX entry");
    i = cursor + 1;
    if (["comment", "preamble", "string"].includes(match[1].toLowerCase()))
      continue;
    const body = source.slice(start, cursor);
    const comma = body.indexOf(",");
    if (comma < 0) throw new Error("Missing BibTeX citation key");
    const data = {};
    let pos = comma + 1;
    while (pos < body.length) {
      const fieldMatch = /^\s*,?\s*([\w-]+)\s*=\s*/.exec(body.slice(pos));
      if (!fieldMatch) {
        if (!body.slice(pos).trim() || /^\s*,\s*$/.test(body.slice(pos))) break;
        throw new Error("Unsupported BibTeX field");
      }
      pos += fieldMatch[0].length;
      let value = "";
      const opener = body[pos];
      if (opener === "{" || opener === '"') {
        pos++;
        let depth = 1;
        const valueStart = pos;
        while (pos < body.length && depth > 0) {
          const ch = body[pos];
          if (ch === "\\") {
            pos += 2;
            continue;
          }
          if (opener === "{" && ch === "{") depth++;
          if (ch === (opener === "{" ? "}" : '"')) depth--;
          if (depth > 0) pos++;
        }
        if (depth !== 0) throw new Error("Unclosed BibTeX field");
        value = body.slice(valueStart, pos++);
      } else {
        const nextComma = body.indexOf(",", pos);
        const valueEnd = nextComma < 0 ? body.length : nextComma;
        value = body.slice(pos, valueEnd).trim();
        pos = valueEnd;
        if (!/^\d+$/.test(value))
          throw new Error("BibTeX macros require expanded literal values");
      }
      if (/^\s*#/.test(body.slice(pos)))
        throw new Error("BibTeX concatenation/macros require expanded values");
      data[fieldMatch[1].toLowerCase()] = unbrace(value);
    }
    result.push(
      normalizePaper({
        title: data.title,
        authors: (data.author || "").split(/\s+and\s+/i),
        journal: data.journal || data.booktitle || "",
        year: data.year || "",
        abstract: data.abstract || "",
        keywords: data.keywords || "",
        doi: data.doi || "",
        sourceUrl: data.url || "",
        notes: `BibTeX key: ${body.slice(0, comma).trim()}`,
        extraction: "Bibliographic import · 书目导入",
        verified: false,
      }),
    );
  }
  if (!result.length) throw new Error("No supported BibTeX entries");
  return result;
}
export function parseRIS(source) {
  const records = [];
  let current = null,
    lastTag = "";
  for (const line of source.replace(/\r/g, "").split("\n")) {
    const match = /^([A-Z\d]{2})\s{2}-\s?(.*)$/.exec(line);
    if (!match) {
      if (current && lastTag && line.trim())
        current[lastTag][current[lastTag].length - 1] += ` ${line.trim()}`;
      continue;
    }
    const [, tag, value] = match;
    if (tag === "TY") {
      if (current) throw new Error("RIS entry missing ER");
      current = {};
    }
    if (!current) continue;
    if (tag === "ER") {
      const one = (key) => current[key]?.[0] || "";
      records.push(
        normalizePaper({
          title: one("TI") || one("T1"),
          authors: [...(current.AU || []), ...(current.A1 || [])],
          journal: one("JO") || one("JF") || one("T2"),
          year: (one("PY") || one("Y1")).match(/\d{4}/)?.[0] || "",
          abstract: one("AB") || one("N2"),
          keywords: current.KW || [],
          doi: one("DO"),
          sourceUrl: one("UR"),
          extraction: "Bibliographic import · 书目导入",
          verified: false,
        }),
      );
      current = null;
      lastTag = "";
      continue;
    }
    (current[tag] ||= []).push(value);
    lastTag = tag;
  }
  if (current) throw new Error("RIS entry missing ER");
  if (!records.length) throw new Error("No RIS entries");
  return records;
}
export function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.format !== FORMAT ||
    manifest.schema !== SCHEMA ||
    !Array.isArray(manifest.papers) ||
    manifest.papers.length > MAX_RECORDS
  )
    throw new Error("Unsupported or oversized library manifest");
  const ids = new Set(),
    paths = new Set();
  let total = 0;
  const papers = manifest.papers.map((entry) => {
    const paper = normalizePaper(entry, { strict: true });
    if (!entry.id || ids.has(paper.id))
      throw new Error("Duplicate or missing paper ID");
    ids.add(paper.id);
    if (entry.blobPath != null) {
      if (
        !isSafeArchivePath(entry.blobPath) ||
        paths.has(entry.blobPath) ||
        !paper.hash ||
        !paper.size
      )
        throw new Error("Invalid original-file reference");
      paths.add(entry.blobPath);
      paper.blobPath = entry.blobPath;
      total += paper.size;
    }
    return paper;
  });
  if (total > MAX_TOTAL) throw new Error("Backup exceeds 200 MiB limit");
  return papers;
}
export function filteredPapers(papers, filters = {}) {
  const query = String(filters.query || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  return papers.filter((p) => {
    if (filters.journal && p.journal !== filters.journal) return false;
    if (filters.author && !p.authors.includes(filters.author)) return false;
    if (filters.year && p.year !== filters.year) return false;
    if (filters.keyword && !p.keywords.includes(filters.keyword)) return false;
    if (filters.theme && p.theme !== filters.theme) return false;
    if (filters.status === "review" && p.verified) return false;
    return (
      !query ||
      [
        p.title,
        ...p.authors,
        p.journal,
        p.abstract,
        ...p.keywords,
        p.theme,
        p.notes,
        p.doi,
        p.text,
      ]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(query)
    );
  });
}
export function groupedPapers(papers, by = "theme") {
  const groups = new Map();
  for (const paper of papers) {
    const keys =
      by === "authors" || by === "keywords"
        ? paper[by].length
          ? paper[by]
          : ["Unclassified / 未分类"]
        : [paper[by] || "Unclassified / 未分类"];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(paper);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "zh-CN"));
}
const md = (value) =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_{}[\]<>#|])/g, "\\$1");
export function reviewOutline(papers, groupBy = "theme") {
  let out = "# Literature review working outline / 文献综述工作提纲\n\n";
  out +=
    "> Metadata and abstracts are source records or unconfirmed extraction candidates. This outline does not generate findings. Verify the full text before drawing conclusions.\n> 元数据与摘要来自书目或待确认的提取候选。此提纲不生成研究结论；请阅读全文后形成判断。\n\n";
  for (const [group, items] of groupedPapers(papers, groupBy)) {
    out += `## ${md(group)}\n\n`;
    for (const p of items) {
      if (p.sourceUrl) out += `Source URL / 来源链接: ${md(p.sourceUrl)}\n\n`;
      out += `### ${md(p.title)}\n\n- Authors / 作者: ${md(p.authors.join("; ") || "[missing / 缺失]")}\n- Year / 年份: ${md(p.year || "[missing / 缺失]")}\n- Source / 刊物: ${md(p.journal || "[missing / 缺失]")}\n- DOI: ${md(p.doi || "[missing / 缺失]")}\n- Keywords / 关键词: ${md(p.keywords.join("; ") || "[missing / 缺失]")}\n- Metadata / 元数据: ${p.verified ? "User confirmed / 用户已确认" : "Needs review / 待核验"}${p.synthetic ? " · SYNTHETIC DEMO / 虚构示例" : ""}\n\n**Abstract / 摘要**\n\n${md(p.abstract || "[No abstract recorded / 未记录摘要]")}\n\n**Reading notes / 阅读笔记**\n\n${md(p.notes || "[To be written after reading / 阅读后填写]")}\n\n`;
    }
    out +=
      "**Comparison prompts / 比较问题**\n\n- [ ] What legal problem and jurisdiction does each paper address? / 各文献研究何种法律问题与法域？\n- [ ] Which methods and evidence support each claim? / 各主张采用何种方法与证据？\n- [ ] Where do definitions, arguments or evidence differ? / 定义、论证与证据有何差异？\n- [ ] Which gaps require further reading? / 哪些空白需要补充阅读？\n\n";
  }
  return out;
}
export async function sha256(data) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export const demoPapers = () => [
  normalizePaper({
    id: "demo-platform-work",
    title:
      "Platform Work and Algorithmic Management: A Synthetic Research Record",
    authors: ["Demo Author A"],
    journal: "Synthetic Social Law Review",
    year: "2025",
    abstract:
      "Educational placeholder for exploring how a researcher may compare procedural safeguards in algorithmic management. This is not a published paper and presents no real findings.",
    keywords: ["Platform labour", "Algorithmic management", "Due process"],
    theme: "Labor & platforms / 劳动与平台",
    notes: "Synthetic example. Replace with a real source before research use.",
    synthetic: true,
    extraction: "Synthetic metadata · 虚构元数据",
  }),
  normalizePaper({
    id: "demo-llm-governance",
    title: "Large Language Model Accountability: A Synthetic Research Record",
    authors: ["Demo Author B", "Demo Author C"],
    journal: "Synthetic AI Governance Journal",
    year: "2024",
    abstract:
      "Educational placeholder demonstrating metadata slicing for accountability, transparency and social protection. No publication, author identity or research conclusion is asserted.",
    keywords: ["LLM governance", "Accountability", "Social protection"],
    theme: "LLM governance / 大模型治理",
    notes: "Synthetic example, no original file attached.",
    synthetic: true,
    extraction: "Synthetic metadata · 虚构元数据",
  }),
];
