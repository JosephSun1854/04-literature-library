// Optional integration check: install playwright and pdf-lib, then run node scripts/browser-check.mjs.
// RUNTIME_MODULES can point to a directory containing those packages in a managed runtime.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import {
  zipSync,
  unzipSync,
  strToU8,
  strFromU8,
} from "../vendor/fflate/esm/browser.js";
import { normalizePaper, sha256, FORMAT, SCHEMA } from "../core.js";
const runtime = process.env.RUNTIME_MODULES;
const playwright = await import(
  runtime
    ? pathToFileURL(resolve(runtime, "playwright/index.mjs")).href
    : "playwright"
);
const pdfLib = await import(
  runtime
    ? pathToFileURL(resolve(runtime, "pdf-lib/cjs/index.js")).href
    : "pdf-lib"
);
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    !request.url().startsWith("http://127.0.0.1:4174") &&
    !request.url().startsWith("blob:")
  )
    external.push(request.url());
});
try {
  await page.goto("http://127.0.0.1:4174");
  await page.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await page.locator("#load-demo").click();
  await page.waitForFunction(
    () => document.querySelector("#stat-total").textContent === "2",
  );
  assert.equal(await page.locator(".paper-card").count(), 2);
  const text =
    "Title: Integration Sample\nAuthors: Researcher A; Researcher B\nJournal: Synthetic Test Journal\nYear: 2025\nAbstract: A synthetic paragraph for testing stored source recovery.\nKeywords: governance; labour\n";
  await page
    .locator("#file-import")
    .setInputFiles({
      name: "integration.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await page.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "1",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "1",
  );
  await page
    .getByRole("button", { name: "Integration Sample", exact: true })
    .click();
  await page.locator("#read-original").click();
  await page.locator("#text-preview").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#text-preview").textContent(),
    /source recovery/,
  );
  await page.locator('[data-close="reader"]').click();
  await page.locator('[data-close="editor"]').click();
  await page
    .locator("#file-import")
    .setInputFiles({
      name: "integration-copy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await page.waitForFunction(() => !document.body.classList.contains("busy"));
  assert.equal(await page.locator("#stat-files").textContent(), "1");
  const document = await pdfLib.PDFDocument.create();
  document.setTitle("Synthetic PDF Integration");
  document.setAuthor("Demo Author");
  document
    .addPage()
    .drawText(
      "Abstract: Synthetic PDF text for integration verification.\nKeywords: accountability; law",
    );
  const pdf = await document.save();
  await page
    .locator("#file-import")
    .setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf),
    });
  await page.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "2",
  );
  await page
    .getByRole("button", { name: "Synthetic PDF Integration", exact: true })
    .click();
  assert.match(
    await page.locator("#edit-abstract").inputValue(),
    /integration verification/,
  );
  await page.locator("#read-original").click();
  await page.locator("#pdf-canvas").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("#page-label").textContent === "1 / 1",
  );
  await page.locator('[data-close="reader"]').click();
  await page.locator('[data-close="editor"]').click();
  const backupPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const backup = await backupPromise;
  const backupPath = await backup.path();
  const backupBytes = await readFile(backupPath);
  const jsonPromise = page.waitForEvent("download");
  await page.locator("#metadata-export").click();
  const metadata = await jsonPromise;
  const metadataBytes = await readFile(await metadata.path());
  assert.equal(JSON.parse(metadataBytes).papers.length, 4);
  await page.locator("#select-all").check();
  const outlinePromise = page.waitForEvent("download");
  await page.locator("#outline").click();
  assert.match(
    await readFile(await (await outlinePromise).path(), "utf8"),
    /SYNTHETIC DEMO/,
  );
  const newContext = await browser.newContext({ acceptDownloads: true }),
    restoredPage = await newContext.newPage();
  await restoredPage.goto("http://127.0.0.1:4174");
  await restoredPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await restoredPage
    .locator("#restore")
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: backupBytes,
    });
  await restoredPage.locator("#confirm-action").click();
  await restoredPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "2",
  );
  await restoredPage.reload();
  await restoredPage.waitForFunction(
    () => document.querySelector("#stat-total").textContent === "4",
  );
  await restoredPage
    .getByRole("button", { name: "Integration Sample", exact: true })
    .click();
  await restoredPage.locator("#read-original").click();
  await restoredPage.locator("#text-preview").waitFor({ state: "visible" });
  assert.match(
    await restoredPage.locator("#text-preview").textContent(),
    /source recovery/,
  );
  await restoredPage.locator('[data-close="reader"]').click();
  await restoredPage.locator("#delete-record").click();
  await restoredPage.locator("#confirm-action").click();
  await restoredPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "1",
  );
  const metadataContext = await browser.newContext(),
    metadataPage = await metadataContext.newPage();
  await metadataPage.goto("http://127.0.0.1:4174");
  await metadataPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await metadataPage
    .locator("#restore")
    .setInputFiles({
      name: "metadata.json",
      mimeType: "application/json",
      buffer: metadataBytes,
    });
  await metadataPage.locator("#confirm-action").click();
  await metadataPage.waitForFunction(
    () => document.querySelector("#stat-total").textContent === "4",
  );
  assert.equal(await metadataPage.locator("#stat-files").textContent(), "0");
  // Link a real original to an existing metadata-only record, then replace bytes without losing the record.
  await metadataPage
    .getByRole("button", { name: "Integration Sample", exact: true })
    .click();
  await metadataPage
    .locator("#edit-sourceUrl")
    .fill("https://example.org/synthetic-source");
  await metadataPage
    .locator("#attach-import")
    .setInputFiles({
      name: "attached.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await metadataPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "1",
  );
  assert.equal(await metadataPage.locator("#stat-total").textContent(), "4");
  assert.equal(
    await metadataPage.locator("#edit-sourceUrl").inputValue(),
    "https://example.org/synthetic-source",
  );
  await metadataPage
    .locator("#attach-import")
    .setInputFiles({
      name: "replacement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text + "\nReplacement-only sentence.\n"),
    });
  await metadataPage.waitForFunction(
    () => !document.body.classList.contains("busy"),
  );
  await metadataPage.locator("#read-original").click();
  await metadataPage.locator("#text-preview").waitFor({ state: "visible" });
  assert.match(
    await metadataPage.locator("#text-preview").textContent(),
    /Replacement-only/,
  );
  // Corrupted original hashes and traversal paths fail before any library write.
  const damagedContext = await browser.newContext(),
    damagedPage = await damagedContext.newPage();
  await damagedPage.goto("http://127.0.0.1:4174");
  await damagedPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  const unpacked = unzipSync(new Uint8Array(backupBytes)),
    originalPath = Object.keys(unpacked).find((x) => x.endsWith(".txt"));
  unpacked[originalPath][0] ^= 1;
  await damagedPage
    .locator("#restore")
    .setInputFiles({
      name: "damaged.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync(unpacked, { level: 0 })),
    });
  await damagedPage.waitForFunction(
    () => !document.body.classList.contains("busy"),
  );
  assert.equal(await damagedPage.locator("#stat-total").textContent(), "0");
  assert.match(
    await damagedPage.locator("#status").textContent(),
    /mismatched original|CRC integrity/,
  );
  await damagedPage
    .locator("#restore")
    .setInputFiles({
      name: "unsafe.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipSync({ "../escape.txt": new Uint8Array([1]) }, { level: 0 }),
      ),
    });
  await damagedPage.waitForFunction(
    () => !document.body.classList.contains("busy"),
  );
  assert.equal(await damagedPage.locator("#stat-total").textContent(), "0");
  assert.match(await damagedPage.locator("#status").textContent(), /Unsafe/);
  const spoofedPath = "originals/spoofed/file.txt",
    spoofedManifest = {
      format: FORMAT,
      schema: SCHEMA,
      papers: [
        {
          ...normalizePaper({
            id: "spoofed",
            title: "Spoofed",
            fileName: "file.txt",
            mime: "text/plain",
            size: 1,
            hash: await sha256(strToU8("A")),
          }),
          blobPath: spoofedPath,
        },
      ],
    };
  const spoofedZip = zipSync(
      {
        [spoofedPath]: new Uint8Array(1024 * 1024).fill(65),
        "manifest.json": strToU8(JSON.stringify(spoofedManifest)),
      },
      { level: 6 },
    ),
    spoofView = new DataView(spoofedZip.buffer);
  let spoofCentral;
  for (let n = spoofedZip.length - 22; n >= 0; n--)
    if (spoofView.getUint32(n, true) === 0x06054b50) {
      spoofCentral = spoofView.getUint32(n + 16, true);
      break;
    }
  const spoofLocal = spoofView.getUint32(spoofCentral + 42, true);
  spoofView.setUint32(spoofCentral + 24, 1, true);
  spoofView.setUint32(spoofLocal + 22, 1, true);
  await damagedPage
    .locator("#restore")
    .setInputFiles({
      name: "spoofed-length.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(spoofedZip),
    });
  await damagedPage.waitForFunction(
    () => !document.body.classList.contains("busy"),
  );
  assert.equal(await damagedPage.locator("#stat-total").textContent(), "0");
  assert.match(
    await damagedPage.locator("#status").textContent(),
    /Actual ZIP output exceeds/,
  );
  const preservationContext = await browser.newContext({
      acceptDownloads: true,
    }),
    preservationPage = await preservationContext.newPage();
  await preservationPage.goto("http://127.0.0.1:4174");
  await preservationPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await preservationPage.locator("#file-import").setInputFiles([
    {
      name: "authors.bib",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "@article{p, title={Bib Authors}, author={Doe, Jane and Li, Ming}, year=2025}",
      ),
    },
    {
      name: "keywords.ris",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "TY  - JOUR\nTI  - RIS Keywords\nAU  - Doe, Jane\nKW  - Law, technology\nER  - ",
      ),
    },
  ]);
  await preservationPage.waitForFunction(
    () => document.querySelector("#stat-total").textContent === "2",
  );
  for (const title of ["Bib Authors", "RIS Keywords"]) {
    await preservationPage
      .getByRole("button", { name: title, exact: true })
      .click();
    await preservationPage
      .locator('#editor-form button[type="submit"]')
      .click();
    await preservationPage.locator("#editor").waitFor({ state: "hidden" });
  }
  await preservationPage
    .getByRole("button", { name: "Bib Authors", exact: true })
    .click();
  await preservationPage
    .locator("#attach-import")
    .setInputFiles({
      name: "attached-authors.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Title: Original\nAuthors: Another Candidate\nAbstract: Educational text.\n",
      ),
    });
  await preservationPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "1",
  );
  await preservationPage.locator('[data-close="editor"]').click();
  const preservedPromise = preservationPage.waitForEvent("download");
  await preservationPage.locator("#metadata-export").click();
  const preserved = JSON.parse(
    await readFile(await (await preservedPromise).path(), "utf8"),
  ).papers;
  assert.deepEqual(preserved.find((p) => p.title === "Bib Authors").authors, [
    "Doe, Jane",
    "Li, Ming",
  ]);
  assert.deepEqual(preserved.find((p) => p.title === "RIS Keywords").keywords, [
    "Law, technology",
  ]);
  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException(
        "Storage denied for integration test",
        "SecurityError",
      );
    };
  });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto("http://127.0.0.1:4174");
  await deniedPage.locator("#storage-error").waitFor({ state: "visible" });
  assert.equal(await deniedPage.locator("#file-import").isDisabled(), true);
  assert.equal(await deniedPage.locator("#stat-total").textContent(), "0");
  // Independent regression: legitimate IDs sharing eight characters must not collide in an organized export.
  const collisionEntries = {},
    collisionPapers = [];
  for (const [id, title, body] of [
    ["paper000A", "Source A", "Distinct original A"],
    ["paper000B", "Source B", "Distinct original B"],
  ]) {
    const bytes = strToU8(body),
      blobPath = `originals/${id}/paper.txt`;
    collisionEntries[blobPath] = bytes;
    collisionPapers.push({
      ...normalizePaper({
        id,
        title,
        theme: "Test",
        fileName: "paper.txt",
        mime: "text/plain",
        size: bytes.length,
        hash: await sha256(bytes),
      }),
      blobPath,
    });
  }
  collisionEntries["manifest.json"] = strToU8(
    JSON.stringify({ format: FORMAT, schema: SCHEMA, papers: collisionPapers }),
  );
  const collisionContext = await browser.newContext({ acceptDownloads: true }),
    collisionPage = await collisionContext.newPage();
  await collisionPage.goto("http://127.0.0.1:4174");
  await collisionPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await collisionPage
    .locator("#restore")
    .setInputFiles({
      name: "shared-prefix.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync(collisionEntries, { level: 0 })),
    });
  await collisionPage.locator("#confirm-action").click();
  await collisionPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "2",
  );
  await collisionPage.locator("#select-all").check();
  const organizedPromise = collisionPage.waitForEvent("download");
  await collisionPage.locator("#archive").click();
  const organizedBytes = await readFile(await (await organizedPromise).path()),
    organizedEntries = unzipSync(new Uint8Array(organizedBytes)),
    organizedManifest = JSON.parse(
      strFromU8(organizedEntries["manifest.json"]),
    );
  assert.equal(Object.keys(organizedEntries).length, 3);
  assert.notEqual(
    organizedManifest.papers[0].blobPath,
    organizedManifest.papers[1].blobPath,
  );
  const organizedContext = await browser.newContext(),
    organizedPage = await organizedContext.newPage();
  await organizedPage.goto("http://127.0.0.1:4174");
  await organizedPage.waitForFunction(
    () => !document.querySelector("#load-demo").disabled,
  );
  await organizedPage
    .locator("#restore")
    .setInputFiles({
      name: "organized.zip",
      mimeType: "application/zip",
      buffer: organizedBytes,
    });
  await organizedPage.locator("#confirm-action").click();
  await organizedPage.waitForFunction(
    () => document.querySelector("#stat-files").textContent === "2",
  );
  for (const [title, body] of [
    ["Source A", "Distinct original A"],
    ["Source B", "Distinct original B"],
  ]) {
    await organizedPage
      .getByRole("button", { name: title, exact: true })
      .click();
    await organizedPage.locator("#read-original").click();
    await organizedPage.locator("#text-preview").waitFor({ state: "visible" });
    assert.equal(
      await organizedPage.locator("#text-preview").textContent(),
      body,
    );
    await organizedPage.locator('[data-close="reader"]').click();
    await organizedPage.locator('[data-close="editor"]').click();
  }
  await page.locator("#language").click();
  await page.locator("#load-demo").waitFor({ state: "visible" });
  assert.match(await page.locator("h1").textContent(), /Turn papers/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Browser integration passed: import, persistence, duplicates, PDF parsing/rendering, full/metadata-only restore, attach/replace original, corrupted/unsafe ZIP rejection, storage denial, deletion, review export, language and mobile layout.",
  );
} catch (error) {
  console.error(
    "UI diagnostic:",
    await page.locator("#status").textContent(),
    await page.locator("#storage-error").textContent(),
    errors,
  );
  throw error;
} finally {
  await browser.close();
}
