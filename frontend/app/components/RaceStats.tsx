import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function RaceStats() {
  const { frames, connected } = useRaceWebSocket();

  if (!connected || frames.length === 0) {
    return <div className="p-2 text-zinc-400">Waiting for data...</div>;
  }

  const lap = frames[0].lap ?? 0;
  const driverCount = frames.length;
  // Find fastest speed
  const fastest = frames.reduce((max, f) => (f.speed > max.speed ? f : max), frames[0]);
  // Find leader: lowest position value (0.0 = start/finish line, lower is ahead)
  const leader = frames.reduce((leader, f) => {
    const fPos = f.position ?? 1.0;
    const lPos = leader.position ?? 1.0;
    return fPos < lPos ? f : leader;
  }, frames[0]);

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-700 text-zinc-200 text-sm">
      <div className="font-medium mb-1">Race Overview</div>
      <div className="space-y-1">
        <div>Lap: <span className="font-mono">{lap}</span></div>
        <div>Drivers: <span className="font-mono">{driverCount}</span></div>
        <div>
          Leader: P{(leader.position ?? "?")} Driver {(leader.driver ?? "?")}
        </div>
        <div>
          Fastest: <span className="font-mono">{fastest.speed.toFixed(0)} km/h</span> (Driver {(fastest.driver ?? "?")})
        </div>
      </div>
    </div>
  );
}