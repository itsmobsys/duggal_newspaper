import Link from 'next/link';

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound(): React.JSX.Element {
  return (
    <main className="container" style={{ paddingBlock: '18vh' }}>
      <p className="eyebrow">404 · Dead link</p>
      <h1 style={{ fontSize: 'clamp(2rem, 7vw, 4rem)' }}>This page got axed in editing.</h1>
      <p className="lede">
        Either the story was retracted, the URL was typed by a human, or the robot simply misplaced
        it. The front page is still where the kand lives.
      </p>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 24 }}>
        <Link className="button button--primary" href="/">
          Back to the front page
        </Link>
        <Link className="button button--ghost" href="/search">
          Search the archive
        </Link>
      </p>
    </main>
  );
}
