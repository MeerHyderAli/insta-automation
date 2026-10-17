import { createContext, useContext } from 'react';
import type { Api, Counts } from '../lib/api';
import type { MeResponse, Workspace } from '../lib/types';

export interface WorkspaceContextValue {
  workspace: Workspace;
  counts: Counts;
  me: MeResponse;
  api: Api;
  reload: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside the workspace layout.');
  return context;
}
