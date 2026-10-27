import type { Metadata } from 'next';
import LegalPage from '../legal-page';

export const metadata: Metadata = {
  title: 'Terms of Use — Comment-to-DM',
  description: 'Terms of use for the single-account Instagram comment-to-DM automation app.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        Comment-to-DM helps the operator of one connected Instagram professional account respond
        to comments with a private-reply prompt and related public comment reply and, after the
        configured follow checks pass, a resource link selected for the relevant Reel or post.
      </p>

      <h2>Use of the service</h2>
      <ul>
        <li>
          The dashboard is for the connected account’s operator and authorized administrators.
        </li>
        <li>
          Commenters interact with the service by commenting on the connected account’s media
          and, if a prompt is sent, choosing whether to tap the button or reply.
        </li>
        <li>
          A link is sent only when the app is configured to do so and the required checks pass.
          Delivery can be affected by Instagram availability, messaging windows, permissions,
          follow status, account settings, and Meta API limits. Public comment replies are a
          separate Meta API action and can succeed or fail independently of DM delivery.
        </li>
      </ul>

      <h2>Operator responsibilities</h2>
      <ul>
        <li>The operator is responsible for the resource links and messages they configure.</li>
        <li>
          The operator must use the app only with accounts and permissions they are authorized
          to manage and must comply with Instagram’s and Meta’s applicable terms and policies.
        </li>
        <li>
          The operator must not use the app for spam, deception, harassment, or unlawful content.
        </li>
      </ul>

      <h2>Third-party services and availability</h2>
      <p>
        The service depends on Instagram, Meta APIs, hosting, and database infrastructure. It may
        be changed, suspended, or unavailable because of API changes, permission decisions,
        outages, maintenance, or operator configuration. Resource destinations are third-party
        links controlled by their respective owners.
      </p>

      <h2>Privacy and deletion</h2>
      <p>
        Use of information is described in the <a href="/privacy">Privacy Policy</a>. Requests to
        delete stored automation records can be made through the{' '}
        <a href="/data-deletion">Data Deletion</a> instructions.
      </p>

      <h2>No affiliation</h2>
      <p>
        This app is an independent tool and is not affiliated with, endorsed by, or sponsored by
        Meta Platforms, Inc. or Instagram. Instagram and Meta names are used only to describe
        compatibility with their platforms.
      </p>
    </LegalPage>
  );
}
