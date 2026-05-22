"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from "react";
import type { WizardStep, WizardData, ProseProfile, ArchetypeKey } from "@/types/narrative";

// ── Types ────────────────────────────────────────────────────────────────────

export type WizardState = {
  isOpen: boolean;
  step: WizardStep;
  data: WizardData;
};

export type WizardAction =
  | { type: "OPEN"; prefill?: string; prefillData?: Partial<WizardData> }
  | { type: "CLOSE" }
  | { type: "SET_STEP"; step: WizardStep }
  | { type: "UPDATE_DATA"; data: Partial<WizardData> };

// ── Initial State ────────────────────────────────────────────────────────────

const initialWizardData: WizardData = {
  title: "",
  premise: "",
  paradigm: "fiction",
  characters: [],
  locations: [],
  threads: [],
};

const initialState: WizardState = {
  isOpen: false,
  step: "form",
  data: initialWizardData,
};

// ── Reducer ──────────────────────────────────────────────────────────────────

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "OPEN":
      return {
        ...state,
        isOpen: true,
        step: action.prefillData ? "details" : "form",
        data: {
          ...initialWizardData,
          premise: action.prefill ?? "",
          ...action.prefillData,
        },
      };
    case "CLOSE":
      return { ...state, isOpen: false };
    case "SET_STEP":
      return { ...state, step: action.step };
    case "UPDATE_DATA":
      return { ...state, data: { ...state.data, ...action.data } };
    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

type WizardContextValue = {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
};

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return ctx;
}
