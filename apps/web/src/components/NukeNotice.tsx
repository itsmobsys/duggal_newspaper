/**
 * The whole public site, replaced by one sentence.
 *
 * Rendered by the (public) layout when `site.nuke` is on. No masthead, no nav,
 * no footer, no data queries — just the notice and a way to reach the Discord.
 */
export function NukeNotice({ discord }: { discord: string }): React.JSX.Element {
  const link = discord.trim();

  return (
    <div className="nuke-screen" role="main" id="main-content">
      <div className="nuke-card">
        <p className="nuke-kicker">Duggal Badmosh Daily Newspaper</p>
        <h1 className="nuke-title">Website down</h1>
        <p className="nuke-text">
          Website down because something happened. Check Discord for website news.
        </p>
        {link ? (
          <a className="nuke-link" href={link} rel="noreferrer noopener" target="_blank">
            Open the Discord
          </a>
        ) : null}
      </div>
    </div>
  );
}
