import type { AuthUser } from '../api';

const SAVED_ACCOUNTS_KEY = 'polycast:saved-accounts';

export interface SavedAccount {
  id: string;
  username: string;
  display_name: string;
  account_type: 'student' | 'teacher';
  token: string;
  last_used_at: string;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadSavedAccounts(): SavedAccount[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((account): account is SavedAccount =>
      Boolean(account) &&
      typeof account.id === 'string' &&
      typeof account.username === 'string' &&
      typeof account.display_name === 'string' &&
      (account.account_type === 'student' || account.account_type === 'teacher') &&
      typeof account.token === 'string' &&
      typeof account.last_used_at === 'string',
    );
  } catch {
    return [];
  }
}

function saveSavedAccounts(accounts: SavedAccount[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function upsertSavedAccount(user: Pick<AuthUser, 'id' | 'username' | 'display_name' | 'account_type'>, token: string): SavedAccount[] {
  const nextAccount: SavedAccount = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    account_type: user.account_type,
    token,
    last_used_at: new Date().toISOString(),
  };

  const accounts = loadSavedAccounts().filter((account) => account.id !== user.id);
  const nextAccounts = [nextAccount, ...accounts]
    .sort((a, b) => new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime());

  saveSavedAccounts(nextAccounts);
  return nextAccounts;
}

export function removeSavedAccount(userId: string): SavedAccount[] {
  const nextAccounts = loadSavedAccounts().filter((account) => account.id !== userId);
  saveSavedAccounts(nextAccounts);
  return nextAccounts;
}
