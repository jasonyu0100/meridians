'use client';

import { LogsProvider } from '@/lib/logs-context';
import { StoreProvider, useStore } from '@/lib/store';
import { ThemeProvider } from '@/lib/theme-context';
import { WizardProvider } from '@/lib/wizard-context';
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
