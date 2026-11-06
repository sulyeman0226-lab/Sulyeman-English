import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import {
  Button,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
  Input,
  toast,
} from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { useContext, useState } from "react";

/*
 * Own Azure Speech key, used for pronunciation assessment, Azure TTS and
 * Azure transcription instead of the Enjoy server.
 */
export const AzureSpeechSettings = () => {
  const { EnjoyApp, azureSpeech, setAzureSpeech } = useContext(
    AppSettingsProviderContext
  );
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);

  const schema = z.object({
    key: z.string().optional(),
    region: z.string().optional(),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      key: azureSpeech?.key || "",
      region: azureSpeech?.region || "",
    },
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    const key = (data.key || "").trim();
    const region = (data.region || "").trim();

    if (key && region) {
      setTesting(true);
      try {
        await EnjoyApp.azureSpeech.issueToken(key, region);
      } catch (err) {
        toast.error(t("azureSpeechKeyInvalid", { error: err.message }));
        return;
      } finally {
        setTesting(false);
      }
    }

    await setAzureSpeech(key && region ? { key, region } : null);
    setEditing(false);
    toast.success(t("azureSpeechConfigSaved"));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="">
            <div className="mb-2">Azure Speech</div>
            <div className="text-sm text-muted-foreground space-y-3">
              <div>{t("azureSpeechDescription")}</div>
              <FormField
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">{t("key")}:</FormLabel>
                      <Input
                        disabled={!editing}
                        type="password"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("azureRegion")}:
                      </FormLabel>
                      <Input
                        disabled={!editing}
                        placeholder="eastasia"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormDescription>
                      {t("azureRegionDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div>
                {azureSpeech
                  ? t("azureSpeechInUse")
                  : t("azureSpeechNotConfigured")}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant={editing ? "outline" : "secondary"}
              size="sm"
              type="reset"
              onClick={(event) => {
                event.preventDefault();
                form.reset();
                setEditing(!editing);
              }}
            >
              {editing ? t("cancel") : t("edit")}
            </Button>
            <Button
              className={editing ? "" : "hidden"}
              size="sm"
              type="submit"
              disabled={testing}
            >
              {testing ? t("azureSpeechTesting") : t("save")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
