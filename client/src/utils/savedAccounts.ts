export interface SavedAccount {
  id: string;
  username: string;
  display_name: string;
  account_type: 'student' | 'teacher';
  last_used_at: string;
}

// One-time removal of the legacy bearer-token profile cache. Account switching
// is now backed by an HttpOnly opaque profile-session cookie.
if (typeof window !== 'undefined') {
  window.localStorage.removeItem('polycast:saved-accounts');
}
