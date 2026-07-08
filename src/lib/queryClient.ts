import { QueryClient } from "@tanstack/react-query";

// Shared singleton — split into its own module (rather than living in
// App.tsx where it was originally created) so store/index.ts can also
// import it, to wipe every cached Navidrome query on switchServer/logout
// without a circular App.tsx <-> store import.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  1000 * 60 * 5,   // 5 min — data is fresh, no background refetch
      gcTime:     1000 * 60 * 30,  // 30 min — inactive data kept in RAM
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
