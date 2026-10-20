import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArticleEditor,
  type EditableArticle,
  type EditorImage,
} from '@/components/admin/ArticleEditor';
import type { CategoryOption } from '@/components/admin/SubmissionActions';
import { adminServerFetch } from '@/lib/admin-server';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit story',
  robots: { index: false, follow: false },
};

interface ArticleResponse {
  article: EditableArticle;
  images: EditorImage[];
}

interface CategoriesResponse {
  categories: Array<{ slug: string; name: string; enabled: number }>;
}

interface ArticleEditorPageProps {
  params: Promise<{ id: string }>;
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

export default async function AdminArticleEditorPage({
  params,
}: ArticleEditorPageProps): Promise<React.JSX.Element> {
  const { id } = await params;

  let data: ArticleResponse;
  try {
    data = await adminServerFetch<ArticleResponse>(`/admin/articles/${encodeURIComponent(id)}`);
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  // Categories only populate the section picker. A failure here must not take
  // down the editor, so the field falls back to a free-text slug input.
  let categories: CategoryOption[] = [];
  try {
    const response = await adminServerFetch<CategoriesResponse>('/admin/categories');
    categories = response.categories
      .filter((category) => category.enabled === 1)
      .map((category) => ({ slug: category.slug, name: category.name }));
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
  }

  const { article, images } = data;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Edit story</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {article.headline} · {article.status} · updated {relativeTime(article.updated_at)}
          </p>
        </div>
        <div className={styles.actionRow} style={{ marginTop: 0 }}>
          {article.status === 'published' ? (
            <Link
              className={styles.panelLink}
              href={`/article/${encodeURIComponent(article.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View live ↗
            </Link>
          ) : null}
          <Link className={styles.panelLink} href="/admin/articles">
            ← All articles
          </Link>
        </div>
      </div>

      <ArticleEditor article={article} categories={categories} images={images} />
    </>
  );
}
