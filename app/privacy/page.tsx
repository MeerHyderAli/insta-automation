import type { Metadata } from 'next';
import LegalPage from '../legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy — Comment-to-DM',
  description: 'Privacy policy for the single-account Instagram comment-to-DM automation app.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Comment-to-DM is a single-purpose automation operated for the Instagram professional
        account connected to this deployment. When a person comments on that account’s media,
        the app can check whether the person follows the account, send a private-reply prompt,
        repeat the follow check after the person taps the prompt, and then send the resource
        link configured for that Reel or post.
      </p>

      <h2>Information processed</h2>
      <p>Depending on the interaction, the app may process and store:</p>
      <ul>
        <li>Instagram comment IDs, comment text, media IDs, and event timestamps.</li>
        <li>
          The commenter’s Instagram-scoped ID and username when Instagram provides them in a
          webhook.
        </li>
        <li>
          The result of each follow-status check, the message-delivery stage, Meta message IDs,
          and sanitized API error messages needed for troubleshooting.
        </li>
        <li>
          Webhook diagnostic metadata such as receipt time, signature-validation result, payload
          object and field names, and counts of parsed comments/messages. Diagnostics do not
          store the raw webhook payload, comment text, usernames, or signatures.
        </li>
        <li>
          Resource URLs and labels that the account operator saves for specific Reels/posts in
          the app dashboard.
        </li>
      </ul>
      <p>
        The app does not ask for Instagram passwords and does not sell personal information.
        Access tokens and app secrets are kept only in server-side environment configuration;
        they are not intentionally shown in the dashboard or stored in comment records.
      </p>

      <h2>How information is used</h2>
      <ul>
        <li>To detect a new comment and avoid processing the same comment more than once.</li>
        <li>To verify follow status before the first prompt and again before sending a link.</li>
        <li>To send the prompt, retry message, or configured resource link through Meta’s APIs.</li>
        <li>To show the account operator recent comment and delivery status in the dashboard.</li>
        <li>To diagnose webhook delivery, parser, storage, and Meta API failures.</li>
      </ul>

      <h2>Sharing and service providers</h2>
      <p>
        Information is sent to Meta/Instagram as necessary to receive webhooks, check follow
        status, and send messages. The app also relies on the hosting and database providers
        chosen by its operator to run and store the application. Those providers process data
        only as needed to provide their infrastructure services. Public comments and Instagram
        messages remain subject to Instagram’s and Meta’s own terms and privacy practices.
      </p>

      <h2>Retention and security</h2>
      <p>
        Comment and interaction records are retained while needed for deduplication, delivery
        status, troubleshooting, and the operator’s dashboard, and may be deleted earlier on
        request. Local file storage keeps at most 500 comment records; webhook diagnostic
        receipts are capped at the latest 100. Database deployments retain records until the
        operator removes them or a deletion request is completed. Dashboard access can be
        protected with Basic Auth, webhook signatures are verified, and access tokens are not
        exposed to browsers.
      </p>

      <h2>Your choices and deletion requests</h2>
      <p>
        You can request deletion of stored automation records associated with your Instagram
        account by following the instructions on the <a href="/data-deletion">Data Deletion</a>{' '}
        page. Deleting records from this app does not delete your public comment or messages
        from Instagram itself; use Instagram’s controls for content on Instagram.
      </p>

      <h2>Changes and contact</h2>
      <p>
        This policy may be updated when the app’s data handling changes. For privacy questions,
        send a direct message to the Instagram professional account connected to this app and
        mention “Comment-to-DM privacy”.
      </p>
      <p className="small muted">
        This app is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or
        Instagram.
      </p>
    </LegalPage>
  );
}
