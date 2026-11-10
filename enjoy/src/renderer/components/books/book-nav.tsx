import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "i18next";
import { Button } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { bookMetaOf, fetchBookAudios, saveBookProgress } from "./utils";

/*
 * Previous / next chapter for an audio imported as part of a book.
 * Opening a chapter also remembers it as the book's reading progress.
 */
export const BookNav = (props: { audio: AudioType }) => {
  const { audio } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [prev, setPrev] = useState<AudioType>();
  const [next, setNext] = useState<AudioType>();
  const navigate = useNavigate();
  const meta = bookMetaOf(audio);

  useEffect(() => {
    if (!meta) return;

    saveBookProgress(EnjoyApp, meta, audio.id).catch(console.error);
    fetchBookAudios(EnjoyApp).then((audios) => {
      const siblings = audios.filter((a) => bookMetaOf(a).id === meta.id);
      setPrev(siblings.find((a) => bookMetaOf(a).index === meta.index - 1));
      setNext(siblings.find((a) => bookMetaOf(a).index === meta.index + 1));
    });
  }, [audio?.id]);

  if (!meta) return null;

  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm text-muted-foreground">
        {t("books.chapterOf", { index: meta.index + 1, total: meta.total })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={!prev}
        onClick={() => navigate(`/audios/${prev.id}`)}
      >
        <ChevronLeftIcon className="w-4 h-4" />
        {t("books.prevChapter")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!next}
        onClick={() => navigate(`/audios/${next.id}`)}
      >
        {t("books.nextChapter")}
        <ChevronRightIcon className="w-4 h-4" />
      </Button>
    </div>
  );
};
