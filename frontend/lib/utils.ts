import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(dm)} ${sizes[i]}`;
}

export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  if (seconds < 1) return "<1s";

  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}g`);
  if (hours > 0) parts.push(`${hours}s`);
  if (minutes > 0) parts.push(`${minutes}d`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}sn`);

  return parts.join(" ");
}

export function formatDateAgo(date: string | Date | number): string {
  if (!date) return "-";

  const now = new Date().getTime();
  const target =
    typeof date === "string"
      ? new Date(date).getTime()
      : date instanceof Date
        ? date.getTime()
        : date;

  const diffMs = now - target;
  if (diffMs < 0) return formatDate(new Date(target));

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds} sn önce`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün önce`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} hf önce`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ay önce`;

  const years = Math.floor(days / 365);
  return `${years} yıl önce`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1) return "<1ms";

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  }

  const totalMinutes = totalSeconds / 60;
  if (totalMinutes < 60) {
    const m = Math.floor(totalMinutes);
    const s = Math.round(totalSeconds - m * 60);
    return s > 0 ? `${m}d ${s}sn` : `${m}d`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes - hours * 60);
  return m > 0 ? `${hours}sa ${m}d` : `${hours}sa`;
}

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";

  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPercent(
  value: number,
  total: number,
  decimals = 1
): string {
  if (!total || !Number.isFinite(value) || !Number.isFinite(total)) {
    return "0%";
  }
  const pct = (value / total) * 100;
  return `${pct.toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("tr-TR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}
