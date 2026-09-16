import type { CropRect, WallpaperKind, WallpaperSettings } from './wallpaper';

/** One file in the server's backgrounds folder. */
export interface BackgroundFile {
  name: string;
  kind: 'image' | 'video' | 'scene';
  bytes: number;
}

/** How the administrator wants their background framed and lit. */
export interface BackgroundOptions {
  crop: CropRect;
  blur: number;
  dim: number;
  /** Scenes only: play it, or show one composited frame. */
  dynamic: boolean;
  /** The theme's own background takes two colours; empty means the theme's. */
  auroraA: string;
  auroraB: string;
}

/** The administrator's default background, as the server describes it. */
export interface AdminBackground {
  configured: boolean;
  /** `aurora` is the theme's own background; null when nothing is set. */
  kind: 'aurora' | 'image' | 'video' | 'scene' | null;
  file: string | null;
  bytes: number;
  /** Content hash of the file, as the server reports it. */
  hash: string | null;
  /** Where the layer loads the file from. */
  url: string;
  note: string | null;
  options: BackgroundOptions;
  /** Everything in the folder, so the settings dialog can offer it. */
  available: BackgroundFile[];
}

/**
 * The wallpaper the layer should actually show.
 *
 * The administrator's background is an overlay rather than a replacement: the
 * user's own choice stays in their settings untouched, so turning the switch
 * off gives it straight back. While it is showing, though, everything the
 * layer reads comes from the administrator - which kind it is, how it is
 * framed, how dark the scrim is, and whether a scene animates - because that
 * is the look they are setting for everybody.
 */
export function shownWallpaper(settings: WallpaperSettings, admin: AdminBackground | null): WallpaperSettings {
  if (!settings.useAdminBackground || admin?.configured !== true) return settings;
  if (admin.kind === 'aurora') {
    return { ...settings, kind: 'none', source: 'url', url: '', auroraA: admin.options.auroraA, auroraB: admin.options.auroraB };
  }
  if (!admin.kind) return settings;
  return {
    ...settings,
    kind: admin.kind as WallpaperKind,
    source: 'url',
    url: admin.url,
    crop: admin.options.crop,
    blur: admin.options.blur,
    dim: admin.options.dim,
    dynamicScene: admin.options.dynamic,
  };
}