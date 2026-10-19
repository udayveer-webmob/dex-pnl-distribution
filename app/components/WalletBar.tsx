"use client";

import { useState } from "react";
import type { WalletDto } from "@/lib/pnl/types";
import { shortAddress } from "@/lib/format";

interface Props {
  wallets: WalletDto[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onAdd: (address: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function WalletBar({ wallets, selectedId, disabled, onSelect, onAdd, onRemove }: Props) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd(address, label);
      setAddress("");
      setLabel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-4">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Wallet address 0x…"
          aria-label="Wallet address"
          className="min-w-0 flex-[3_1_18rem] rounded-md border border-line bg-page px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          disabled={disabled || busy}
          required
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Wallet label"
          className="min-w-0 flex-[1_1_10rem] rounded-md border border-line bg-page px-3 py-2 text-sm outline-none focus:border-accent"
          disabled={disabled || busy}
        />
        <button
          type="submit"
          disabled={disabled || busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add wallet"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {wallets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Wallets">
          {wallets.map((w) => {
            const active = w.id === selectedId;
            return (
              <div
                key={w.id}
                className={`flex items-center rounded-full border text-sm ${active ? "border-accent bg-surface-2" : "border-line"}`}
              >
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelect(w.id)}
                  className="py-1 pl-3 pr-2"
                  title={w.address}
                >
                  {w.label ? <span className="font-medium">{w.label} </span> : null}
                  <span className="font-mono text-ink-2">{shortAddress(w.address)}</span>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Remove wallet ${w.label ?? w.address} and all its stored snapshots?`)) onRemove(w.id);
                  }}
                  className="py-1 pl-1 pr-3 text-muted hover:text-negative"
                  aria-label={`Remove wallet ${w.address}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
