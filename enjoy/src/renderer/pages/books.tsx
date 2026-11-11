import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { t } from "i18next";
import { Button, Progress } from "@renderer/components/ui";
import {
  BookImportDialog,
  BookProgress,
  BookSummary,
  fetchBookAudios,
  getBookProgress,
  groupBooks,
  isChapterAligned,
} from "@renderer/components";
import { AppSettingsProviderContext } from "@renderer/context";
import { BookOpenIcon, LoaderIcon, PlusIcon } from "lucide-react";

export default () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [progress, setProgress] = useState<BookProgress>({});
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();

  const fetchBooks = async () => {
    setLoading(true);
    try {
      setBooks(groupBooks(await fetchBookAudios(EnjoyApp)));
      setProgress(await getBookProgress(EnjoyApp));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  return (
    <div className="min-h-full max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t("books.books")}</h1>
        <Button onClick={() => setImportOpen(true)}>
          <PlusIcon className="w-4 h-4 mr-2" />
          {t("books.importBook")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderIcon className="w-6 h-6 animate-spin" />
        </div>
      ) : books.length === 0 ? (
        <div className="text-center text-muted-foreground py-16 space-y-2">
          <BookOpenIcon className="w-10 h-10 mx-auto opacity-50" />
          <div>{t("books.noBooks")}</div>
          <div className="text-sm">{t("books.noBooksHint")}</div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => {
            const aligned = book.chapters.filter(isChapterAligned).length;
            const practiced = book.chapters.filter(
              (c) => (c.recordingsCount || 0) > 0
            ).length;
            const current = progress[book.id];
            return (
              <Link
                key={book.id}
                to={`/books/${book.id}`}
                className="border rounded-lg p-4 hover:bg-muted/50 space-y-3"
              >
                <div className="font-medium line-clamp-2">{book.title}</div>
                <div className="text-sm text-muted-foreground">
                  {t("books.chaptersSummary", {
                    count: book.chapters.length,
                    aligned,
                    practiced,
                  })}
                </div>
                <Progress value={(practiced / book.chapters.length) * 100} />
                <div className="text-xs text-muted-foreground">
                  {current
                    ? t("books.lastRead", { chapter: current.index + 1 })
                    : t("books.notStarted")}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <BookImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(bookId) => navigate(`/books/${bookId}`)}
      />
    </div>
  );
};
