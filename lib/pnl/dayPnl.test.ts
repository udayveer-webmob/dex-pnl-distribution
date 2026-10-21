import { describe, expect, it } from "vitest";
import { buildDayPnl, type CloseSnapshot } from "./dayPnl";

const snap = (date: string, v: Partial<CloseSnapshot>): CloseSnapshot => ({
  date,
  timestamp: new Date(`${date}T23:59:59Z`),
  rFeeIncome: 0,
  rGasCost: 0,
  rFeeReval: 0,
  rPriceEffect: 0,
  rIl: 0,
  uPriceEffect: 0,
  uIl: 0,
  uFeeReval: 0,
  realisedTotal: 0,
  unrealisedTotal: 0,
  totalPnl: 0,
  ...v,
});

describe("buildDayPnl", () => {
  it("takes each day as close minus the previous close, first day from zero", () => {
    const rows = buildDayPnl([
      snap("2026-10-01", { rFeeIncome: 3, rGasCost: -2, uPriceEffect: -19.54, uIl: -0.36, totalPnl: -18.9 }),
      snap("2026-10-02", { rFeeIncome: 5.2, rGasCost: -2, uPriceEffect: -274.02, uIl: -72.75, uFeeReval: -0.07, totalPnl: -343.64 }),
    ]);
    expect(rows[0].openAt).toBeNull();
    expect(rows[0].pnl).toBeCloseTo(-18.9);
    expect(rows[1].openAt).toBe("2026-10-01T23:59:59.000Z");
    expect(rows[1].pnl).toBeCloseTo(-324.74);
    expect(rows[1].components.feeIncome).toBeCloseTo(2.2);
    expect(rows[1].components.priceEffect).toBeCloseTo(-254.48);
    expect(rows[1].components.positionalChange).toBeCloseTo(-72.39);
    expect(rows[1].components.feeReval).toBeCloseTo(-0.07);
  });

  it("is unaffected by moving P&L from unrealised to realised", () => {
    const rows = buildDayPnl([
      snap("2026-10-04", { uPriceEffect: 44.09, uIl: -1.83, totalPnl: 42.26 }),
      snap("2026-10-05", { rPriceEffect: -61.94, rIl: -3.65, totalPnl: -65.59 }),
    ]);
    expect(rows[1].components.priceEffect).toBeCloseTo(-106.03);
    expect(rows[1].components.positionalChange).toBeCloseTo(-1.82);
    expect(rows[1].pnl).toBeCloseTo(-107.85);
  });
});
