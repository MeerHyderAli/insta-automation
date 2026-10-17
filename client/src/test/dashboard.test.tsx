import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../pages/OverviewPage';
import type { Api } from '../lib/api';
import { createApiMock, makeAnalytics, makeConfig, makeRun, renderWithProviders } from './fixtures';

describe('Overview dashboard states', () => {
  it('shows a loading skeleton before the first response', () => {
    const { api } = createApiMock({
      getAnalytics: (() => new Promise(() => {})) as Api['getAnalytics'],
    });
    renderWithProviders(<OverviewPage />, { api });
    expect(screen.getByLabelText('Loading page')).toBeInTheDocument();
  });

  it('shows an error with a retry that recovers', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const getAnalytics = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Analytics service is down');
      return { analytics: makeAnalytics() };
    });
    const { api } = createApiMock({ getAnalytics });
    renderWithProviders(<OverviewPage />, { api });

    expect(await screen.findByText('Analytics service is down')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(getAnalytics).toHaveBeenCalledTimes(2);
  });

  it('renders confirmed delivery numbers and an empty activity state', async () => {
    const { api } = createApiMock({
      getAnalytics: vi.fn(async () => ({
        analytics: makeAnalytics({
          commentsReceived: 1234,
          publicRepliesSent: 5,
          privateRepliesSent: 3,
          failures: 2,
          resourceClicks: 9,
        }),
      })),
    });
    renderWithProviders(<OverviewPage />, { api });

    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('marks demo sample runs so they cannot be mistaken for real delivery', async () => {
    const { api } = createApiMock({
      listRuns: vi.fn(async () => ({
        runs: [makeRun({ publicReplyStatus: 'sent', privateReplyStatus: 'sent' })],
        pagination: { total: 1, limit: 6, offset: 0, hasMore: false },
      })),
    });
    renderWithProviders(<OverviewPage />, { api, demoMode: true });

    expect(await screen.findByText('@reader')).toBeInTheDocument();
    expect(screen.getAllByText('Sample').length).toBeGreaterThan(0);
  });

  it('shows a distinct empty state when there are no accounts or rules', async () => {
    const { api } = createApiMock({
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      listRules: vi.fn(async () => ({ rules: [] })),
    });
    renderWithProviders(<OverviewPage />, { api });

    await waitFor(() => expect(screen.getByText('Getting started')).toBeInTheDocument());
    expect(screen.getByText('Connect a professional Instagram account')).toBeInTheDocument();
  });

  it('warns when Instagram credentials are missing on the server', async () => {
    const { api } = createApiMock();
    renderWithProviders(<OverviewPage />, {
      api,
      config: makeConfig({ metaConfigured: false }),
    });

    expect(
      await screen.findByText('Instagram is not configured on this server'),
    ).toBeInTheDocument();
  });
});
