import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { HomeRedirect } from './pages/HomeRedirect';
import { OnboardingPage } from './pages/OnboardingPage';
import { OAuthLanding } from './pages/OAuthLanding';
import { OverviewPage } from './pages/OverviewPage';
import { AccountsPage } from './pages/AccountsPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { AutomationEditorPage } from './pages/AutomationEditorPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { ActivityPage } from './pages/ActivityPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UsagePage } from './pages/UsagePage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/accounts"
              element={
                <RequireAuth>
                  <OAuthLanding />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <HomeRedirect />
                </RequireAuth>
              }
            />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/w/:workspaceId"
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="automations" element={<AutomationsPage />} />
              <Route path="automations/new" element={<AutomationEditorPage />} />
              <Route path="automations/:ruleId" element={<AutomationEditorPage />} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <Toaster position="top-right" richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
