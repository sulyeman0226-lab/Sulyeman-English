import { UserSettingKeyEnum } from "@/types/enums";

export const bookMetaOf = (audio?: AudioType | null): BookMetaType | null => {
  const book = (audio?.metadata as any)?.book;
  return book?.id ? (book as BookMetaType) : null;
};

export type BookSummary = {
  id: string;
  title: string;
  total: number;
  chapters: AudioType[]; // sorted by chapter index
};

// Group imported audios into books
export const groupBooks = (audios: AudioType[]): BookSummary[] => {
  const books = new Map<string, BookSummary>();
  for (const audio of audios) {
    const meta = bookMetaOf(audio);
    if (!meta) continue;
    if (!books.has(meta.id)) {
      books.set(meta.id, {
        id: meta.id,
        title: meta.title,
        total: meta.total,
        chapters: [],
      });
    }
    books.get(meta.id).chapters.push(audio);
  }
  for (const book of books.values()) {
    book.chapters.sort((a, b) => bookMetaOf(a).index - bookMetaOf(b).index);
  }
  return [...books.values()];
};

export const fetchBookAudios = async (
  EnjoyApp: EnjoyAppType
): Promise<AudioType[]> => {
  const audios = await EnjoyApp.audios.findAll({ limit: 100000, offset: 0 });
  return (audios || []).filter((a) => bookMetaOf(a));
};

// A chapter is ready for shadowing once the original text is aligned
export const isChapterAligned = (audio: AudioType) =>
  Boolean((audio as any).transcription?.result?.timeline);

export type BookProgress = { [bookId: string]: { audioId: string; index: number } };

export const getBookProgress = async (
  EnjoyApp: EnjoyAppType
): Promise<BookProgress> => {
  return (
    ((await EnjoyApp.userSettings.get(
      UserSettingKeyEnum.BOOK_PROGRESS
    )) as BookProgress) || {}
  );
};

export const saveBookProgress = async (
  EnjoyApp: EnjoyAppType,
  meta: BookMetaType,
  audioId: string
) => {
  const progress = await getBookProgress(EnjoyApp);
  progress[meta.id] = { audioId, index: meta.index };
  await EnjoyApp.userSettings.set(UserSettingKeyEnum.BOOK_PROGRESS, progress);
};

/*
 * Pick the EPUB TOC level whose chapter count is closest to the number of
 * audio files (prefer the deepest level on ties: audiobooks tend to be split
 * finer than the book's top-level chapters).
 */
export const pickBestLevel = (
  counts: { level: number; count: number }[],
  target: number
) => {
  let best = counts[0];
  for (const c of counts) {
    if (
      Math.abs(c.count - target) < Math.abs(best.count - target) ||
      (Math.abs(c.count - target) === Math.abs(best.count - target) &&
        c.level > best.level)
    ) {
      best = c;
    }
  }
  return best?.level;
};
