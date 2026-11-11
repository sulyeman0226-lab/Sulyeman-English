import { ipcMain, net } from "electron";
import log from "@main/logger";

const logger = log.scope("AZURE_TOKEN");

// Azure tokens are valid for 10 minutes; reuse them for 8 minutes.
const TOKEN_TTL = 8 * 60 * 1000;

let cached: { key: string; region: string; token: string; at: number } | null =
  null;

/*
 * Exchange the user's own Azure Speech key for a short-lived token,
 * so the rest of the app keeps using `SpeechConfig.fromAuthorizationToken`
 * without going through the Enjoy server.
 */
export const issueAzureSpeechToken = async (
  key: string,
  region: string
): Promise<{ token: string; region: string }> => {
  key = (key || "").trim();
  region = (region || "").trim();
  if (!key || !region) {
    throw new Error("Azure Speech key and region are required");
  }

  if (
    cached &&
    cached.key === key &&
    cached.region === region &&
    Date.now() - cached.at < TOKEN_TTL
  ) {
    return { token: cached.token, region };
  }

  const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const res = await net.fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Length": "0",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("Failed to issue Azure speech token", res.status, body);
    throw new Error(
      `Azure Speech token request failed (${res.status}): ${body || res.statusText}`
    );
  }

  const token = await res.text();
  cached = { key, region, token, at: Date.now() };
  return { token, region };
};

export default {
  registerIpcHandlers() {
    ipcMain.handle(
      "azure-speech-issue-token",
      (_event, key: string, region: string) => {
        return issueAzureSpeechToken(key, region);
      }
    );
  },
};
