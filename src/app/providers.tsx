'use client';
// Providers — composes Store, Theme, Wizard, and narrative-scoped Logs context providers.

import { LogsProvider } from '@/lib/state/logs-context';
import { StoreProvider, useStore } from '@/lib/state/store';
import { ThemeProvider } from '@/lib/state/theme-context';
import { WizardProvider } from '@/lib/state/wizard-context';
import type { ReactNode } from 'react';

// Bridge component that reads activeNarrativeId from store and passes to LogsProvider
function LogsProviderBridge({ children }: { children: ReactNode }) {
  const { state } = useStore();
  return (
    <LogsProvider activeNarrativeId={state.activeNarrativeId}>
      {children}
    </LogsProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <StoreProvider>
        <WizardProvider>
          <LogsProviderBridge>{children}</LogsProviderBridge>
        </WizardProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
