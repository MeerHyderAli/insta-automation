import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AutomationEditorPage } from '../pages/AutomationEditorPage';
import { createApiMock, renderWithProviders, WORKSPACE_ID } from './fixtures';

const route = `/w/${WORKSPACE_ID}/automations/new`;

async function renderEditor() {
  const { api, mocks } = createApiMock();
  const result = renderWithProviders(<AutomationEditorPage />, { api, route });
  await screen.findByLabelText('Automation name');
  return { ...result, mocks };
}

describe('Automation editor validation', () => {
  it('blocks an empty form and explains every missing field', async () => {
    const user = userEvent.setup();
    const { mocks } = await renderEditor();

    await user.click(screen.getAllByRole('button', { name: /create automation/i })[0]!);

    expect(await screen.findByText('Check these fields')).toBeInTheDocument();
    expect(screen.getAllByText('Give the automation a name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add at least one keyword.').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Add at least one public reply or private reply template.').length,
    ).toBeGreaterThan(0);
    expect(mocks.createRule).not.toHaveBeenCalled();
  });

  it('rejects unknown placeholders before calling the API', async () => {
    const user = userEvent.setup();
    const { mocks } = await renderEditor();

    await user.type(screen.getByLabelText('Automation name'), 'Unknown placeholder rule');
    await user.type(screen.getByLabelText('Keywords'), 'API, GUIDE');
    await user.type(screen.getByLabelText(/^Public reply/), 'Here you go {{{{secret}}');
    await user.click(screen.getAllByRole('button', { name: /create automation/i })[0]!);

    expect(
      (await screen.findAllByText('Public reply uses unknown placeholder {{secret}}.')).length,
    ).toBeGreaterThan(0);
    expect(mocks.createRule).not.toHaveBeenCalled();
  });

  it('deduplicates keywords case-insensitively and saves the parsed list', async () => {
    const user = userEvent.setup();
    const { mocks } = await renderEditor();

    await user.type(screen.getByLabelText('Automation name'), 'Guide requests');
    await user.type(screen.getByLabelText('Keywords'), 'API, api, GUIDE');
    await user.type(screen.getByLabelText(/^Public reply/), 'Sent you a DM, {{{{username}}!');
    await user.click(screen.getAllByRole('button', { name: /create automation/i })[0]!);

    await waitFor(() => expect(mocks.createRule).toHaveBeenCalledTimes(1));
    const [workspaceId, input] = mocks.createRule!.mock.calls[0]!;
    expect(workspaceId).toBe(WORKSPACE_ID);
    expect(input).toMatchObject({
      name: 'Guide requests',
      keywords: ['API', 'GUIDE'],
      publicReplyTemplate: 'Sent you a DM, {{username}}!',
      followGate: 'off',
      enabled: false,
    });
  });

  it('shows follow verification as unsupported and offers no fake switch', async () => {
    await renderEditor();

    expect(screen.getByText('Verify follow before sending')).toBeInTheDocument();
    expect(screen.getByText('Unsupported')).toBeInTheDocument();
    expect(screen.getByText(/Instagram does not expose follower status/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /verify follow/i })).not.toBeInTheDocument();
  });
});
