"""Lock models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class LockInfo(BaseModel):
    """One blocked -> blocking relationship."""

    model_config = ConfigDict(frozen=True)

    blocking_pid: int
    blocked_pid: int
    blocking_user: str | None = None
    blocked_user: str | None = None
    database: str | None = None
    relation: str | None = None
    lock_type: str | None = None
    blocked_mode: str | None = None
    blocking_mode: str | None = None
    blocking_duration_seconds: float | None = None
    blocking_query: str | None = None
    blocked_query: str | None = None


class LockSummary(BaseModel):
    """Aggregate lock counters."""

    model_config = ConfigDict(frozen=True)

    total_locks: int = 0
    waiting_locks: int = 0
    blocking_pairs: int = 0
    by_mode: dict[str, int] = Field(default_factory=dict)


class LockReport(BaseModel):
    """Blocking pairs, per-mode summary and printable blocking chains."""

    model_config = ConfigDict(frozen=True)

    summary: LockSummary = Field(default_factory=LockSummary)
    locks: list[LockInfo] = Field(default_factory=list)
    chains: list[str] = Field(default_factory=list)


def build_blocking_chains(locks: list[LockInfo]) -> list[str]:
    """Render blocking chains like ``PID 123 -> PID 456 -> PID 789``.

    Each chain starts at a blocker that is itself not blocked and follows
    blocked PIDs transitively. Pure function over LockInfo rows.
    """
    if not locks:
        return []
    blocked_to_blocker = {lock.blocked_pid: lock.blocking_pid for lock in locks}
    blocked_pids = set(blocked_to_blocker)
    roots = sorted({lock.blocking_pid for lock in locks} - blocked_pids)
    if not roots:  # pure cycle — start anywhere deterministic
        roots = sorted({lock.blocking_pid for lock in locks})
    chains: list[str] = []
    visited_global: set[int] = set()
    for root in roots:
        chain = [root]
        visited_global.add(root)
        current = root
        # follow root -> first blocked -> ... via reverse mapping
        children = sorted(pid for pid, blocker in blocked_to_blocker.items() if blocker == current)
        while children:
            nxt = next((c for c in children if c not in chain), None)
            if nxt is None:
                break
            chain.append(nxt)
            current = nxt
            children = sorted(
                pid for pid, blocker in blocked_to_blocker.items() if blocker == current
            )
        chains.append(" -> ".join(f"PID {pid}" for pid in chain))
    # Any disconnected blocked pid not covered (cycle leftovers) gets its own chain.
    covered = {pid for chain in chains for pid in _chain_pids(chain)}
    for pid in sorted(blocked_pids - covered):
        chains.append(f"PID {blocked_to_blocker[pid]} -> PID {pid}")
    return chains


def _chain_pids(chain: str) -> list[int]:
    pids: list[int] = []
    for part in chain.split("->"):
        part = part.strip()
        if part.startswith("PID "):
            try:
                pids.append(int(part[4:]))
            except ValueError:
                continue
    return pids
