/*
 * Import a whole audiobook: split an EPUB into chapters (or read a folder of
 * txt files) and list the audio files, so the renderer can pair them
 * one-to-one and create one audio per chapter with its original text.
 *
 * The EPUB splitting rules are ported from epub_split.py:
 * drop the TOC page, footnotes / endnotes and their reference marks, images
 * and captions, page numbers, hidden content, and the front matter before
 * the first TOC entry. Very short chapters (e.g. a lone "Part One" heading)
 * are merged into the beginning of the next chapter, because narrators read
 * them aloud.
 */
import { ipcMain } from "electron";
import path from "path";
import fs from "fs-extra";
import unzipper from "unzipper";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { AudioFormats } from "@/constants";
import log from "@main/logger";

const logger = log.scope("book-importer");
const posixPath = path.posix;

// ------------------------------------------------------------------ rules

const SKIP_TAGS = new Set([
  "head",
  "script",
  "style",
  "title",
  "figure",
  "figcaption",
  "img",
  "svg",
  "math",
  "caption",
  "nav",
  "audio",
  "video",
  "object",
  "iframe",
  "rt",
  "rp",
]);
const VOID_TAGS = new Set([
  "img",
  "br",
  "hr",
  "meta",
  "link",
  "input",
  "col",
  "area",
  "base",
  "embed",
  "param",
  "source",
  "track",
  "wbr",
]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "table",
  "tr",
  "td",
  "th",
  "br",
  "hr",
  "body",
  "address",
  "center",
]);
const SKIP_SEMANTICS = new Set([
  "footnote",
  "footnotes",
  "endnote",
  "endnotes",
  "rearnote",
  "rearnotes",
  "note",
  "notes",
  "noteref",
  "annoref",
  "annotation",
  "pagebreak",
  "page-list",
  "toc",
  "landmarks",
  "loi",
  "lot",
  "backlink",
  "biblioref",
  "glossref",
  "index",
  "doc-footnote",
  "doc-endnote",
  "doc-endnotes",
  "doc-noteref",
  "doc-pagebreak",
  "doc-pagelist",
  "doc-toc",
  "doc-backlink",
  "doc-biblioref",
  "doc-glossref",
  "doc-index",
]);
const SKIP_CLASS_RE =
  /(foot-?note|end-?note|\bfn\b|\bfn-?note|\bfn-|\bfn\d|noteref|note-?ref|pagenum|page-?num|page-?number|page-?break|pagebreak|\bpage\b|caption|figcap|running-?head|\bhidden\b|\blnum\b|line-?num|linenum|verse-?num|versenum)/i;
const NOTE_MARK_RE =
  /^\s*[[(]?\s*(\d{1,3}|[ivxlc]{1,5}|[a-z]|[*†‡§¶#]+)\s*[\])]?\s*$/i;
const SYMBOL_MARK_RE = /^\s*[*†‡§¶#]+\s*$/;
const NON_READ_TITLES =
  /^\s*(table of contents|contents|目录|目錄|copyright|版权|版權|cover|封面)\s*$/i;

// ------------------------------------------------------------------ types

type ManifestItem = { path: string; type: string; props: string[] };
type TocEntry = { depth: number; title: string; path: string; frag: string };
type Chunk = {
  title: string;
  depth: number;
  parts: string[];
  front: boolean;
  links: number;
  linkChars: number;
  chars: number;
};

export type BookChapter = {
  title: string;
  text: string;
  words: number;
};

// ------------------------------------------------------------------ zip

type EpubFiles = Map<string, Buffer>;

let cache: { key: string; files: EpubFiles } | null = null;

const readEpubFiles = async (filePath: string): Promise<EpubFiles> => {
  const stat = await fs.stat(filePath);
  const key = `${filePath}:${stat.mtimeMs}`;
  if (cache?.key === key) return cache.files;

  const directory = await unzipper.Open.file(filePath);
  const files: EpubFiles = new Map();
  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    // Skip images / fonts / media, only text files are needed
    if (/\.(jpe?g|png|gif|webp|svg|ttf|otf|woff2?|mp3|mp4|m4a)$/i.test(entry.path))
      continue;
    files.set(entry.path, await entry.buffer());
  }
  cache = { key, files };
  return files;
};

const readText = (files: EpubFiles, p: string) =>
  files.get(p)?.toString("utf-8") ?? "";

const resolveHref = (baseDir: string, href: string) => {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // keep as is
  }
  const hashIndex = decoded.indexOf("#");
  const p = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
  const frag = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : "";
  const full = p ? posixPath.normalize(posixPath.join(baseDir, p)) : "";
  return { path: full, frag };
};

// XHTML parsed leniently: HTML entities (&nbsp;) decoded, `<a id="x"/>` closed
const HTML_OPTIONS = {
  xml: {
    xmlMode: false,
    recognizeSelfClosing: true,
    decodeEntities: true,
  },
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ package & toc

const readPackage = (files: EpubFiles) => {
  const container = cheerio.load(readText(files, "META-INF/container.xml"), { xml: true });
  const opfPath = container("rootfile").first().attr("full-path");
  if (!opfPath || !files.has(opfPath)) {
    throw new Error("Invalid EPUB: package document not found");
  }
  const opfDir = posixPath.dirname(opfPath);
  const opf = cheerio.load(readText(files, opfPath), { xml: true });

  const manifest = new Map<string, ManifestItem>();
  opf("item, opf\\:item").each((_, el) => {
    const $el = opf(el);
    manifest.set($el.attr("id"), {
      path: resolveHref(opfDir, $el.attr("href") || "").path,
      type: $el.attr("media-type") || "",
      props: ($el.attr("properties") || "").split(/\s+/).filter(Boolean),
    });
  });

  const spineEl = opf("spine, opf\\:spine").first();
  const tocId = spineEl.attr("toc");
  const spine: { idref: string; linear: boolean }[] = [];
  opf("itemref, opf\\:itemref").each((_, el) => {
    spine.push({
      idref: opf(el).attr("idref"),
      linear: opf(el).attr("linear") !== "no",
    });
  });

  const title = squash(opf("dc\\:title, title").first().text() || "");

  return { manifest, spine, tocId, title };
};

const readToc = (
  files: EpubFiles,
  manifest: Map<string, ManifestItem>,
  tocId?: string
): TocEntry[] => {
  // EPUB 3 nav document
  for (const item of manifest.values()) {
    if (!item.props.includes("nav") || !files.has(item.path)) continue;

    const $ = cheerio.load(readText(files, item.path), HTML_OPTIONS);
    const base = posixPath.dirname(item.path);
    const nav = $("nav")
      .filter((_, el) => {
        const sem = `${$(el).attr("epub:type") || ""} ${$(el).attr("role") || ""}`
          .replace("doc-toc", "toc")
          .split(/\s+/);
        return sem.includes("toc");
      })
      .first();
    const out: TocEntry[] = [];
    nav.find("a[href]").each((_, a) => {
      const depth = $(a).parents("ol").length - $(nav).parents("ol").length;
      const { path: p, frag } = resolveHref(base, $(a).attr("href"));
      out.push({ depth, title: squash($(a).text()), path: p, frag });
    });
    if (out.length) return out;
  }

  // EPUB 2 NCX
  let ncx = tocId ? manifest.get(tocId) : undefined;
  if (!ncx) {
    ncx = [...manifest.values()].find(
      (m) => m.type === "application/x-dtbncx+xml"
    );
  }
  if (!ncx || !files.has(ncx.path)) return [];

  const $ = cheerio.load(readText(files, ncx.path), { xml: true });
  const base = posixPath.dirname(ncx.path);
  const out: TocEntry[] = [];
  const walk = (parent: Element, depth: number) => {
    $(parent)
      .children("navPoint")
      .each((_, np) => {
        const label = squash(
          $(np).children("navLabel").first().find("text").text()
        );
        const src = $(np).children("content").first().attr("src") || "";
        const { path: p, frag } = resolveHref(base, src);
        out.push({ depth, title: label, path: p, frag });
        walk(np, depth + 1);
      });
  };
  $("navMap").each((_, navMap) => walk(navMap, 1));
  return out;
};

// ------------------------------------------------------------------ text extraction

const shouldSkip = (tag: string, attrs: Record<string, string>) => {
  if (SKIP_TAGS.has(tag)) return true;
  const sem = ["epub:type", "role", "type"]
    .map((k) => attrs[k] || "")
    .join(" ")
    .toLowerCase()
    .split(/\s+/);
  if (sem.some((s) => SKIP_SEMANTICS.has(s))) return true;
  if (attrs.class && SKIP_CLASS_RE.test(attrs.class)) return true;
  const style = (attrs.style || "").replace(/\s/g, "").toLowerCase();
  if (style.includes("display:none") || style.includes("visibility:hidden"))
    return true;
  if (attrs.hidden !== undefined || attrs["aria-hidden"] === "true")
    return true;
  return false;
};

/*
 * Walk one xhtml file in document order. Elements whose id is a TOC fragment
 * switch the current chunk; text goes into chunks[current].
 */
class TextExtractor {
  current: number;
  links = 0;
  linkChars = 0;
  totalChars = 0;
  private inLink = 0;
  private inPre = 0;
  private hold: string[] = [];
  private holdLink: boolean[] = [];

  constructor(
    private chunks: Chunk[],
    private boundaries: Map<string, number>,
    current: number,
    private collect: boolean
  ) {
    this.current = current;
  }

  private emit(text: string) {
    if (this.hold.length) {
      this.hold[this.hold.length - 1] += text;
      return;
    }
    if (!this.collect) return;
    this.chunks[this.current].parts.push(text);
    const n = text.trim().length;
    this.totalChars += n;
    if (this.inLink) this.linkChars += n;
  }

  private newline() {
    if (this.collect && !this.hold.length) {
      this.chunks[this.current].parts.push("\n");
    }
  }

  private checkBoundary(el: Element) {
    const id = el.attribs?.id;
    if (id && this.boundaries.has(id)) {
      this.current = this.boundaries.get(id);
    }
  }

  // Inside skipped content, only follow TOC anchors
  private scanIds(node: AnyNode) {
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style")
      return;
    const el = node as Element;
    this.checkBoundary(el);
    el.children?.forEach((c) => this.scanIds(c));
  }

  walk(node: AnyNode) {
    if (node.type === "text") {
      let data = (node as any).data as string;
      if (!this.inPre) data = data.replace(/\s+/g, " ");
      this.emit(data);
      return;
    }
    if (node.type === "root") {
      (node as any).children.forEach((c: AnyNode) => this.walk(c));
      return;
    }
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style")
      return;

    const el = node as Element;
    const tag = el.name.toLowerCase();
    const attrs = el.attribs || {};
    this.checkBoundary(el);

    if (VOID_TAGS.has(tag)) {
      if (tag === "br" || tag === "hr") this.newline();
      return;
    }
    if (shouldSkip(tag, attrs)) {
      el.children?.forEach((c) => this.scanIds(c));
      return;
    }

    let held = false;
    let countedLink = false;
    if (tag === "sup" || tag === "a") {
      const href = attrs.href || "";
      const internal = href.includes("#") && !/^(https?:|mailto:)/.test(href);
      if (tag === "sup" || internal) {
        held = true;
        this.hold.push("");
        this.holdLink.push(internal);
        // A book-internal link inside a superscript: the superscript is a note mark too
        if (internal && this.holdLink.length > 1) {
          this.holdLink[this.holdLink.length - 2] = true;
        }
      }
      if (tag === "a" && href) {
        this.inLink += 1;
        this.links += 1;
        countedLink = true;
      }
    }
    if (BLOCK_TAGS.has(tag)) this.newline();
    if (tag === "pre") this.inPre += 1;

    el.children?.forEach((c) => this.walk(c));

    if (held) {
      const text = this.hold.pop();
      const linked = this.holdLink.pop();
      const isMark =
        NOTE_MARK_RE.test(text) && (linked || SYMBOL_MARK_RE.test(text));
      if (!isMark || !text.trim()) this.emit(text);
    }
    if (countedLink && this.inLink) this.inLink -= 1;
    if (tag === "pre" && this.inPre) this.inPre -= 1;
    if (BLOCK_TAGS.has(tag)) this.newline();
  }
}

const cleanText = (raw: string) => {
  raw = raw
    .replace(/[­​﻿]/g, "")
    .replace(/[     ]/g, " ");
  const lines: string[] = [];
  for (let line of raw.split("\n")) {
    line = line.replace(/[ \t\r\f\v]+/g, " ").trim();
    if (!line) continue;
    // A page number alone on a line, like "23" or "- 23 -"
    if (/^[-–— ]*\d{1,4}[-–— ]*$/.test(line) && lines.length > 0) continue;
    // Leftover note marks like [1]
    line = line.replace(/\s?\[\d{1,3}\]/g, "");
    lines.push(line);
  }
  return lines.join("\n\n").trim() + "\n";
};

export const countWords = (text: string) => {
  const latin = (text.match(/[A-Za-zÀ-ÿ0-9'’-]+/g) || []).length;
  const cjk = (text.match(/[぀-ヿ一-鿿가-힯]/g) || [])
    .length;
  return latin + cjk;
};

// ------------------------------------------------------------------ main

export const splitEpub = async (
  filePath: string,
  options: { level?: number; minWords?: number } = {}
): Promise<{ title: string; maxDepth: number; chapters: BookChapter[] }> => {
  const { level, minWords = 40 } = options;
  const files = await readEpubFiles(filePath);
  const { manifest, spine, tocId, title } = readPackage(files);

  const spineItems: { item: ManifestItem; linear: boolean }[] = [];
  for (const { idref, linear } of spine) {
    const item = manifest.get(idref);
    if (!item || !files.has(item.path)) continue;
    if (!item.type.includes("html") && !/\.(x?html?)$/i.test(item.path))
      continue;
    spineItems.push({ item, linear });
  }
  const spinePaths = spineItems.map(({ item }) => item.path);
  const order = new Map(spinePaths.map((p, i) => [p, i]));

  const fullToc = readToc(files, manifest, tocId);
  const maxDepth = fullToc.reduce((m, e) => Math.max(m, e.depth), 0) || 1;
  const toc = level ? fullToc.filter((e) => e.depth <= level) : fullToc;

  // Only entries pointing into the spine; each position once
  const seen = new Set<string>();
  let entries: TocEntry[] = [];
  for (const e of toc) {
    if (!order.has(e.path)) continue;
    const key = `${e.path}#${e.frag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  // Sort by position in the book (stable: keeps TOC order within a file)
  entries = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => order.get(a.e.path) - order.get(b.e.path) || a.i - b.i)
    .map(({ e }) => e);

  if (!entries.length) {
    // No TOC: one chapter per spine file
    entries = spinePaths.map((p) => ({ depth: 1, title: "", path: p, frag: "" }));
  }

  // chunks[0] holds what comes before the first TOC entry (cover, copyright…)
  const newChunk = (t: string, depth: number, front = false): Chunk => ({
    title: t,
    depth,
    parts: [],
    front,
    links: 0,
    linkChars: 0,
    chars: 0,
  });
  const chunks: Chunk[] = [newChunk("", 0, true)];
  const fileStarts = new Map<string, number>();
  const fileFrags = new Map<string, Map<string, number>>();
  for (const e of entries) {
    chunks.push(newChunk(e.title, e.depth));
    const ci = chunks.length - 1;
    if (e.frag) {
      if (!fileFrags.has(e.path)) fileFrags.set(e.path, new Map());
      fileFrags.get(e.path).set(e.frag, ci);
    } else if (!fileStarts.has(e.path)) {
      fileStarts.set(e.path, ci);
    }
  }

  const navPaths = new Set(
    [...manifest.values()].filter((m) => m.props.includes("nav")).map((m) => m.path)
  );
  let current = 0;
  for (const { item, linear } of spineItems) {
    if (fileStarts.has(item.path)) current = fileStarts.get(item.path);
    const before = current;
    // TOC page / non-linear pages (cover, pop-up notes): only move the pointer
    const skipFile = navPaths.has(item.path) || !linear;
    const extractor = new TextExtractor(
      chunks,
      fileFrags.get(item.path) || new Map(),
      current,
      !skipFile
    );
    const $ = cheerio.load(readText(files, item.path), HTML_OPTIONS);
    extractor.walk($.root()[0] as AnyNode);
    current = extractor.current;
    if (!skipFile) {
      chunks[before].links += extractor.links;
      chunks[before].linkChars += extractor.linkChars;
      chunks[before].chars += extractor.totalChars;
    }
  }

  const chapters: BookChapter[] = [];
  let carryTitles: string[] = [];
  let carryText = "";
  chunks.forEach((c, i) => {
    const text = cleanText(c.parts.join(""));
    const n = countWords(text);
    // A page that is mostly links is a table of contents
    const looksToc =
      c.links >= 5 && c.chars > 0 && c.linkChars / c.chars > 0.6;
    if (c.front) return;
    if (looksToc || NON_READ_TITLES.test(c.title || "")) return;
    if (n === 0) {
      if (c.title) carryTitles.push(c.title);
      return;
    }
    if (n < minWords && i < chunks.length - 1) {
      // Too short (e.g. just "Part One"): merge into the next chapter
      carryTitles.push(c.title);
      carryText += text + "\n";
      return;
    }
    const full = carryText + text;
    chapters.push({
      title: c.title || text.split("\n")[0].slice(0, 60),
      text: full,
      words: countWords(full),
    });
    carryTitles = [];
    carryText = "";
  });
  if (carryText.trim()) {
    chapters.push({
      title: carryTitles.filter(Boolean).join(" / ") || "End",
      text: carryText,
      words: countWords(carryText),
    });
  }

  return {
    title: title || path.basename(filePath, path.extname(filePath)),
    maxDepth,
    chapters,
  };
};

const naturalSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export const listAudioFiles = async (dir: string) => {
  const names = await fs.readdir(dir);
  return names
    .filter(
      (n) =>
        !n.startsWith(".") &&
        AudioFormats.includes(path.extname(n).slice(1).toLowerCase())
    )
    .sort(naturalSort)
    .map((n) => ({ name: n, path: path.join(dir, n) }));
};

/*
 * A folder of txt files, one per audio (e.g. the output of epub_split.py).
 * Index files like "00_章节清单.txt" or "000 - 对应清单.txt" are skipped.
 */
export const readTextFolder = async (dir: string): Promise<BookChapter[]> => {
  const names = (await fs.readdir(dir))
    .filter((n) => !n.startsWith(".") && /\.txt$/i.test(n))
    .filter((n) => !/清单|清單/.test(n) && !/^0+[\s_\-.]/.test(n))
    .sort(naturalSort);
  const chapters: BookChapter[] = [];
  for (const n of names) {
    const text = (await fs.readFile(path.join(dir, n), "utf-8")).replace(
      /^﻿/,
      ""
    );
    chapters.push({
      title: path
        .basename(n, path.extname(n))
        .replace(/^\d+\s*[-_.]\s*/, "")
        .trim(),
      text,
      words: countWords(text),
    });
  }
  return chapters;
};

export default {
  registerIpcHandlers() {
    ipcMain.handle(
      "books-split-epub",
      async (_event, filePath: string, options?: { level?: number }) => {
        try {
          return await splitEpub(filePath, options);
        } catch (err) {
          logger.error("Failed to split EPUB", err);
          throw err;
        }
      }
    );
    ipcMain.handle("books-list-audio-files", (_event, dir: string) =>
      listAudioFiles(dir)
    );
    ipcMain.handle("books-read-text-folder", (_event, dir: string) =>
      readTextFolder(dir)
    );
  },
};
