import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './app.css';
import { AppShell } from './components/AppShell';
import { PortalLayout } from './components/PortalLayout';
import { SettingsLayout } from './components/SettingsLayout';
import { AuthProvider, useAuth } from './lib/auth';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ApprovePage } from './pages/ApprovePage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AuditPage } from './pages/AuditPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { DecisionTableEditorPage } from './pages/DecisionTableEditorPage';
import { DecisionTablesPage } from './pages/DecisionTablesPage';
import { FieldsPage } from './pages/FieldsPage';
import { InboxPage } from './pages/InboxPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { ManagedListsPage } from './pages/ManagedListsPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PeoplePage } from './pages/PeoplePage';
import { RequestsPage } from './pages/RequestsPage';
import { RuleBuilderPage } from './pages/RuleBuilderPage';
import { RulesListPage } from './pages/RulesListPage';
import { SandboxPage } from './pages/SandboxPage';
import { SignupPage } from './pages/SignupPage';
import { SubmitFormPage } from './pages/SubmitFormPage';
import { SubmitLandingPage } from './pages/SubmitLandingPage';
import { WebhooksSettingsPage } from './pages/WebhooksSettingsPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';
import { WorkflowsListPage } from './pages/WorkflowsListPage';

function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="font-mono text-sm text-ink-soft">loading…</p>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/approve/:token', element: <ApprovePage /> },
  {
    element: (
      <RequireAuth>
        <PortalLayout />
      </RequireAuth>
    ),
    children: [
      { path: 'submit', element: <SubmitLandingPage /> },
      { path: 'submit/:context', element: <SubmitFormPage /> },
      { path: 'my-requests', element: <MyRequestsPage /> },
    ],
  },
  {
    path: '/welcome',
    element: (
      <RequireAuth>
        <OnboardingPage />
      </RequireAuth>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: 'inbox', element: <InboxPage /> },
      { path: 'requests', element: <RequestsPage /> },
      { path: 'rules', element: <RulesListPage /> },
      { path: 'rules/new', element: <RuleBuilderPage /> },
      { path: 'rules/:id', element: <RuleBuilderPage /> },
      { path: 'decision-tables', element: <DecisionTablesPage /> },
      { path: 'decision-tables/new', element: <DecisionTableEditorPage /> },
      { path: 'decision-tables/:id', element: <DecisionTableEditorPage /> },
      { path: 'workflows', element: <WorkflowsListPage /> },
      { path: 'workflows/new', element: <WorkflowBuilderPage /> },
      { path: 'workflows/:id', element: <WorkflowBuilderPage /> },
      { path: 'sandbox', element: <SandboxPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'fields', element: <FieldsPage /> },
      { path: 'managed-lists', element: <ManagedListsPage /> },
      { path: 'people', element: <PeoplePage /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="webhooks" replace /> },
          { path: 'webhooks', element: <WebhooksSettingsPage /> },
          { path: 'api-keys', element: <ApiKeysPage /> },
        ],
      },
    ],
  },
]);

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
