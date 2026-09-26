import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CalendarDays, Clock, ListTree } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { blogApi, blogFileUrl } from '../../lib/blog-api';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { resolveImagePath, slugifyHeading } from '../../lib/markdown';
import { extractHeadings, type Heading } from '../../lib/outline';
import type { BlogPost } from '../../lib/types';
import { replaceAnchor } from '../../lib/url';
import { Preview, type PreviewApi } from '../Preview';
import { Tooltip } from '../ui/primitives';
import { BlogNotice, ManagerLink, messageOf } from './BlogIndexPage';
import { OutlineHandle, OUTLINE_WIDTH } from './OutlineHandle';

interface BlogPostPageProps {
  /** Storage path of the note being read, as the address names it. */
  path: string;
  /** The address's #anchor, empty when there is none. */
  anchor: string;
  /** A link inside the post that points at another note. */
  onOpenPost: (path: string) => void;
  /** Back to the blog's index - the header's only way out. */
  onOpenIndex: () => void;
}

/**
 * One published note, read.
 *
 * Like the index it fetches for itself - the public API, no store - and like
 * the panel's editor it keeps exactly one way to move inside the document, so
 * the outline, a #anchor link and a deep link cannot end up disagreeing about
 * where the reader is.
 */
export function BlogPostPage({ path, anchor, onOpenPost, onOpenIndex }: BlogPostPageProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const previewApiRef = useRef<PreviewApi | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [outlineOpen, setOutlineOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    blogApi
      .post(path)
      .then((payload) => {
        if (!cancelled) setLoad({ status: 'ready', enabled: payload.enabled, post: payload.post });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: messageOf(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Beside the text there is room for the outline; below that it would squeeze
  // the column it is meant to help read, so it starts closed there - and the
  // grip on the boundary is the one way it comes back.
  useEffect(() => {
    if (!isDesktop) setOutlineOpen(false);
  }, [isDesktop]);

  const post = load.status === 'ready' ? load.post : null;
  const content = post?.content ?? '';
  const headings = useMemo(() => extractHeadings(content), [content]);

  /**
   * The one way to move inside the post.
   *
   * The outline, a `[text](#anchor)` link and a pasted deep link all come
   * through here, so the address bar and the page agree afterwards. The address
   * is replaced rather than pushed: walking a document's headings should not
   * fill the back button with them.
   */
  const goToHeading = useCallback((heading: Heading, index: number) => {
    replaceAnchor(slugifyHeading(heading.text));
    previewApiRef.current?.scrollToHeading({ index, text: heading.text, level: heading.level });
  }, []);

  /** Follows a `#anchor` written inside the post. */
  const followAnchor = useCallback(
    (id: string) => {
      const index = headings.findIndex((heading) => slugifyHeading(heading.text) === id);
      if (index >= 0) {
        goToHeading(headings[index], index);
        return;
      }
      // Not a heading: still record it, and let the preview find any element.
      replaceAnchor(id);
      previewApiRef.current?.scrollToAnchor(id);
    },
    [headings, goToHeading],
  );

  // A deep link (`/notes/a.md#11-分层`) can only be applied once the post and
  // its preview exist: the preview has nothing to scroll to before that. Same
  // wait the panel's editor makes for the same reason.
  useEffect(() => {
    if (!anchor || !post) return undefined;
    const timer = window.setTimeout(() => {
      const index = headings.findIndex((heading) => slugifyHeading(heading.text) === anchor);
      if (index >= 0) goToHeading(headings[index], index);
      else previewApiRef.current?.scrollToAnchor(anchor);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [anchor, post, headings, goToHeading]);

  const hasPost = load.status === 'ready' && load.enabled;
  const showOutline = hasPost && isDesktop && outlineOpen;

  return (
    <div className="relative z-10 flex h-full flex-col">
      <header className="shrink-0 px-4 pb-2 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <button
            type="button"
            onClick={onOpenIndex}
            aria-label="返回博客首页"
            data-blog-home
            className="focus-ring flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            全部文章
          </button>
          <span className="flex-1" />
          <ManagerLink />
        </div>
      </header>

      {/* Reading is what the page is for, so the surface fills the window
          rather than sitting in it as a box with margins - a post is a page,
          not a card on one. The text keeps a readable measure inside it. */}
      <div className="min-h-0 flex-1">
        <div data-blog-surface className="glass relative flex h-full w-full overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {load.status === 'loading' ? (
              <PostSkeleton />
            ) : load.status === 'error' ? (
              <div className="p-6">
                <BlogNotice title="打不开这篇内容" message={load.message} />
              </div>
            ) : !load.enabled ? (
              <div className="p-6">
                <BlogNotice title="博客还没有开放" message="这篇文章暂时不对访客显示。" />
              </div>
            ) : (
              // The column is as wide as the surface it sits on: a capped one
              // left a band of empty glass either side on a wide window. The
              // gutter comes from the padding instead.
              <div className="flex min-h-0 w-full flex-1 flex-col">
                <div className="shrink-0 px-7 pb-1 pt-7">
                  <h1 className="text-[27px] font-semibold leading-tight tracking-tight text-[var(--text)]">
                    {load.post.title}
                  </h1>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--faint)]">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      发布 {formatDateTime(load.post.publishedAt)}
                    </span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      修改 {formatDateTime(load.post.updatedAt)}
                    </span>
                    <span>·</span>
                    <span>{load.post.wordCount} 字</span>
                  </div>
                </div>
                <Preview
                  content={load.post.content}
                  notePath={load.post.path}
                  // The panel's own door asks who is asking; a reader here has
                  // no account, so the pictures come through the public one.
                  imageUrl={blogFileUrl}
                  apiRef={previewApiRef}
                  onOpenLink={(href) => {
                    // A link to another note is written the way a picture is -
                    // relative to the post it sits in.
                    const target = resolveImagePath(href, load.post.path);
                    if (target) onOpenPost(target);
                  }}
                  onOpenAnchor={followAnchor}
                  className="min-h-0 flex-1"
                />
              </div>
            )}
          </div>

          <AnimatePresence initial={false}>
            {showOutline ? (
              <motion.aside
                key="outline"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: OUTLINE_WIDTH, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                className="shrink-0 overflow-hidden"
              >
                <BlogOutline headings={headings} onNavigate={goToHeading} />
              </motion.aside>
            ) : null}
          </AnimatePresence>

          {/* Only while there is an outline to control: a grip beside an
              error notice would open nothing at all. */}
          {hasPost && isDesktop ? (
            <OutlineHandle open={outlineOpen} onToggle={() => setOutlineOpen((value) => !value)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; enabled: boolean; post: BlogPost };

/**
 * The post's headings, beside it.
 *
 * The panel's own OutlinePanel cannot be used here: it reads the open note out
 * of the store, which a visitor has none of, and its header carries a second
 * way to hide it - while the blog has exactly one, the grip on the boundary.
 * The markup below is the same shape, and the same item styles, so the two
 * outlines look like each other.
 */
function BlogOutline({
  headings,
  onNavigate,
}: {
  headings: Heading[];
  onNavigate: (heading: Heading, index: number) => void;
}) {
  return (
    <nav
      className="outline-panel flex h-full flex-col border-l border-[var(--line)]"
      style={{ width: OUTLINE_WIDTH }}
      aria-label="文章大纲"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[var(--line)] px-3">
        <ListTree className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">大纲</span>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {headings.length === 0 ? (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--faint)]">这篇内容没有小标题</p>
        ) : (
          <ul className="space-y-0.5">
            {headings.map((heading, index) => (
              <li key={heading.line}>
                <Tooltip label={heading.text} side="top" className="block">
                  <button
                    type="button"
                    data-outline-item={index}
                    onClick={() => onNavigate(heading, index)}
                    className={cn(
                      'focus-ring flex w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-[var(--accent)]',
                      heading.level === 1 && 'pl-2 font-medium text-[var(--text)]',
                      heading.level === 2 && 'pl-3.5',
                      heading.level === 3 && 'pl-5 text-[11.5px]',
                      heading.level >= 4 && 'pl-6.5 text-[11px] text-[var(--faint)]',
                    )}
                  >
                    <span className="truncate">{heading.text}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function PostSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-7 py-8">
      <p className="text-[12.5px] text-[var(--faint)]">载入中…</p>
      <div className="shimmer mt-5 h-8 w-3/5 rounded-xl" />
      <div className="shimmer mt-4 h-3.5 w-1/3 rounded-lg" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="shimmer h-4 rounded-lg" style={{ width: (row % 3 === 2 ? 62 : 96) + '%' }} />
        ))}
      </div>
    </div>
  );
}
