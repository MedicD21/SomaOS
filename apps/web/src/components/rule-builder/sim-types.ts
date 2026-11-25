/** Serializable simulation results shared by the server runners and the result panels (no server imports). */

export type SimLine = { code: string; multiplier: number; hours: number; amount: number | null };

export type PaySimColumn = {
  hours: number;
  amount: number | null;
  compHours: number;
  lines: SimLine[];
  /** Why this column has no result (for example no approved rules yet). */
  problem: string | null;
};

export type PaySim = {
  kind: 'pay';
  mode: 'period' | 'sample';
  heading: string;
  rows: { id: string; name: string; approved: PaySimColumn | null; draft: PaySimColumn | null }[];
  totals: { approvedHours: number; draftHours: number; approvedAmount: number | null; draftAmount: number | null };
  notes: string[];
};

export type AccrualColumn = { hours: number; balanceAfter: number; expired: number; capped: boolean };

export type AccrualSim = {
  kind: 'accrual';
  heading: string;
  rows: { period: string; approved: AccrualColumn | null; draft: AccrualColumn | null; explain: string[] }[];
  notes: string[];
};

export type PatternSim = {
  kind: 'pattern';
  heading: string;
  days: { date: string; approved: boolean; draft: boolean }[];
  added: string[];
  removed: string[];
  approvedHours: number;
  draftHours: number;
  /** Generated, still-scheduled shifts from tomorrow that approving would withdraw (regenerate afterwards). */
  replaced: number;
  notes: string[];
};

export type SimResult = PaySim | AccrualSim | PatternSim;

/** What a simulate action returns to the panel. */
export type SimState = {
  ok: boolean | null;
  message: string | null;
  fieldErrors?: Record<string, string>;
  sim?: SimResult;
  token?: string;
  /** For display only: "Simulated draft v3 at 14:02". */
  simulatedAt?: string;
};
