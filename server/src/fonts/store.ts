import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('fonts');

export interface FontRecord {
  id: string;
  /** Display name, also used as the CSS family. */
  name: string;
  fileName: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
  size: number;
  uploadedAt: string;
}

export interface FontSelection {
  /** Font id used for the interface, empty for the built-in stack. */
  sans: string;
  /** Font id used for the editor and code, empty for the built-in stack. */
  mono: string;
}

const EXTENSIONS: Record<string, { format: FontRecord['format']; type: string }> = {
  '.woff2': { format: 'woff2', type: 'font/woff2' },
  '.woff': { format: 'woff', type: 'font/woff' },
  '.ttf': { format: 'truetype', type: 'font/ttf' },
  '.otf': { format: 'opentype', type: 'font/otf' },
};

export const MAX_FONT_BYTES = 32 * 1024 * 1024;

/**
 * Fonts uploaded by an administrator.
 *
 * They live next to the other runtime data (not in OpenList): they are an asset
 * of this installation, and they have to survive a restart, which a plain
 * upload into memory would not.
 */
export class FontStore {
  private readonly dir: string;
  private readonly indexFile: string;
  private records: FontRecord[] = [];
  private selection: FontSelection = { sans: '', mono: '' };

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'fonts');
    this.indexFile = path.join(this.dir, 'index.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as {
        fonts?: FontRecord[];
        selection?: FontSelection;
      };
      this.records = (raw.fonts ?? []).filter((font) => fs.existsSync(path.join(this.dir, font.fileName)));
      this.selection = { sans: raw.selection?.sans ?? '', mono: raw.selection?.mono ?? '' };
      log.debug(`${this.records.length} font(s) restored`);
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ fonts: this.records, selection: this.selection }, null, 2), 'utf8');
    fs.renameSync(tmp, this.indexFile);
  }

  list(): { fonts: FontRecord[]; selection: FontSelection } {
    return { fonts: [...this.records].sort((a, b) => a.name.localeCompare(b.name)), selection: { ...this.selection } };
  }

  get(id: string): FontRecord | undefined {
    return this.records.find((font) => font.id === id);
  }

  filePath(record: FontRecord): string {
    return path.join(this.dir, record.fileName);
  }

  contentType(record: FontRecord): string {
    return EXTENSIONS[path.extname(record.fileName).toLowerCase()]?.type ?? 'application/octet-stream';
  }

  /** Validates an upload without writing anything. */
  static classify(fileName: string): { format: FontRecord['format']; extension: string } | null {
    const extension = path.extname(fileName).toLowerCase();
    const entry = EXTENSIONS[extension];
    return entry ? { format: entry.format, extension } : null;
  }

  add(input: { name: string; fileName: string; data: Buffer }): FontRecord {
    const classified = FontStore.classify(input.fileName);
    if (!classified) throw new Error('Unsupported font format - use .woff2, .woff, .ttf or .otf');
    if (input.data.length === 0) throw new Error('The uploaded file is empty');
    if (input.data.length > MAX_FONT_BYTES) throw new Error('The font file is too large (32 MB maximum)');

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const fileName = `${id}${classified.extension}`;
    fs.writeFileSync(path.join(this.dir, fileName), input.data);

    const record: FontRecord = {
      id,
      name: input.name.trim() || path.basename(input.fileName, classified.extension),
      fileName,
      format: classified.format,
      size: input.data.length,
      uploadedAt: new Date().toISOString(),
    };
    this.records.push(record);
    this.persist();
    log.info(`font added: ${record.name} (${record.fileName}, ${record.size} bytes)`);
    return record;
  }

  remove(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;
    try {
      fs.rmSync(this.filePath(record), { force: true });
    } catch (err) {
      log.warn(`could not delete ${record.fileName}: ${(err as Error).message}`);
    }
    this.records = this.records.filter((font) => font.id !== id);
    if (this.selection.sans === id) this.selection.sans = '';
    if (this.selection.mono === id) this.selection.mono = '';
    this.persist();
    log.info(`font removed: ${record.name}`);
    return true;
  }

  select(selection: Partial<FontSelection>): FontSelection {
    if (selection.sans !== undefined) {
      this.selection.sans = selection.sans && this.get(selection.sans) ? selection.sans : '';
    }
    if (selection.mono !== undefined) {
      this.selection.mono = selection.mono && this.get(selection.mono) ? selection.mono : '';
    }
    this.persist();
    return { ...this.selection };
  }
}
