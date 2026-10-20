/* eslint-disable @next/next/no-img-element -- reader uploads are served from R2; the Next image optimizer is not in the path. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { pluralise } from '@/lib/format';
import { clampHeadline } from '@/lib/prose';
import { listPhotos, type PhotoView } from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 60;

const PAGE_SIZE = 24;

interface PhotosPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function photoPageHref(page: number): string {
  return page > 1 ? `/photos?page=${page}` : '/photos';
}

function altFor(photo: PhotoView): string {
  return photo.alt ?? photo.caption ?? photo.articleHeadline;
}

export async function generateMetadata({ searchParams }: PhotosPageProps): Promise<Metadata> {
  const query = await searchParams;
  const page = parsePage(query.page);
  const settings = await getPublicSettings();
  const baseUrl = siteUrl(settings);

  const title = page > 1 ? `Photos — page ${page}` : 'Photos';
  const description = `Photographs submitted by readers and printed in ${settings.site.name}. Every image came in with a story; the desk captions photos but never generates them.`;
  const canonical = page > 1 ? `/photos?page=${page}` : '/photos';

  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}${canonical}` },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `${title} — ${settings.site.name}`,
      description,
      url: `${baseUrl}${canonical}`,
    },
  };
}

export default async function PhotosPage({
  searchParams,
}: PhotosPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const page = parsePage(query.page);

  const photos = await listPhotos(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(photos.total / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const hasPhotos = photos.items.length > 0;

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">Reader-submitted, never generated</p>
        <h1>Photos</h1>
        <p className="lede">
          Every photograph here arrived with a story, uploaded by the reader who filed it. The desk
          may have written the caption; it did not make the picture.
        </p>
        <p className="muted">
          {photos.total > 0
            ? `${pluralise(photos.total, 'photograph', 'photographs')} on file, newest first.`
            : 'No photographs have been submitted yet.'}
        </p>
      </header>

      {hasPhotos ? (
        <div className={styles.grid}>
          {photos.items.map((photo) => (
            <figure className={styles.figure} key={photo.id}>
              <img
                src={photo.thumbUrl ?? photo.url}
                alt={altFor(photo)}
                width={photo.width ?? 1200}
                height={photo.height ?? 800}
                loading="lazy"
                decoding="async"
              />
              <figcaption className={styles.caption}>
                {photo.caption ? <span className={styles.captionText}>{photo.caption}</span> : null}
                {photo.attribution ? (
                  <span className={styles.credit}>{photo.attribution}</span>
                ) : null}
                <Link className={styles.articleLink} href={`/article/${photo.articleSlug}`}>
                  From: {clampHeadline(photo.articleHeadline, 80)}
                </Link>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <EmptyState
          title={page > 1 ? 'No photographs on this page' : 'No photographs yet'}
          message={
            page > 1
              ? 'This page is past the end of the photo desk. Nothing here has been padded out with stock images — the desk does not own any.'
              : 'No reader has sent a picture yet. Photos arrive with submissions; the desk has never generated one and will not start today.'
          }
          actionHref={page > 1 ? '/photos' : '/submit'}
          actionLabel={page > 1 ? 'Back to the first page' : 'Submit a story'}
        />
      )}

      {totalPages > 1 ? (
        <nav className="pagination" aria-label="Photo pagination">
          <span>
            Page {current} of {totalPages} · {pluralise(photos.total, 'photograph', 'photographs')}
          </span>
          <span className="pages">
            {current > 1 ? (
              <Link className="chip" href={photoPageHref(current - 1)} rel="prev">
                ← Newer
              </Link>
            ) : null}
            {current < totalPages ? (
              <Link className="chip" href={photoPageHref(current + 1)} rel="next">
                Older →
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}

      <aside className={styles.policy} aria-label="Photo policy">
        <h2 className={styles.policyTitle}>Where these images come from</h2>
        <p>
          Photos are optional attachments on reader submissions. Each file is validated, re-encoded
          and stripped of metadata before it is served. The picture is never generated,
          content-edited or swapped for another, and stories without pictures run without them. The
          vision model may write a caption; it never draws the image.
        </p>
      </aside>
    </div>
  );
}
