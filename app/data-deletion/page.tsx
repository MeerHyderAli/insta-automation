import type { Metadata } from 'next';
import LegalPage from '../legal-page';

export const metadata: Metadata = {
  title: 'Data Deletion — Comment-to-DM',
  description: 'How to request deletion of data stored by the Instagram comment-to-DM automation app.',
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion Instructions">
      <p>
        You can request deletion of automation records that this app stores about your Instagram
        comments or button interactions with the connected Instagram professional account.
      </p>

      <h2>How to request deletion</h2>
      <ol>
        <li>
          Send an Instagram direct message <strong>from the Instagram account whose data you want
          deleted</strong> to the Instagram professional account connected to this app.
        </li>
        <li>Write: <strong>“Delete my Comment-to-DM data.”</strong></li>
        <li>
          If you know it, include the approximate date of the comment and the Reel/post it was on.
          Do not send passwords, access tokens, or other secrets.
        </li>
      </ol>
      <p>
        Sending the request from the relevant Instagram account helps the operator verify that
        the requester controls that account.
      </p>

      <h2>What will be deleted</h2>
      <p>
        After verification, the operator will delete stored automation records associated with
        that account/commenter ID where they can be identified, including stored comment text,
        username, follow-check result, delivery status, and related interaction metadata.
        Resource mappings created by the account operator do not identify individual commenters
        and are not part of a commenter deletion request.
      </p>

      <h2>What this does not delete</h2>
      <p>
        This request deletes records in this app’s storage only. It does not remove your public
        comment, Instagram direct messages, or other content from Instagram. To delete content on
        Instagram, use the controls available in Instagram.
      </p>

      <h2>Processing</h2>
      <p>
        Requests are handled manually by the connected account’s operator. The operator may ask
        for the comment date or Reel/post if the request cannot be matched to a stored record.
        Aggregated webhook diagnostic metadata that does not store a username, commenter ID,
        comment text, or raw payload may remain until it ages out of the latest-100 receipt cap.
      </p>
    </LegalPage>
  );
}
