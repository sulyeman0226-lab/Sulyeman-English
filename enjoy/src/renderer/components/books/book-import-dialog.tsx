import { useContext, useMemo, useRef, useState } from "react";
import { t } from "i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { AudioFormats } from "@/constants";
import { pickBestLevel } from "./utils";
import { FolderOpenIcon, FileTextIcon, AlertTriangleIcon } from "lucide-react";

type AudioFile = { name: string; path: string };

/*
 * Import a whole audiobook: one folder of audio files + the book's text
 * (an EPUB split by its TOC, or a folder of txt files), paired in order.
 * Each pair becomes one audio with the chapter text as its original text,
 * so the transcription step only needs to align the text to the audio.
 */
export const BookImportDialog = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (bookId: string) => void;
}) => {
  const { open, onOpenChange, onImported } = props;
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);

  const [source, setSource] = useState<"epub" | "txt">("epub");
  const [audioDir, setAudioDir] = useState("");
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [textPath, setTextPath] = useState("");
  const [title, setTitle] = useState("");
  const [chapters, setChapters] = useState<BookChapterType[]>([]);
  const [levels, setLevels] = useState<{ level: number; count: number }[]>([]);
  const [level, setLevel] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelled = useRef(false);

  const reset = () => {
    setAudioDir("");
    setAudioFiles([]);
    setTextPath("");
    setTitle("");
    setChapters([]);
    setLevels([]);
    setLevel(undefined);
    setProgress(0);
  };

  const pairCount = Math.min(audioFiles.length, chapters.length);
  const mismatch =
    audioFiles.length > 0 &&
    chapters.length > 0 &&
    audioFiles.length !== chapters.length;

  const pickFolder = async () => {
    const selected = await EnjoyApp.dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return selected?.[0];
  };

  const loadEpub = async (
    epubPath: string,
    lvl?: number,
    audioCount = audioFiles.length
  ) => {
    setLoading(true);
    try {
      let result = await EnjoyApp.books.splitEpub(epubPath, { level: lvl });
      if (lvl === undefined) {
        // First load: count chapters at every TOC level, pick the closest
        const counts = [];
        for (let l = 1; l <= result.maxDepth; l++) {
          const r =
            l === result.maxDepth
              ? result
              : await EnjoyApp.books.splitEpub(epubPath, { level: l });
          counts.push({ level: l, count: r.chapters.length });
        }
        setLevels(counts);
        const best = audioCount
          ? pickBestLevel(counts, audioCount)
          : result.maxDepth;
        if (best !== result.maxDepth) {
          result = await EnjoyApp.books.splitEpub(epubPath, { level: best });
        }
        lvl = best;
      }
      setLevel(lvl);
      setChapters(result.chapters);
      if (!title) setTitle(result.title);
    } catch (err) {
      toast.error(t("books.failedToReadEpub", { error: err.message }));
    } finally {
      setLoading(false);
    }
  };

  const selectAudioDir = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    const files = await EnjoyApp.books.listAudioFiles(dir);
    if (!files.length) {
      toast.error(
        t("books.noAudioFilesFound", { formats: AudioFormats.join(", ") })
      );
      return;
    }
    setAudioDir(dir);
    setAudioFiles(files);
    if (!title) setTitle(dir.split(/[\\/]/).filter(Boolean).pop());
    // Re-pick the EPUB level for the new number of audio files
    if (source === "epub" && textPath && levels.length) {
      const best = pickBestLevel(levels, files.length);
      if (best !== level) loadEpub(textPath, best, files.length);
    }
  };

  const selectText = async () => {
    if (source === "epub") {
      const selected = await EnjoyApp.dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (!selected?.[0]) return;
      setTextPath(selected[0]);
      setLevels([]);
      loadEpub(selected[0]);
    } else {
      const dir = await pickFolder();
      if (!dir) return;
      setLoading(true);
      try {
        const list = await EnjoyApp.books.readTextFolder(dir);
        if (!list.length) {
          toast.error(t("books.noTxtFilesFound"));
          return;
        }
        setTextPath(dir);
        setChapters(list);
      } finally {
        setLoading(false);
      }
    }
  };

  const startImport = async () => {
    if (!pairCount) return;
    const bookId = crypto.randomUUID();
    const bookTitle = title.trim() || t("books.untitled");
    cancelled.current = false;
    setImporting(true);
    setProgress(0);

    let failed = 0;
    for (let i = 0; i < pairCount; i++) {
      if (cancelled.current) break;
      const file = audioFiles[i];
      const chapter = chapters[i];
      try {
        const name = `${String(i + 1).padStart(
          String(pairCount).length,
          "0"
        )} ${chapter.title || file.name}`;
        const audio = await EnjoyApp.audios.create(file.path, {
          name,
          originalText: chapter.text,
          // Audiobook files are already compressed; keep them as they are
          compressing: false,
        });

        const book: BookMetaType = {
          id: bookId,
          title: bookTitle,
          index: i,
          total: pairCount,
          chapterTitle: chapter.title,
        };
        await EnjoyApp.audios.update(audio.id, {
          name,
          language: audio.language || learningLanguage,
          metadata: { ...((audio.metadata as any) || {}), book },
        });
      } catch (err) {
        failed += 1;
        console.error(err);
        toast.error(`${file.name}: ${err.message}`);
      }
      setProgress(Math.round(((i + 1) / pairCount) * 100));
    }

    setImporting(false);
    if (failed) {
      toast.warning(t("books.importedWithErrors", { failed }));
    } else {
      toast.success(t("books.imported", { count: pairCount }));
    }
    onOpenChange(false);
    reset();
    onImported?.(bookId);
  };

  const rows = useMemo(() => {
    const n = Math.max(audioFiles.length, chapters.length);
    return Array.from({ length: n }, (_, i) => ({
      audio: audioFiles[i],
      chapter: chapters[i],
    }));
  }, [audioFiles, chapters]);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (importing) return;
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90%] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("books.importBook")}</DialogTitle>
          <DialogDescription>{t("books.importBookDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("books.audioFolder")}</Label>
            <div className="flex items-center space-x-2">
              <Button
                variant="secondary"
                disabled={importing}
                onClick={selectAudioDir}
              >
                <FolderOpenIcon className="w-4 h-4 mr-2" />
                {t("books.selectFolder")}
              </Button>
              <span className="text-sm text-muted-foreground truncate">
                {audioDir
                  ? t("books.audioFilesFound", {
                      count: audioFiles.length,
                      dir: audioDir,
                    })
                  : t("books.audioFolderHint")}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("books.bookText")}</Label>
            <Tabs
              value={source}
              onValueChange={(value) => {
                setSource(value as "epub" | "txt");
                setTextPath("");
                setChapters([]);
                setLevels([]);
              }}
            >
              <TabsList>
                <TabsTrigger value="epub" disabled={importing}>
                  EPUB
                </TabsTrigger>
                <TabsTrigger value="txt" disabled={importing}>
                  {t("books.txtFolder")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center space-x-2">
              <Button
                variant="secondary"
                disabled={importing || loading}
                onClick={selectText}
              >
                <FileTextIcon className="w-4 h-4 mr-2" />
                {source === "epub"
                  ? t("books.selectEpub")
                  : t("books.selectFolder")}
              </Button>
              <span className="text-sm text-muted-foreground truncate">
                {loading
                  ? t("books.reading")
                  : textPath
                  ? t("books.chaptersFound", {
                      count: chapters.length,
                      path: textPath,
                    })
                  : source === "epub"
                  ? t("books.epubHint")
                  : t("books.txtFolderHint")}
              </span>
            </div>
            {source === "epub" && levels.length > 1 && (
              <div className="flex items-center space-x-2">
                <span className="text-sm">{t("books.tocLevel")}</span>
                <Select
                  value={level ? String(level) : undefined}
                  disabled={importing || loading}
                  onValueChange={(value) => loadEpub(textPath, parseInt(value))}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((l) => (
                      <SelectItem key={l.level} value={String(l.level)}>
                        {t("books.tocLevelOption", {
                          level: l.level,
                          count: l.count,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("books.title")}</Label>
            <Input
              value={title}
              disabled={importing}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {mismatch && (
            <div className="flex items-start space-x-2 text-sm text-yellow-600">
              <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {t("books.countMismatch", {
                  audios: audioFiles.length,
                  chapters: chapters.length,
                  pairs: pairCount,
                })}
              </span>
            </div>
          )}

          {rows.length > 0 && (
            <ScrollArea className="h-72 border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2 w-12">#</th>
                    <th className="p-2">{t("books.audioFile")}</th>
                    <th className="p-2">{t("books.chapter")}</th>
                    <th className="p-2 w-20 text-right">{t("books.words")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-t ${
                        row.audio && row.chapter ? "" : "opacity-40"
                      }`}
                    >
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2 break-all">{row.audio?.name || "—"}</td>
                      <td className="p-2">
                        <div className="line-clamp-1">
                          {row.chapter?.title || "—"}
                        </div>
                        {row.chapter && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {row.chapter.text.slice(0, 100)}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {row.chapter?.words ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}

          {importing && (
            <div className="space-y-1">
              <Progress value={progress} />
              <div className="text-sm text-muted-foreground">
                {t("books.importing", { progress })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {importing ? (
            <Button
              variant="secondary"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              {t("cancel")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
          )}
          <Button disabled={!pairCount || importing || loading} onClick={startImport}>
            {t("books.importChapters", { count: pairCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
