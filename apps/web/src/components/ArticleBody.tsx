import { paragraphs } from '@/lib/prose';

export interface ArticleBodyProps {
  body: string;
}

/**
 * Article bodies are stored as plain text with blank-line paragraph breaks.
 * Rendering text nodes (never innerHTML) means an AI slip-up or a hostile
 * submission cannot inject markup.
 */
export function ArticleBody({ body }: ArticleBodyProps): React.JSX.Element {
  const blocks = paragraphs(body);
  if (blocks.length === 0) {
    return (
      <div className="article-body">
        <p className="muted">This story arrived empty. The editor is furious.</p>
      </div>
    );
  }
  return (
    <div className="article-body">
      {blocks.map((block, index) => (
        <p key={index}>{block}</p>
      ))}
    </div>
  );
}
