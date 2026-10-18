/**
 * Self-update for the sideloaded APK: check GitHub Releases for a build
 * newer than the installed one, download the .apk, and hand it to the
 * Android package installer. Browsers have no installer, so web callers
 * fall back to downloading the asset link.
 *
 * The release workflow mints tags as `v<version>-<versionCode>` and attaches
 * `opencode-remote-<version>-<versionCode>.apk` — the versionCode is the only
 * comparand that matters (Android refuses to install a same-or-older code).
 */

import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const RELEASES_API =
  'https://api.github.com/repos/yassine808/opencode-remote-control/releases?per_page=30';
const TAG_PATTERN = /^v(\d+\.\d+\.\d+)-(\d+)$/;

export interface UpdateInfo {
  /** e.g. "1.1.0" */
  version: string;
  /** Android versionCode — the value actually compared. */
  versionCode: number;
  /** Release tag, e.g. "v1.1.0-2". */
  tag: string;
  apkUrl: string;
  sizeBytes: number;
  notes: string;
  publishedAt: string;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
  published_at: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

export function installedVersion(): string {
  return Constants.expoConfig?.version ?? 'dev';
}

export function installedVersionCode(): number {
  const code = Constants.expoConfig?.android?.versionCode;
  return typeof code === 'number' && Number.isFinite(code) && code > 0 ? code : 0;
}

/**
 * The newest published release with an APK asset, or null when the installed
 * build is already at least that new. Throws only when GitHub is unreachable
 * or answers with an error.
 */
export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateInfo | null> {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub replied HTTP ${res.status}`);

  const releases = (await res.json()) as GithubRelease[];
  let best: UpdateInfo | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const match = TAG_PATTERN.exec(release.tag_name);
    if (!match) continue;
    const asset = release.assets.find((a) => a.name.endsWith('.apk'));
    if (!asset) continue;
    const versionCode = Number(match[2]);
    if (!best || versionCode > best.versionCode) {
      best = {
        version: match[1],
        versionCode,
        tag: release.tag_name,
        apkUrl: asset.browser_download_url,
        sizeBytes: asset.size,
        notes: (release.body ?? '').trim(),
        publishedAt: release.published_at,
      };
    }
  }

  if (!best || best.versionCode <= installedVersionCode()) return null;
  return best;
}

/** Download the APK into the cache directory; resolves with its file:// URI. */
export async function downloadUpdate(
  info: UpdateInfo,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No writable storage for the download');

  const target = `${dir}ocrc-${info.tag}.apk`;
  const task = FileSystem.createDownloadResumable(info.apkUrl, target, {}, (p) => {
    const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : info.sizeBytes;
    if (total > 0) onProgress?.(Math.min(1, p.totalBytesWritten / total));
  });

  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('The download did not complete');
  return result.uri;
}

/**
 * Hand the downloaded APK to the system installer. Android shows its own
 * confirmation (and, once, the "install unknown apps" toggle for this app).
 */
export async function installUpdate(localUri: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('APK install is Android-only');
  const contentUri = await FileSystem.getContentUriAsync(localUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
