import { useContext, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { t } from "i18next";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
} from "@renderer/components/ui";
import {
  BookSummary,
  bookMetaOf,
  fetchBookAudios,
  getBookProgress,
  groupBooks,
  isChapterAligned,
} from "@renderer/components";
import { AppSettingsProviderContext } from "@renderer/context";
import { LoaderIcon, PlayIcon } from "lucide-react";
import { secondsToTimestamp } from "@renderer/lib/utils";

export default () => {
  const { id } = useParams<{ id: string }>();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [book, setBook] = useState<BookSummary | null>(null);
  const [currentAudioId, setCurrentAudioId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchBook = async () => {
    setLoading(true);
    try {
      const books = groupBooks(await fetchBookAudios(EnjoyApp));
      setBook(books.find((b) => b.id === id) || null);
      setCurrentAudioId((await getBookProgress(EnjoyApp))[id]?.audioId);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBook();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoaderIcon className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="text-center text-muted-foreground py-16">
        {t("books.bookNotFound")}
      </div>
    );
  }

  const current =
    book.chapters.find((c) => c.id === currentAudioId) || book.chapters[0];

  return (
    <div className="min-h-full max-w-5xl mx-auto px-4 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/books">{t("books.books")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{book.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{book.title}</h1>
        {current && (
          <Button onClick={() => navigate(`/audios/${current.id}`)}>
            <PlayIcon className="w-4 h-4 mr-2" />
            {currentAudioId
              ? t("books.continueReading", {
                  chapter: bookMetaOf(current).index + 1,
                })
              : t("books.startReading")}
          </Button>
        )}
      </div>

      <div className="border rounded-lg divide-y">
        {book.chapters.map((audio) => {
          const meta = bookMetaOf(audio);
          const isCurrent = audio.id === currentAudioId;
          return (
            <Link
              key={audio.id}
              to={`/audios/${audio.id}`}
              className={`flex items-center px-4 py-3 hover:bg-muted/50 ${
                isCurrent ? "bg-muted" : ""
              }`}
            >
              <div className="w-12 text-sm text-muted-foreground">
                {meta.index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="line-clamp-1">
                  {meta.chapterTitle || audio.name}
                </div>
              </div>
              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                {audio.duration ? (
                  <span>{secondsToTimestamp(audio.duration)}</span>
                ) : null}
                {isCurrent && <Badge>{t("books.current")}</Badge>}
                {isChapterAligned(audio) ? (
                  <Badge variant="secondary">{t("books.aligned")}</Badge>
                ) : (
                  <Badge variant="outline">{t("books.notAligned")}</Badge>
                )}
                {(audio.recordingsCount || 0) > 0 && (
                  <Badge variant="secondary">
                    {t("books.recordings", { count: audio.recordingsCount })}
                  </Badge>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
