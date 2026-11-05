import { useMutation, useQuery } from '@tanstack/react-query';
import { defaultPreferences, type Preferences, type PreferencesPatch } from '@luvia/contracts';
import { call } from '@/lib/api';
import { q, queryClient } from '@/lib/query';

export const authStateQuery = q('authState');

export function useAuthState() {
  return useQuery(authStateQuery);
}

export function useUser() {
  return useQuery(authStateQuery).data?.user ?? null;
}

export function useIsAdmin() {
  return useUser()?.role === 'admin';
}

/** 当前用户偏好；未登录时为默认值。 */
export function usePreferences(): Preferences {
  return useUser()?.preferences ?? defaultPreferences();
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** 乐观更新偏好：先改本地，失败回滚。 */
export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => call('updatePreferences', { body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: authStateQuery.queryKey });
      const prev = queryClient.getQueryData(authStateQuery.queryKey);
      if (prev?.user) {
        queryClient.setQueryData(authStateQuery.queryKey, {
          ...prev,
          user: { ...prev.user, preferences: deepMerge(prev.user.preferences, patch) },
        });
      }
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(authStateQuery.queryKey, ctx.prev);
    },
    onSuccess: (prefs) => {
      const cur = queryClient.getQueryData(authStateQuery.queryKey);
      if (cur?.user) queryClient.setQueryData(authStateQuery.queryKey, { ...cur, user: { ...cur.user, preferences: prefs } });
    },
  });
}

export { deepMerge };
