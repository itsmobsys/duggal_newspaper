import Link from 'next/link';

export interface ContactNoteProps {
  /** Public Discord handle or invite from settings.site.contactDiscord. */
  contact: string;
  /** Where to send readers when the desk has not published a contact. */
  fallbackHref: string;
  fallbackLabel: string;
}

/**
 * One honest contact line. The handle is rendered as text, not guessed into a
 * URL: settings may hold a handle, an invite, or nothing at all.
 */
export function ContactNote({
  contact,
  fallbackHref,
  fallbackLabel,
}: ContactNoteProps): React.JSX.Element {
  const handle = contact.trim();

  if (!handle) {
    return (
      <p>
        The desk has not published a contact handle yet, so there is no address to invent.{' '}
        <Link href={fallbackHref}>{fallbackLabel}</Link>.
      </p>
    );
  }

  return (
    <p>
      The desk can be found at <strong>{handle}</strong>. Bring the story, not the subpoena.
    </p>
  );
}
