import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { TrackTable } from "../components/TrackTable";

export function Tracks() {
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => api.getTracks(2000, 0),
  });

  return (
    <div className="flex flex-col h-full" style={{ padding: 12 }}>
      <TrackTable tracks={tracks} loading={isLoading} />
    </div>
  );
}
