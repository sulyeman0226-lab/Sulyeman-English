import {
  useParams,
  useSearchParams,
  Link,
  useNavigate,
} from "react-router-dom";
import { AudioPlayer, BookNav, bookMetaOf } from "@renderer/components";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@renderer/components/ui";
import { t } from "i18next";
import { MediaShadowProvider } from "@renderer/context";
import { useState } from "react";

export default () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const segmentIndex = searchParams.get("segmentIndex") || "0";
  const [audio, setAudio] = useState<AudioType | null>(null);
  const navigate = useNavigate();
  const book = bookMetaOf(audio);

  return (
    <div className="h-content flex flex-col relative max-w-full">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <Breadcrumb>
          <BreadcrumbList>
            {book ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={`/books`}>{t("books.books")}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={`/books/${book.id}`}>{book.title}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={`/audios`}>{t("sidebar.audios")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {book?.chapterTitle || audio?.name || t("shadowingAudio")}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {audio && <BookNav audio={audio} />}
      </div>

      <div className="flex-1">
        <MediaShadowProvider
          key={id}
          onCancel={() => navigate(book ? `/books/${book.id}` : "/audios")}
        >
          <AudioPlayer
            id={id}
            segmentIndex={parseInt(segmentIndex)}
            onLoad={setAudio}
          />
        </MediaShadowProvider>
      </div>
    </div>
  );
};
