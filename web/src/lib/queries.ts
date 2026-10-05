import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './api';

export const keys = {
  auth: ['auth'] as const,
  me: ['me'] as const,
  history: ['history'] as const,
  op: (kind: string, id: string) => ['op', kind, id] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 5_000, refetchInterval: 30_000 });

export const useHistory = () =>
  useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam }) => api.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  });

/** Balance and history change together; refresh both after any money movement. */
export function useRefreshWallet() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: keys.me });
    void qc.invalidateQueries({ queryKey: keys.history });
  }, [qc]);
}
