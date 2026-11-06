import { t } from "i18next";
import { useContext, useState } from "react";
import { Switch } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";

/*
 * Local mode: use the app without the Enjoy server.
 * Pronunciation assessment, Azure TTS and Azure transcription use the user's
 * own Azure Speech key; AI features use the OpenAI-compatible settings.
 */
export const LocalModeSettings = () => {
  const { localMode, setLocalMode } = useContext(AppSettingsProviderContext);
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex items-start justify-between py-4">
      <div className="">
        <div className="mb-2">{t("localMode")}</div>
        <div className="text-sm text-muted-foreground">
          {t("localModeDescription")}
        </div>
      </div>

      <div className="">
        <Switch
          disabled={saving}
          checked={Boolean(localMode)}
          onCheckedChange={(checked) => {
            setSaving(true);
            setLocalMode(checked).finally(() => setSaving(false));
          }}
        />
      </div>
    </div>
  );
};
