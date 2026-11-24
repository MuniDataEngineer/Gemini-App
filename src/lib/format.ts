export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: safe % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonthISO(): string {
  return todayISO().slice(0, 7);
}

export function formatMonthLabel(ym: string): string {
  if (!ym || ym === 'all') return 'All Months';
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const year = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  const date = new Date(year, monthIdx, 1);
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function formatDateShort(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

let inMemoryAuthToken: string | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorizedCallback = handler;
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const authHeader: Record<string, string> = inMemoryAuthToken
    ? { Authorization: `Bearer ${inMemoryAuthToken}` }
    : {};

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof ArrayBuffer || options?.body instanceof Uint8Array
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...authHeader,
      ...(options?.headers || {}),
    },
  });

  const text = await res.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }

  if (
    res.status === 401 &&
    !url.startsWith('/api/auth/login') &&
    !url.startsWith('/api/auth/change-password') &&
    onUnauthorizedCallback
  ) {
    onUnauthorizedCallback();
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: string }).error)
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }

  return parsed as T;
}

export async function downloadAuthorizedFile(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const headers: Record<string, string> = inMemoryAuthToken
    ? { Authorization: `Bearer ${inMemoryAuthToken}` }
    : {};

  const res = await fetch(url, { headers });
  if (res.status === 401 && onUnauthorizedCallback) {
    onUnauthorizedCallback();
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Download failed with status ${res.status}`);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
