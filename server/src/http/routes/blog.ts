import { Router, type Response } from 'express';
import type { Services } from '../../services.js';
import { handler } from '../middleware.js';
import { baseName } from '../../storage/types.js';
import { fileResponseHeaders } from './notes.js';

/**
 * The blog's name.
 *
 * A constant rather than a setting: the front page needs something for the tab
 * and for the heading above the first card, and there is exactly one site here.
 */
export const BLOG_TITLE = '笔记';

/**
 * The public blog: read-only, and never behind a session.
 *
 * It answers for the site's own notes rather than for whoever is looking - a
 * blog that changed with the visitor would not be a blog - so the storage is
 * resolved without a user. Nothing here writes, and a note only leaves the
 * folder once its front matter says `blog: true`.
 */
export function blogRoutes(services: Services): Router {
  const router = Router();
  const enabled = () => services.settings.effective().blog.enabled;

  // The public reader is nobody in particular.
  const reader = null;

  const refuse = (res: Response, code: string, message: string): void => {
    res.status(404).json({ error: { message, code } });
  };

  router.get(
    '/',
    handler(async (_req, res) => {
      if (!enabled()) {
        // Off is an answer rather than an error: the front page reads this
        // before it decides between the blog and the panel.
        res.json({ enabled: false, title: BLOG_TITLE, posts: [] });
        return;
      }
      res.json({ enabled: true, title: BLOG_TITLE, posts: await services.notes.blogPosts(reader) });
    }),
  );

  router.get(
    '/post',
    handler(async (req, res) => {
      if (!enabled()) {
        refuse(res, 'blog_disabled', '博客还没有开启');
        return;
      }
      const post = await services.notes.publishedPost(reader, String(req.query.path ?? ''));
      if (!post) {
        refuse(res, 'post_not_found', '这篇笔记不在博客上');
        return;
      }
      res.json({ enabled: true, post });
    }),
  );

  router.get(
    '/file',
    handler(async (req, res) => {
      if (!enabled()) {
        refuse(res, 'blog_disabled', '博客还没有开启');
        return;
      }
      const file = await services.notes.publishedFile(reader, String(req.query.path ?? ''));
      if (!file) {
        refuse(res, 'file_not_published', '这个文件不在博客上');
        return;
      }
      // Public for five minutes: these bytes are the same for every reader, and
      // one post should not ask for the same picture twice while it is scrolled.
      fileResponseHeaders(res, baseName(file.path), 'public, max-age=300');
      res.send(Buffer.from(file.data));
    }),
  );

  return router;
}
