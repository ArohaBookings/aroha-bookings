export type OnboardingState = {
  step: number;
  completed: boolean;
  skipped: boolean;
  updatedAt?: string | null;
};

const MIN_STEP = 1;
const MAX_STEP = 5;

export function resolveOnboardingState(data: Record<string, unknown>): OnboardingState {
  const raw = (data.onboarding as Partial<OnboardingState>) || {};
  const step =
    typeof raw.step === "number" && raw.step >= MIN_STEP && raw.step <= MAX_STEP
      ? raw.step
      : MIN_STEP;
  return {
    step,
    completed: raw.completed ?? false,
    skipped: raw.skipped ?? false,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

export function mergeOnboardingState(
  current: OnboardingState,
  patch: Partial<OnboardingState>
): OnboardingState {
  const nextStep =
    typeof patch.step === "number" && patch.step >= MIN_STEP && patch.step <= MAX_STEP
      ? patch.step
      : current.step;
  const completed = typeof patch.completed === "boolean" ? patch.completed : current.completed;
  const skipped = typeof patch.skipped === "boolean" ? patch.skipped : current.skipped;

  return {
    ...current,
    step: nextStep,
    completed,
    skipped: completed ? false : skipped,
    updatedAt: new Date().toISOString(),
  };
}
