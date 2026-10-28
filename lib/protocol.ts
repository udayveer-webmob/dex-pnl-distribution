// Protocol-specific labels for the shared P&L views. Compound III reuses the Uniswap fields:
// fee* = supply interest, reward* = COMP rewards, and IL is always zero.

import type { DailyRowDto, ProtocolDto } from "@/lib/pnl/types";

export type DailyComponentKey = keyof Pick<
  DailyRowDto["daily"],
  "priceEffect" | "ilChange" | "feeIncome" | "feeReval" | "rewardIncome" | "rewardReval" | "gasCost"
>;

export interface ComponentDef {
  key: DailyComponentKey;
  label: string;
  color: string;
}

/** Daily P&L components in fixed colour order. Price effect is always first. */
export function dailyComponents(protocol: ProtocolDto): ComponentDef[] {
  return protocol === "COMPOUND_V3"
    ? [
        { key: "priceEffect", label: "Price effect (U)", color: "var(--series-1)" },
        { key: "feeIncome", label: "Interest income (R)", color: "var(--series-2)" },
        { key: "rewardIncome", label: "COMP income (R)", color: "var(--series-3)" },
        { key: "feeReval", label: "Interest revaluation (U)", color: "var(--series-4)" },
        { key: "rewardReval", label: "COMP revaluation (U)", color: "var(--series-5)" },
        { key: "gasCost", label: "Gas (R)", color: "var(--series-6)" },
      ]
    : [
        { key: "priceEffect", label: "Price effect (U)", color: "var(--series-1)" },
        { key: "ilChange", label: "IL change (U)", color: "var(--series-2)" },
        { key: "feeIncome", label: "Fee income (R)", color: "var(--series-3)" },
        { key: "feeReval", label: "Fee revaluation (U)", color: "var(--series-4)" },
        { key: "gasCost", label: "Gas (R)", color: "var(--series-5)" },
      ];
}

export const incomeLabel = (protocol: ProtocolDto) => (protocol === "COMPOUND_V3" ? "Interest" : "Fee");
