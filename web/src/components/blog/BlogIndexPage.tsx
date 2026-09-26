import { motion } from 'framer-motion';
import { CircleAlert, PenLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blogApi, blogFileUrl } from '../../lib/blog-api';
import { formatDateTime } from '../../lib/format';
import { renderMarkdown, resolveImages } from '../../lib/markdown';
import type { BlogIndexPayload, BlogPostSummary } from '../../lib/types';
import { blogUrl, noteUrl } from '../../lib/url';
import { useAppStore } from '../../store/useAppStore';

/**
 * The blog's front page: everything published, as cards.
 *
 * A page of the site rather than of the panel, so it asks the public API for
 * its content instead of leaning on the store - a visitor has no notes in it.
 * The one thing read from the app is whether the visitor is signed in, which
 * decides whether the way back into the panel is offered at all. Opening a post
 * is the app's job: onOpenPost changes the address and the page with it.
 */
export function BlogIndexPage({ onOpenPost }: { onOpenPost: (path: string) => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    blogApi
      .index()
      .then((payload) => {
        if (!cancelled) setLoad({ status: 'ready', payload });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: messageOf(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const payload = load.status === 'ready' ? load.payload : null;
  const open = Boolean(payload?.enabled);
  const posts = open ? (payload?.posts ?? []) : [];

  return (
    <div className="scroll-area relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
        <header className="mb-9 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="gradient-text text-[30px] font-semibold tracking-tight">{payload?.title || '博客'}</h1>
            <p className="mt-2 text-[12.5px] text-[var(--muted)]">
              {open ? '共 ' + posts.length + ' 篇已发布' : '公开笔记与随笔'}
            </p>
          </div>
          <ManagerLink />
        </header>

        {load.status === 'loading' ? <IndexSkeleton /> : null}

        {load.status === 'error' ? <BlogNotice title="打不开博客" message={load.message} /> : null}

        {payload && !payload.enabled ? (
          <BlogNotice title="博客还没有开放" message="管理员打开博客之后，发布的笔记会出现在这里。" />
        ) : null}

        {open && posts.length === 0 ? (
          <BlogNotice title="还没有内容" message="第一篇笔记发布之后，它的卡片会出现在这里。" />
        ) : null}

        <div className="space-y-4">
          {posts.map((post, index) => (
            <BlogCard key={post.path} post={post} index={index} onOpenPost={onOpenPost} />
          ))}
        </div>
      </div>
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: BlogIndexPayload };

/** One card. The whole card is the link to the post. */
function BlogCard({
  post,
  index,
  onOpenPost,
}: {
  post: BlogPostSummary;
  index: number;
  onOpenPost: (path: string) => void;
}) {
  const summary = useMemo(() => summaryHtml(post.summary), [post.summary]);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // A picture can sit in the opening of a note too, and a visitor has to be
  // able to load it: the same resolution the post page does, through the public
  // door rather than the panel's.
  useEffect(() => {
    if (summaryRef.current) resolveImages(summaryRef.current, post.path, { fileUrl: blogFileUrl });
  }, [summary, post.path]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.24) }}
      className="glass card-hover overflow-hidden rounded-3xl shadow-soft"
    >
      {/* A real link, so a card can be opened in a new tab or copied as an
          address; the click only saves it the page load. */}
      <a
        href={blogUrl(post.path)}
        data-blog-card={post.path}
        aria-label={post.title}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onOpenPost(post.path);
        }}
        className="focus-ring block px-5 py-5 sm:px-6 sm:py-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-[18.5px] font-semibold leading-snug tracking-tight text-[var(--text)]">
            {post.title}
          </h2>
          {/* When it went up and when it last changed, out of the way in the
              corner: the title is what a reader is looking for. */}
          <div className="shrink-0 text-right text-[11px] leading-relaxed text-[var(--faint)]">
            <div>发布 {formatDateTime(post.publishedAt)}</div>
            <div>修改 {formatDateTime(post.updatedAt)}</div>
          </div>
        </div>
        {summary ? (
          <div ref={summaryRef} className="markdown-body blog-summary mt-3" dangerouslySetInnerHTML={{ __html: summary }} />
        ) : null}
      </a>
    </motion.article>
  );
}

function IndexSkeleton() {
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-[var(--faint)]">载入中…</p>
      {[0, 1, 2].map((row) => (
        <div key={row} className="glass rounded-3xl px-6 py-6 shadow-soft">
          <div className="shimmer h-5 w-2/5 rounded-lg" />
          <div className="shimmer mt-4 h-3.5 w-full rounded-lg" />
          <div className="shimmer mt-2.5 h-3.5 w-3/4 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces both blog pages say the same way                             */
/* ------------------------------------------------------------------ */

/**
 * The way into the panel, and the only one the blog offers.
 *
 * A reader who is not signed in sees "登录" - the blog is public, but whoever
 * runs it still has to be able to get in from the page they land on. Somebody
 * who is already signed in gets the panel itself instead.
 */
export function ManagerLink() {
  const user = useAppStore((s) => s.user);
  return (
    <button
      type="button"
      data-blog-manager
      aria-label={user ? '管理面板' : '登录'}
      onClick={() => window.location.assign(noteUrl(null))}
      className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
    >
      <PenLine className="h-3.5 w-3.5" />
      {user ? '管理面板' : '登录'}
    </button>
  );
}

/** Something the page cannot do, said in a sentence a reader can act on. */
export function BlogNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="glass rounded-3xl px-6 py-10 text-center shadow-soft">
      <CircleAlert className="mx-auto h-6 w-6 text-[var(--faint)]" />
      <p className="mt-3 text-[14px] font-medium text-[var(--text)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">{message}</p>
    </div>
  );
}

/** The server's own words when it has any; something readable when it does not. */
export function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : '请稍后再试。';
}

/**
 * The card's copy of a summary: the note's own markdown, minus its links.
 *
 * The whole card is a link, and a link inside a link is neither valid nor
 * clickable - the inner one would swallow the click that was meant to open the
 * post. Everything else is kept, so a summary that opens with a list or a bold
 * sentence still reads like one. Where there is no DOM (a server render) the
 * markup is handed over as it is: nothing in that copy could be clicked anyway.
 */
function summaryHtml(summary: string): string {
  const rendered = renderMarkdown(summary);
  if (typeof document === 'undefined') return rendered;
  const holder = document.createElement('div');
  holder.innerHTML = rendered;
  holder.querySelectorAll('a').forEach((anchor) => anchor.replaceWith(...Array.from(anchor.childNodes)));
  return holder.innerHTML;
}
