import type { Metadata } from 'next';
import { CategoryForm } from '@/components/admin/CategoryForm';
import { adminServerFetch } from '@/lib/admin-server';
import { relativeTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Categories',
  robots: { index: false, follow: false },
};

interface CategoryRecord {
  slug: string;
  name: string;
  description: string | null;
  accent: string | null;
  sort_order: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface CategoriesResponse {
  categories: CategoryRecord[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

export default async function CategoriesPage(): Promise<React.JSX.Element> {
  let categories: CategoryRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<CategoriesResponse>('/admin/categories');
    categories = data.categories;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Categories</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Sections shown in navigation and offered on the submission form.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Categories could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      <div className="admin-split">
        <div className="stack">
          <section className="panel" aria-labelledby="category-list-heading">
            <div className={styles.groupHead}>
              <h2 id="category-list-heading">All categories</h2>
              {categories ? (
                <span className="badge badge--muted">{categories.length} total</span>
              ) : null}
            </div>

            {categories && categories.length === 0 ? (
              <div className="empty-state">
                <h2>No categories yet</h2>
                <p>Create the first section with the form beside this table.</p>
              </div>
            ) : null}

            {categories && categories.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="visually-hidden">All newsroom categories</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Slug</th>
                      <th scope="col">Description</th>
                      <th scope="col">Accent</th>
                      <th scope="col">Order</th>
                      <th scope="col">Status</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <tr key={category.slug}>
                        <td className="title-cell">{category.name}</td>
                        <td className={styles.mono}>{category.slug}</td>
                        <td className={styles.cellStack}>
                          {category.description ? (
                            category.description
                          ) : (
                            <span className="muted">No description</span>
                          )}
                        </td>
                        <td>
                          {category.accent ? (
                            <span>
                              <span
                                className={styles.swatch}
                                style={{ backgroundColor: category.accent }}
                                aria-hidden="true"
                              />
                              <span className={styles.mono}>{category.accent}</span>
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className={styles.hash}>{category.sort_order}</td>
                        <td>
                          <span
                            className={
                              category.enabled === 1 ? 'badge badge--ok' : 'badge badge--muted'
                            }
                          >
                            {category.enabled === 1 ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className={styles.cellMuted}>{relativeTime(category.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className={styles.actionMessage}>
              The API supports creating categories here. Editing and removing existing categories is
              not exposed on this screen.
            </p>
          </section>
        </div>

        <aside className="stack" aria-label="Create category">
          <section className="panel" aria-labelledby="category-create-heading">
            <h2 id="category-create-heading">Create a category</h2>
            <CategoryForm />
          </section>
        </aside>
      </div>
    </>
  );
}
