import {
  FORMAT,
  SCHEMA,
  MAX_FILE,
  MAX_TOTAL,
  MAX_RECORDS,
  normalizePaper,
  missingFields,
  extractTextMetadata,
  parseBibTeX,
  parseRIS,
  validateManifest,
  filteredPapers,
  groupedPapers,
  reviewOutline,
  safeSegment,
  originalArchivePath,
  splitList,
  splitEditedList,
  sha256,
  demoPapers,
} from "./core.js";
import {
  openDatabase,
  listPapers,
  saveRecords,
  getOriginal,
  removePaper,
} from "./storage.js";
import { zipSync, strToU8, strFromU8 } from "./vendor/fflate/esm/browser.js";
import { unpackArchive } from "./archives.js";
import * as pdfjs from "./vendor/pdfjs/build/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdfjs/build/pdf.worker.mjs",
  import.meta.url,
).href;
const pdfOptions = {
  cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL(
    "./vendor/pdfjs/standard_fonts/",
    import.meta.url,
  ).href,
  wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
  isEvalSupported: false,
  disableFontFace: true,
};
const $ = (id) => document.getElementById(id);
let lang = "zh",
  papers = [],
  selected = new Set(),
  editing = null,
  available = false,
  busy = false,
  pdfDocument = null,
  readerPage = 1,
  readerGeneration = 0,
  readerTask = null;
const messages = {
  en: {
    skip: "Skip to library",
    title: "Turn papers into research paths.",
    subtitle:
      "Organize papers by journal, author, keyword and research theme. Keep the originals and build your literature review in law and AI.",
    local: "Saved locally · No account",
    demo: "Load synthetic examples",
    papers: "papers in library",
    originals: "original files",
    needsReview: "metadata to review",
    storedBytes: "local original files",
    collect: "Collect papers",
    drop: "Drop files to begin",
    choose: "Choose files",
    candidateNotice:
      "Extraction produces candidates: check against the original. Scanned PDFs need OCR elsewhere. Bibliographic imports do not include originals.",
    addRecord: "+ Add a paper manually",
    backupTitle: "Backup & portability",
    backupNotice:
      "Originals live in this browser. Clearing site data deletes the library. Export a full ZIP backup regularly.",
    backup: "Export full backup ZIP",
    metadataExport: "Export metadata JSON",
    restore: "Import backup / metadata",
    persist: "Request persistent storage",
    method: "Research method",
    methodNotice:
      "Map social law, algorithmic management and LLM regulation. Metadata helps locate sources; research judgments require full-text reading.",
    methodLink: "Methods & limitations ↗",
    browse: "Explore your collection",
    searchLabel: "Search papers",
    searchPlaceholder:
      "Search title, author, abstract, keywords or extracted text",
    theme: "Research theme",
    journal: "Journal / source",
    authors: "Authors",
    year: "Year",
    keywords: "Keywords",
    verification: "Verification",
    all: "All",
    groupBy: "Group by",
    reset: "Clear filters",
    selectVisible: "Select filtered papers",
    outline: "Review outline ↓",
    archive: "Organized files ZIP ↓",
    readingList: "Reading list ↓",
    footer: "Local processing · Traceable sources · Human review",
    edit: "Paper details",
    paperTitle: "Paper title",
    abstract: "Abstract",
    notes: "Reading notes / research questions",
    confirmMetadata:
      "I checked and confirmed these metadata against the source",
    save: "Save paper",
    read: "Read original",
    download: "Download original",
    delete: "Delete paper",
    reader: "Read original",
    previous: "Previous page",
    next: "Next page",
    confirm: "Confirm",
    cancel: "Cancel",
    emptyTitle: "A reading collection starts with one paper.",
    emptyText:
      "Import a PDF or text file, add a bibliographic record, or explore the clearly marked synthetic examples.",
    noResults: "No papers match these filters.",
    confirmed: "User confirmed",
    unconfirmed: "Needs review",
    synthetic: "Synthetic example",
    metadataOnly: "Metadata only · no original",
    fileStored: "Original stored",
    missing: "Missing fields",
    details: "Details",
    saved: "Saved in this browser.",
    saving: "Saving…",
    working: "Working…",
    storageFailure:
      "Local storage could not be opened. Your files have not been saved. Check browser privacy/storage settings and reload.",
    error: "Operation failed",
    noSelection: "Select papers first.",
    originalsMissing: "No original file attached.",
    deleteHeading: "Delete this paper?",
    deleteMessage:
      "Its metadata and locally stored original will be removed. Export a backup first if you need to keep them.",
    importComplete: "Imported",
    duplicates: "duplicate originals skipped",
    persistenceYes: "Persistent storage granted. Keep backups as well.",
    persistenceNo:
      "Persistent storage was not granted. Please keep regular ZIP backups.",
    restoreHeading: "Merge this backup into your library?",
    restoreNotice:
      "Existing records are kept. New IDs are assigned where needed. Exact duplicate originals are skipped.",
    restoreMetadata: "Metadata only: original files will not be restored.",
    demoLoaded:
      "Synthetic metadata examples added. They are not published papers.",
    limits: "Up to 1,000 records, 40 MiB per file, 200 MiB total originals.",
    reviewCandidates:
      "Extraction candidates, confidence not scored; manual verification required.",
    selected: "selected",
    found: "matching papers",
    importUnsupported: "Unsupported file type",
    tooLarge: "File exceeds 40 MiB",
    pdfLimited: "PDF: first 12 pages extracted; remaining pages not indexed.",
    pdfAll: "PDF: all pages extracted.",
    pdfUnavailable:
      "PDF text extraction unavailable; original is retained. It may be scanned, encrypted or unsupported.",
    readLoading: "Loading original…",
    capacity:
      "Library capacity exceeded. Export a backup and remove unused papers.",
    backupDone: "Full backup exported, including stored original bytes.",
    metadataDone: "Metadata exported; original bytes are not included.",
    organizedDone:
      "Selected originals exported. See manifest.json for metadata and missing originals.",
    outlineDone:
      "Review outline exported. Abstracts and notes require your source verification.",
    restored: "Backup merged successfully.",
    storageUsed: "Browser storage used",
    storageQuota: "quota",
    attach: "Attach original",
    attaching: "Choose a PDF/TXT/MD to attach in the library import area.",
    readingDone: "Reading list exported for 03 Research Roadmap.",
    missingPdf:
      "No text found. Scanned pages need OCR; no abstract or authors have been inferred.",
    reviewWarning:
      "Not all metadata have been confirmed. The outline marks this explicitly.",
  },
  zh: {
    skip: "跳至文献库",
    title: "把文献，变成研究线索。",
    subtitle:
      "按期刊、作者、关键词与研究主题整理文献，保留文件原件，逐步搭建你的法学与 AI 文献综述。",
    local: "本地保存 · 无需注册",
    demo: "载入虚构示例",
    papers: "篇文献",
    originals: "份原件",
    needsReview: "待确认元数据",
    storedBytes: "本地文件占用",
    collect: "收集文献",
    drop: "拖入文件，开始归档",
    choose: "选择文件",
    candidateNotice:
      "提取结果为候选信息，请与原文核对。扫描 PDF 暂不支持 OCR；书目导入不含论文原件。",
    addRecord: "＋ 手工添加文献",
    backupTitle: "备份与迁移",
    backupNotice:
      "原件仅保存在当前浏览器；清理网站数据会删除文献库。请定期导出完整 ZIP 备份。",
    backup: "导出完整备份 ZIP",
    metadataExport: "导出元数据 JSON",
    restore: "导入备份 / 元数据",
    persist: "申请持久保存",
    method: "研究方法",
    methodNotice:
      "围绕社会法、算法管理与大模型规制构建文献脉络。分类与摘要帮助定位材料，研究判断仍需阅读全文。",
    methodLink: "阅读方法与边界 ↗",
    browse: "文献切片",
    searchLabel: "搜索文献",
    searchPlaceholder: "搜索标题、作者、摘要、关键词或全文",
    theme: "研究主题",
    journal: "期刊 / 来源",
    authors: "作者",
    year: "年份",
    keywords: "关键词",
    verification: "确认状态",
    all: "全部",
    groupBy: "分组",
    reset: "清除筛选",
    selectVisible: "选择筛选结果",
    outline: "综述提纲 ↓",
    archive: "分类原件 ZIP ↓",
    readingList: "阅读清单 ↓",
    footer: "本地处理 · 保留出处 · 人工核验",
    edit: "文献详情",
    paperTitle: "论文题名",
    abstract: "摘要",
    notes: "阅读笔记 / 研究问题",
    confirmMetadata: "我已与原文核对并确认这些元数据",
    save: "保存文献",
    read: "阅读原件",
    download: "下载原件",
    delete: "删除文献",
    reader: "原文阅读",
    previous: "上一页",
    next: "下一页",
    confirm: "确认",
    cancel: "取消",
    emptyTitle: "从一篇论文，开始建立研究脉络。",
    emptyText:
      "导入 PDF 或文本文件，添加书目记录，或浏览明确标注为虚构的教学示例。",
    noResults: "没有符合当前筛选条件的文献。",
    confirmed: "人工已确认",
    unconfirmed: "待核验",
    synthetic: "虚构示例",
    metadataOnly: "仅元数据 · 无原件",
    fileStored: "原件已保存",
    missing: "缺失字段",
    details: "详情",
    saved: "已保存至当前浏览器。",
    saving: "正在保存…",
    working: "正在处理…",
    storageFailure:
      "无法打开本地存储，文件尚未保存。请检查浏览器隐私 / 存储设置后重新载入。",
    error: "操作失败",
    noSelection: "请先选择文献。",
    originalsMissing: "此记录尚未附带原件。",
    deleteHeading: "删除这篇文献？",
    deleteMessage: "其元数据和本地原件将被删除。如需保留，请先导出备份。",
    importComplete: "已导入",
    duplicates: "份重复原件已跳过",
    persistenceYes: "浏览器已授予持久存储；仍建议定期备份。",
    persistenceNo: "浏览器未授予持久存储。请定期导出完整 ZIP 备份。",
    restoreHeading: "将备份合并至文献库？",
    restoreNotice: "保留已有记录，必要时重新分配 ID，跳过完全重复的原件。",
    restoreMetadata: "仅元数据：不会还原论文原件。",
    demoLoaded: "已加入虚构的元数据示例，它们不是已发表论文。",
    limits: "最多 1,000 条记录，单个文件 40 MiB，原件总计 200 MiB。",
    reviewCandidates: "提取信息为候选，未作置信度评分；需要人工核验。",
    selected: "篇已选",
    found: "篇匹配",
    importUnsupported: "不支持此文件类型",
    tooLarge: "文件超过 40 MiB",
    pdfLimited: "PDF：已提取前 12 页，其余页面未建立全文索引。",
    pdfAll: "PDF：已提取全部页面。",
    pdfUnavailable:
      "无法提取 PDF 文本；保留原件。可能为扫描、加密或不受支持的文件。",
    readLoading: "正在读取原件…",
    capacity: "超出文献库容量。请先备份并删除不再需要的文献。",
    backupDone: "完整备份已导出，包含已保存的原件字节。",
    metadataDone: "元数据已导出，不包含论文原件。",
    organizedDone: "已导出所选原件；manifest.json 记录元数据与缺失原件。",
    outlineDone: "综述提纲已导出，摘要与笔记仍需你与原文核对。",
    restored: "备份已成功合并。",
    storageUsed: "浏览器存储已用",
    storageQuota: "配额",
    attach: "附加原件",
    attaching: "请通过导入区域选择 PDF / TXT / MD 文件。",
    readingDone: "已导出可供 03 研究规划导入的阅读清单。",
    missingPdf: "未发现文本。扫描页面需另行 OCR；未推断作者或摘要。",
    reviewWarning: "部分元数据尚未确认，提纲中已明确标注。",
  },
};
messages.en.sourceUrl = "Source URL";
messages.zh.sourceUrl = "来源链接";
messages.en.attachFile = "Save & attach / replace original";
messages.zh.attachFile = "保存并附加 / 替换原件";
messages.en.attachNotice =
  "Link a file to this record. Keep recorded metadata, fill gaps with extraction candidates and reset verification. Back up the previous original before replacing it.";
messages.zh.attachNotice =
  "将原件关联到当前书目；已有元数据保留，空缺项填入提取候选，确认状态重置。替换前请备份原件。";
const t = (key) => messages[lang][key] || key;
function element(tag, text = "", className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function notify(message, error = false) {
  $("status").textContent = message;
  $("status").hidden = false;
  $("status").classList.toggle("error", error);
  clearTimeout(notify.timer);
  notify.timer = setTimeout(
    () => {
      $("status").hidden = true;
    },
    error ? 16000 : 7000,
  );
}
function handleError(error) {
  console.error(error);
  notify(`${t("error")}: ${error?.message || error}. ${t("limits")}`, true);
}
function setBusy(value) {
  busy = value;
  document.body.classList.toggle("busy", value);
  for (const el of document.querySelectorAll("button,input[type=file]"))
    el.disabled =
      value || (!available && !["language", "confirm-cancel"].includes(el.id));
  if (!value) updateSelection();
}
async function operation(work) {
  if (busy || !available) return;
  setBusy(true);
  try {
    await work();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}
function setLanguage() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  $("language").textContent = lang === "zh" ? "English" : "中文";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.placeholder);
  });
  refreshFilters();
  render();
  storageEstimate();
}
function filters() {
  return {
    query: $("search").value,
    theme: $("filter-theme").value,
    journal: $("filter-journal").value,
    author: $("filter-author").value,
    year: $("filter-year").value,
    keyword: $("filter-keyword").value,
    status: $("filter-status").value,
  };
}
function visiblePapers() {
  return filteredPapers(papers, filters()).sort(
    (a, b) =>
      b.year.localeCompare(a.year) || a.title.localeCompare(b.title, "zh-CN"),
  );
}
function refreshFilters() {
  for (const [id, key] of [
    ["theme", "theme"],
    ["journal", "journal"],
    ["author", "authors"],
    ["year", "year"],
    ["keyword", "keywords"],
  ]) {
    const select = $(`filter-${id}`),
      value = select.value;
    const options = [
      ...new Set(
        papers
          .flatMap((p) => (Array.isArray(p[key]) ? p[key] : [p[key]]))
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-CN"));
    select.replaceChildren(
      new Option(t("all"), ""),
      ...options.map((value) => new Option(value, value)),
    );
    select.value = options.includes(value) ? value : "";
  }
}
function updateSelection() {
  const visible = visiblePapers();
  $("selection-count").textContent = `${selected.size} ${t("selected")}`;
  $("select-all").checked =
    visible.length > 0 && visible.every((p) => selected.has(p.id));
  $("select-all").indeterminate =
    visible.some((p) => selected.has(p.id)) && !$("select-all").checked;
  for (const id of ["outline", "archive", "reading-list"])
    $(id).disabled = busy || !selected.size || !available;
}
function render() {
  $("stat-total").textContent = papers.length;
  $("stat-files").textContent = papers.filter((p) => p.size > 0).length;
  $("stat-review").textContent = papers.filter((p) => !p.verified).length;
  $("stat-size").textContent =
    `${(papers.reduce((s, p) => s + p.size, 0) / 1024 / 1024).toFixed(1)} MB`;
  const visible = visiblePapers();
  $("result-count").textContent = `${visible.length} ${t("found")}`;
  const root = $("results");
  root.replaceChildren();
  if (!visible.length) {
    const empty = element("div", "", "empty");
    empty.append(
      element("p", "▤", "empty-symbol"),
      element("h3", papers.length ? t("noResults") : t("emptyTitle")),
      element("p", papers.length ? "" : t("emptyText")),
    );
    root.append(empty);
  }
  for (const [group, items] of groupedPapers(visible, $("group-by").value)) {
    const section = element("section", "", "paper-group"),
      heading = element("h3", group, "group-heading");
    heading.append(element("span", items.length, "badge"));
    section.append(heading);
    for (const p of items) {
      const card = element("article", "", "card paper-card"),
        heading = element("div", "", "paper-heading"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(p.id);
      checkbox.setAttribute("aria-label", `${t("selectVisible")}: ${p.title}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? selected.add(p.id) : selected.delete(p.id);
        render();
      });
      const titleBlock = element("div"),
        title = element("button", p.title, "title-button");
      title.addEventListener("click", () => editPaper(p.id));
      const h3 = element("h3");
      h3.append(title);
      titleBlock.append(
        h3,
        element(
          "div",
          [p.authors.join("; ") || "—", p.year || "—", p.journal || "—"].join(
            " · ",
          ),
          "paper-source",
        ),
      );
      heading.append(checkbox, titleBlock);
      card.append(heading);
      const labels = element("div", "", "paper-labels");
      labels.append(
        element(
          "span",
          p.verified ? t("confirmed") : t("unconfirmed"),
          `badge ${p.verified ? "" : "warning"}`,
        ),
        element("span", p.size ? t("fileStored") : t("metadataOnly"), "badge"),
      );
      if (p.synthetic)
        labels.append(element("span", t("synthetic"), "badge warning"));
      card.append(labels);
      card.append(element("p", p.abstract || "—", "paper-abstract"));
      const tags = element("div", "", "chip-list paper-tags");
      p.keywords
        .slice(0, 8)
        .forEach((k) => tags.append(element("span", k, "tag")));
      card.append(tags);
      const missing = missingFields(p);
      if (missing.length)
        card.append(
          element(
            "p",
            `${t("missing")}: ${missing.map((k) => t(k)).join(" · ")}`,
            "missing-notice",
          ),
        );
      const bottom = element("div", "", "paper-bottom");
      bottom.append(
        element(
          "small",
          p.fileName || (p.doi ? `DOI: ${p.doi}` : t("metadataOnly")),
        ),
      );
      const actions = element("div", "", "actions"),
        details = element("button", t("details"));
      details.addEventListener("click", () => editPaper(p.id));
      actions.append(details);
      if (p.size) {
        const read = element("button", t("read"));
        read.addEventListener("click", () => readOriginal(p));
        actions.append(read);
      }
      bottom.append(actions);
      card.append(bottom);
      section.append(card);
    }
    root.append(section);
  }
  updateSelection();
}
async function reload() {
  papers = await listPapers();
  const ids = new Set(papers.map((p) => p.id));
  selected = new Set([...selected].filter((id) => ids.has(id)));
  refreshFilters();
  render();
  await storageEstimate();
}
async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.();
    $("storage-estimate").textContent = est
      ? `${t("storageUsed")}: ${(est.usage / 1024 / 1024).toFixed(1)} MB / ${t("storageQuota")}: ${(est.quota / 1024 / 1024).toFixed(0)} MB`
      : t("limits");
  } catch {
    $("storage-estimate").textContent = t("limits");
  }
}
function download(data, name, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function manifest(records) {
  return {
    format: FORMAT,
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    papers: records,
  };
}
function capacityCheck(records) {
  const combined = new Map(papers.map((p) => [p.id, p]));
  for (const record of records) combined.set(record.id, record);
  if (
    combined.size > MAX_RECORDS ||
    [...combined.values()].reduce((s, p) => s + p.size, 0) > MAX_TOTAL
  )
    throw new Error(t("capacity"));
}
async function extractPDF(file, data) {
  let document;
  try {
    document = await pdfjs.getDocument({ data: data.slice(0), ...pdfOptions })
      .promise;
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    let text = "";
    for (let n = 1; n <= Math.min(document.numPages, 12); n++) {
      const page = await document.getPage(n),
        content = await page.getTextContent();
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      text += "\n\n";
      page.cleanup();
    }
    const paper = extractTextMetadata(text, file.name),
      info = metadata.info || {};
    if (info.Title && !/^(untitled|document|microsoft)/i.test(info.Title))
      paper.title = info.Title.slice(0, 3000);
    if (info.Author) paper.authors = splitList(info.Author);
    if (info.Keywords && !paper.keywords.length)
      paper.keywords = splitList(info.Keywords);
    paper.pages = document.numPages;
    paper.extraction = document.numPages > 12 ? t("pdfLimited") : t("pdfAll");
    if (!text.trim()) {
      paper.title = file.name.replace(/\.pdf$/i, "");
      paper.extraction = t("missingPdf");
    }
    return paper;
  } catch {
    return normalizePaper({
      title: file.name.replace(/\.pdf$/i, ""),
      fileName: file.name,
      extraction: t("pdfUnavailable"),
    });
  } finally {
    if (document) await document.loadingTask.destroy();
  }
}
async function importFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  await operation(async () => {
    notify(t("working"));
    const records = [],
      originals = new Map(),
      hashes = new Set(papers.map((p) => p.hash).filter(Boolean));
    let duplicates = 0;
    for (const file of files) {
      if (file.size > MAX_FILE)
        throw new Error(`${file.name}: ${t("tooLarge")}`);
      if (!file.size) throw new Error(`${file.name}: empty file / 空文件`);
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "bib" || ext === "ris") {
        const parsed =
          ext === "bib"
            ? parseBibTeX(await file.text())
            : parseRIS(await file.text());
        records.push(...parsed);
        continue;
      }
      if (!["pdf", "txt", "md"].includes(ext))
        throw new Error(`${file.name}: ${t("importUnsupported")}`);
      const data = await file.arrayBuffer(),
        hash = await sha256(data);
      if (hashes.has(hash)) {
        duplicates++;
        continue;
      }
      hashes.add(hash);
      const paper =
        ext === "pdf"
          ? await extractPDF(file, data)
          : extractTextMetadata(await file.text(), file.name);
      Object.assign(paper, {
        id: crypto.randomUUID(),
        hash,
        fileName: file.name,
        size: file.size,
        mime:
          ext === "pdf"
            ? "application/pdf"
            : ext === "md"
              ? "text/markdown"
              : "text/plain",
        verified: false,
      });
      records.push(paper);
      originals.set(paper.id, new Blob([data], { type: paper.mime }));
    }
    capacityCheck(records);
    if (records.length) await saveRecords(records, originals);
    await reload();
    notify(
      `${t("importComplete")}: ${records.length}; ${duplicates} ${t("duplicates")}. ${records.length ? t("reviewCandidates") : ""}`,
    );
  });
}
function editPaper(id = null) {
  editing = id ? papers.find((p) => p.id === id) : normalizePaper({});
  if (!editing) return;
  $("editor-form").reset();
  for (const key of [
    "title",
    "authors",
    "journal",
    "year",
    "doi",
    "sourceUrl",
    "keywords",
    "theme",
    "abstract",
    "notes",
  ])
    $("editor-form").elements[key].value = Array.isArray(editing[key])
      ? editing[key].join("; ")
      : editing[key] || "";
  $("editor-form").elements.verified.checked = editing.verified;
  $("editor-info").textContent = [
    editing.extraction || t("reviewCandidates"),
    editing.fileName || t("metadataOnly"),
    editing.synthetic ? t("synthetic") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  $("read-original").disabled = $("download-original").disabled = !editing.size;
  $("delete-record").hidden = !id;
  $("editor-error").textContent = "";
  $("editor").showModal();
}
$("editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !available) return;
  const data = new FormData(event.target);
  const updated = normalizePaper(
    {
      ...editing,
      ...Object.fromEntries(data.entries()),
      authors: splitEditedList(data.get("authors")),
      keywords: splitEditedList(data.get("keywords")),
      verified: data.get("verified") === "on",
      updatedAt: new Date().toISOString(),
    },
    { strict: true },
  );
  await operation(async () => {
    notify(t("saving"));
    if (!papers.some((p) => p.id === updated.id)) capacityCheck([updated]);
    await saveRecords([updated]);
    $("editor").close();
    await reload();
    notify(t("saved"));
  });
});
function confirmAction(heading, message) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-heading").textContent = heading;
    $("confirm-message").textContent = message;
    const finish = (value) => {
      dialog.close();
      $("confirm-action").removeEventListener("click", yes);
      $("confirm-cancel").removeEventListener("click", no);
      dialog.removeEventListener("cancel", cancel);
      resolve(value);
    };
    const yes = () => finish(true),
      no = () => finish(false),
      cancel = (event) => {
        event.preventDefault();
        finish(false);
      };
    $("confirm-action").addEventListener("click", yes);
    $("confirm-cancel").addEventListener("click", no);
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
    // Confirmation remains usable while an import is prepared; dependent writes await the decision.
    $("confirm-action").disabled = $("confirm-cancel").disabled = false;
  });
}
$("delete-record").addEventListener("click", async () => {
  const record = editing;
  if (!record) return;
  if (await confirmAction(t("deleteHeading"), t("deleteMessage")))
    await operation(async () => {
      await removePaper(record.id);
      selected.delete(record.id);
      $("editor").close();
      await reload();
      notify(t("saved"));
    });
});
$("download-original").addEventListener("click", () =>
  operation(async () => {
    const blob = await getOriginal(editing.id);
    if (!blob) throw new Error(t("originalsMissing"));
    download(blob, safeSegment(editing.fileName, "original"));
  }),
);
$("read-original").addEventListener("click", () => readOriginal(editing));
$("attach-import").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !editing || !$("editor-form").reportValidity()) return;
  const previous = editing,
    data = new FormData($("editor-form"));
  await operation(async () => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "txt", "md"].includes(ext))
      throw new Error(t("importUnsupported"));
    if (!file.size || file.size > MAX_FILE) throw new Error(t("tooLarge"));
    notify(t("working"));
    const bytes = await file.arrayBuffer(),
      hash = await sha256(bytes);
    if (papers.some((p) => p.id !== previous.id && p.hash === hash))
      throw new Error(t("duplicates"));
    const candidates =
      ext === "pdf"
        ? await extractPDF(file, bytes)
        : extractTextMetadata(await file.text(), file.name);
    const updated = normalizePaper(
      {
        ...previous,
        ...Object.fromEntries(data.entries()),
        authors: splitEditedList(data.get("authors")),
        keywords: splitEditedList(data.get("keywords")),
        verified: false,
        updatedAt: new Date().toISOString(),
      },
      { strict: true },
    );
    for (const key of [
      "title",
      "authors",
      "journal",
      "year",
      "doi",
      "sourceUrl",
      "abstract",
      "keywords",
    ])
      if (!updated[key]?.length || updated[key] === "Untitled / 未命名")
        updated[key] = candidates[key];
    Object.assign(updated, {
      text: candidates.text,
      extraction: candidates.extraction,
      pages: candidates.pages,
      size: file.size,
      hash,
      fileName: file.name,
      mime:
        ext === "pdf"
          ? "application/pdf"
          : ext === "md"
            ? "text/markdown"
            : "text/plain",
    });
    capacityCheck([updated]);
    await saveRecords(
      [updated],
      new Map([[updated.id, new Blob([bytes], { type: updated.mime })]]),
    );
    await reload();
    editPaper(updated.id);
    notify(t("saved"));
  });
});
async function readOriginal(paper) {
  const generation = ++readerGeneration;
  $("reader").showModal();
  $("reader-title").textContent = paper.title;
  $("reader-status").textContent = t("readLoading");
  $("pdf-canvas").hidden =
    $("text-preview").hidden =
    $("pdf-toolbar").hidden =
      true;
  try {
    if (readerTask) await readerTask.cancel();
    if (pdfDocument) {
      await pdfDocument.loadingTask.destroy();
      pdfDocument = null;
    }
    const blob = await getOriginal(paper.id);
    if (!blob) throw new Error(t("originalsMissing"));
    if (generation !== readerGeneration) return;
    if (paper.mime === "application/pdf") {
      const loaded = await pdfjs.getDocument({
        data: await blob.arrayBuffer(),
        ...pdfOptions,
      }).promise;
      if (generation !== readerGeneration) {
        await loaded.loadingTask.destroy();
        return;
      }
      pdfDocument = loaded;
      readerPage = 1;
      $("pdf-toolbar").hidden = false;
      await renderPage(generation);
    } else {
      $("text-preview").textContent = (await blob.text()).slice(0, 1000000);
      $("text-preview").hidden = false;
    }
    if (generation === readerGeneration) $("reader-status").textContent = "";
  } catch (error) {
    if (generation === readerGeneration)
      $("reader-status").textContent =
        `${t("error")}: ${error.message}. ${t("download")}`;
  }
}
async function renderPage(generation = readerGeneration) {
  if (!pdfDocument) return;
  $("previous-page").disabled = $("next-page").disabled = true;
  try {
    const page = await pdfDocument.getPage(readerPage);
    if (generation !== readerGeneration) return;
    const width = Math.min(780, $("reader").clientWidth - 60),
      base = page.getViewport({ scale: 1 }),
      viewport = page.getViewport({ scale: Math.min(2, width / base.width) }),
      canvas = $("pdf-canvas");
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.hidden = false;
    readerTask = page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    await readerTask.promise;
    readerTask = null;
    $("page-label").textContent = `${readerPage} / ${pdfDocument.numPages}`;
  } catch (error) {
    if (error.name !== "RenderingCancelledException")
      $("reader-status").textContent = error.message;
  } finally {
    if (generation === readerGeneration && pdfDocument) {
      $("previous-page").disabled = readerPage <= 1;
      $("next-page").disabled = readerPage >= pdfDocument.numPages;
    }
  }
}
$("previous-page").addEventListener("click", async () => {
  if (readerPage > 1) {
    readerPage--;
    await renderPage();
  }
});
$("next-page").addEventListener("click", async () => {
  if (pdfDocument && readerPage < pdfDocument.numPages) {
    readerPage++;
    await renderPage();
  }
});
$("reader").addEventListener("close", () => {
  readerGeneration++;
  if (readerTask) {
    readerTask.cancel();
    readerTask = null;
  }
  if (pdfDocument) {
    pdfDocument.loadingTask.destroy();
    pdfDocument = null;
  }
});
async function exportArchive(records, backup = false) {
  if (!backup && !records.length) throw new Error(t("noSelection"));
  const entries = {},
    output = [];
  const groupBy = ["theme", "journal"].includes($("group-by").value)
    ? $("group-by").value
    : "theme";
  for (const paper of records) {
    const record = { ...paper };
    if (!backup) delete record.text;
    if (paper.size) {
      const blob = await getOriginal(paper.id);
      if (!blob) throw new Error(`${paper.title}: ${t("originalsMissing")}`);
      const path = originalArchivePath(paper, { backup, groupBy });
      if (Object.hasOwn(entries, path))
        throw new Error(`Export path collision: ${path}`);
      entries[path] = new Uint8Array(await blob.arrayBuffer());
      record.blobPath = path;
    }
    output.push(record);
  }
  const data = {
    ...manifest(output),
    mode: backup ? "full-backup" : "organized-export",
    groupBy,
  };
  entries["manifest.json"] = strToU8(JSON.stringify(data, null, 2));
  // Stored compression avoids recompressing PDF streams and keeps exports predictable.
  download(
    zipSync(entries, { level: 0 }),
    backup
      ? "literature-library-backup.zip"
      : "literature-library-organized.zip",
    "application/zip",
  );
  notify(backup ? t("backupDone") : t("organizedDone"));
}
async function importBackup(file) {
  if (!file) return;
  await operation(async () => {
    if (file.size > MAX_TOTAL + 55 * 1024 * 1024)
      throw new Error("Backup exceeds safe import size");
    notify(t("working"));
    let records,
      originals = new Map(),
      metadataOnly = false;
    if (file.name.toLowerCase().endsWith(".json")) {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("Metadata JSON exceeds 50 MiB");
      records = validateManifest(JSON.parse(await file.text()));
      metadataOnly = true;
      records = records.map((record) =>
        normalizePaper({
          ...record,
          size: 0,
          hash: "",
          fileName: "",
          mime: "",
          pages: 0,
          extraction: `${record.extraction} · ${t("restoreMetadata")}`,
        }),
      );
    } else if (file.name.toLowerCase().endsWith(".zip")) {
      const entries = unpackArchive(new Uint8Array(await file.arrayBuffer())),
        data = JSON.parse(strFromU8(entries["manifest.json"]));
      records = validateManifest(data);
      const expected = new Set(["manifest.json"]);
      for (const record of records) {
        if (record.size && !record.blobPath)
          throw new Error("Missing original path in backup");
        if (record.blobPath) {
          const bytes = entries[record.blobPath];
          if (
            !bytes ||
            bytes.length !== record.size ||
            (await sha256(bytes)) !== record.hash
          )
            throw new Error(
              `Missing, damaged or mismatched original: ${record.fileName}`,
            );
          originals.set(record.id, new Blob([bytes], { type: record.mime }));
          expected.add(record.blobPath);
          delete record.blobPath;
        }
      }
      for (const path of Object.keys(entries))
        if (!expected.has(path))
          throw new Error("ZIP contains unreferenced files");
    } else throw new Error("Choose a library ZIP or JSON export");
    if (
      !(await confirmAction(
        t("restoreHeading"),
        `${records.length} ${t("papers")}. ${t("restoreNotice")} ${metadataOnly ? t("restoreMetadata") : ""}`,
      ))
    )
      return;
    const existingIds = new Set(papers.map((p) => p.id)),
      hashes = new Set(papers.map((p) => p.hash).filter(Boolean)),
      kept = [],
      remapped = new Map();
    let duplicates = 0;
    for (const record of records) {
      if (record.hash && hashes.has(record.hash)) {
        duplicates++;
        continue;
      }
      if (record.hash) hashes.add(record.hash);
      const previousId = record.id;
      if (existingIds.has(record.id)) record.id = crypto.randomUUID();
      existingIds.add(record.id);
      if (originals.has(previousId))
        remapped.set(record.id, originals.get(previousId));
      kept.push(record);
    }
    capacityCheck(kept);
    if (kept.length) await saveRecords(kept, remapped);
    await reload();
    notify(
      `${t("restored")} ${kept.length} ${t("papers")}; ${duplicates} ${t("duplicates")}. ${metadataOnly ? t("restoreMetadata") : ""}`,
    );
  });
}
function chosenPapers() {
  return papers.filter((p) => selected.has(p.id));
}
$("backup").addEventListener("click", () =>
  operation(() => exportArchive(papers, true)),
);
$("metadata-export").addEventListener("click", () => {
  download(
    JSON.stringify(
      manifest(
        papers.map((p) => {
          const copy = { ...p };
          delete copy.text;
          return copy;
        }),
      ),
      null,
      2,
    ),
    "literature-library-metadata.json",
    "application/json",
  );
  notify(t("metadataDone"));
});
$("outline").addEventListener("click", () => {
  const records = chosenPapers();
  if (!records.length) return notify(t("noSelection"));
  download(
    reviewOutline(records, $("group-by").value),
    "literature-review-outline.md",
    "text/markdown",
  );
  notify(
    `${t("outlineDone")} ${records.some((p) => !p.verified) ? t("reviewWarning") : ""}`,
  );
});
$("archive").addEventListener("click", () =>
  operation(() => exportArchive(chosenPapers(), false)),
);
$("reading-list").addEventListener("click", () => {
  const records = chosenPapers();
  if (!records.length) return;
  download(
    JSON.stringify(
      {
        format: "law-ai-reading-list",
        version: 1,
        papers: records.map((p) => ({
          id: p.id,
          title: p.title,
          authors: p.authors,
          year: p.year,
          journal: p.journal,
          doi: p.doi,
          sourceUrl:
            p.sourceUrl || (p.doi ? `https://doi.org/${encodeURI(p.doi)}` : ""),
          keywords: p.keywords,
          themes: p.theme ? [p.theme] : [],
          abstract: p.abstract,
          verified: p.verified,
          synthetic: p.synthetic,
        })),
      },
      null,
      2,
    ),
    "law-ai-reading-list.json",
    "application/json",
  );
  notify(t("readingDone"));
});
$("restore").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  importBackup(file);
});
$("file-import").addEventListener("change", (event) => {
  const files = Array.from(event.target.files);
  event.target.value = "";
  importFiles(files);
});
$("drop-zone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("drop-zone").classList.add("dragging");
});
$("drop-zone").addEventListener("dragleave", () =>
  $("drop-zone").classList.remove("dragging"),
);
$("drop-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("drop-zone").classList.remove("dragging");
  importFiles(event.dataTransfer.files);
});
$("language").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  setLanguage();
});
$("add-record").addEventListener("click", () => editPaper());
$("load-demo").addEventListener("click", () =>
  operation(async () => {
    const ids = new Set(papers.map((p) => p.id)),
      records = demoPapers().filter((p) => !ids.has(p.id));
    capacityCheck(records);
    if (records.length) await saveRecords(records);
    await reload();
    notify(t("demoLoaded"));
  }),
);
$("persistent").addEventListener("click", () =>
  operation(async () =>
    notify(
      (await navigator.storage?.persist?.())
        ? t("persistenceYes")
        : t("persistenceNo"),
    ),
  ),
);
for (const id of [
  "search",
  "filter-theme",
  "filter-journal",
  "filter-author",
  "filter-year",
  "filter-keyword",
  "filter-status",
  "group-by",
])
  $(id).addEventListener(id === "search" ? "input" : "change", render);
$("reset").addEventListener("click", () => {
  for (const id of [
    "search",
    "filter-theme",
    "filter-journal",
    "filter-author",
    "filter-year",
    "filter-keyword",
    "filter-status",
  ])
    $(id).value = "";
  render();
});
$("select-all").addEventListener("change", (event) => {
  for (const p of visiblePapers())
    event.target.checked ? selected.add(p.id) : selected.delete(p.id);
  render();
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => $(button.dataset.close).close()),
  );
try {
  await openDatabase();
  available = true;
  await reload();
  setLanguage();
  setBusy(false);
} catch (error) {
  $("storage-error").hidden = false;
  $("storage-error").textContent = `${t("storageFailure")} ${error.message}`;
  setBusy(false);
  render();
}
