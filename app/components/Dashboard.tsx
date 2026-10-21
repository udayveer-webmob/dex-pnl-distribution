"use client";

import { useCallback, useEffect, useState } from "react";
import type { PositionSummaryDto, WalletDto } from "@/lib/pnl/types";
import { api } from "./api";
import { WalletBar } from "./WalletBar";
import { PositionsTable } from "./PositionsTable";
import { PositionDetail } from "./PositionDetail";

interface Status {
  missingEnv: string[];
  dbError: string | null;
}

export function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallets, setWallets] = useState<WalletDto[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionSummaryDto[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = status !== null && status.missingEnv.length === 0 && !status.dbError;

  useEffect(() => {
    api<Status>("/api/status").then(setStatus, (e: Error) => setError(e.message));
  }, []);

  const loadPositions = useCallback(async (id: string, refresh: boolean) => {
    setLoadingPositions(true);
    try {
      const r = await api<{ positions: PositionSummaryDto[]; syncError: string | null }>(
        `/api/wallets/${id}/positions${refresh ? "?refresh=1" : ""}`,
      );
      setPositions(r.positions);
      setError(r.syncError ? `Could not refresh positions from chain: ${r.syncError}` : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPositions(false);
    }
  }, []);

  const selectWallet = useCallback(
    (id: string | null) => {
      setWalletId(id);
      setPositions([]);
      setPositionId(null);
      if (id) loadPositions(id, false);
    },
    [loadPositions],
  );

  /** Reload the wallet list; select `prefer`, else keep the current wallet, else the first. */
  const loadWallets = useCallback(
    async (prefer?: string) => {
      const list = await api<WalletDto[]>("/api/wallets");
      setWallets(list);
      const keep = prefer ?? walletId;
      const next = keep && list.some((w) => w.id === keep) ? keep : (list[0]?.id ?? null);
      if (next !== walletId) selectWallet(next);
    },
    [walletId, selectWallet],
  );

  useEffect(() => {
    if (!status || status.missingEnv.includes("DATABASE_URL") || status.dbError) return;
    api<WalletDto[]>("/api/wallets").then(
      (list) => {
        setWallets(list);
        if (list[0]) selectWallet(list[0].id);
      },
      (e: Error) => setError(e.message),
    );
  }, [status, selectWallet]);

  // Keep statuses fresh while something is tracked; refresh faster while a backfill is running.
  const backfilling = positions.some((p) => p.status === "BACKFILLING" || p.progress);
  const tracking = positions.some((p) => ["BACKFILLING", "TRACKING", "ERROR"].includes(p.status));
  useEffect(() => {
    if (!walletId || !tracking) return;
    const t = setInterval(() => loadPositions(walletId, false), backfilling ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [walletId, tracking, backfilling, loadPositions]);

  async function addWallet(address: string, label: string) {
    const r = await api<{ wallet: WalletDto; syncError: string | null }>("/api/wallets", {
      method: "POST",
      body: JSON.stringify({ address, label }),
    });
    await loadWallets(r.wallet.id);
    if (r.wallet.id === walletId) await loadPositions(r.wallet.id, false);
    if (r.syncError) setError(`Wallet saved, but positions could not be loaded: ${r.syncError}`);
  }

  async function removeWallet(id: string) {
    await api(`/api/wallets/${id}`, { method: "DELETE" });
    await loadWallets();
  }

  async function setTracking(id: string, track: boolean) {
    await api(`/api/positions/${id}/track`, { method: "POST", body: JSON.stringify({ track }) });
    if (walletId) await loadPositions(walletId, false);
    if (track) setPositionId(id);
  }

  const selected = positions.find((p) => p.id === positionId) ?? null;

  return (
    <main className="w-full flex-1 px-4 py-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Uniswap v3 LP P&amp;L</h1>
          <p className="text-sm text-ink-2">Day-wise realised and unrealised P&amp;L, snapshotted every 2 minutes</p>
        </div>
        <p className="text-xs text-muted">Ethereum mainnet · values in USD · days in UTC</p>
      </header>

      {status && (status.missingEnv.length > 0 || status.dbError) && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-4 text-sm" role="status">
          <p className="font-medium">⚠ Setup needed</p>
          {status.missingEnv.length > 0 && (
            <p className="mt-1 text-ink-2">
              Fill in <code className="font-mono">{status.missingEnv.join(", ")}</code> in <code className="font-mono">.env</code>,
              then restart <code className="font-mono">npm run dev</code>.
            </p>
          )}
          {status.dbError && <p className="mt-1 text-ink-2">Database not reachable: {status.dbError}</p>}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-3 text-sm" role="alert">
          <p>
            <span className="font-medium text-negative">✕ Error</span> <span className="text-ink-2">{error}</span>
          </p>
          <button className="text-muted hover:text-ink" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <WalletBar
        wallets={wallets}
        selectedId={walletId}
        disabled={!ready}
        onSelect={selectWallet}
        onAdd={addWallet}
        onRemove={removeWallet}
      />

      {walletId && (
        <PositionsTable
          positions={positions}
          selectedId={positionId}
          loading={loadingPositions}
          onSelect={setPositionId}
          onRefresh={() => loadPositions(walletId, true)}
          onTrack={setTracking}
        />
      )}

      {selected && <PositionDetail key={selected.id} summary={selected} />}
    </main>
  );
}
