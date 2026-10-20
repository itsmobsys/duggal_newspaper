export interface JsonLdProps {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}

/** JSON-LD is inert data; escape `<` so a headline can never close the tag. */
export function JsonLd({ data }: JsonLdProps): React.JSX.Element {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
