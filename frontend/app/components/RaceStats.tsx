import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function RaceStats() {
  const { frames, connected, mode, raceId } = useRaceWebSocket();

  if (!connected || frames.length === 0) {
    return (
      <div className="p-2 text-zinc-400">
        Waiting for data...
      </div>
    );
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

  const driverNames: Record<number | string, string> = {
    44: "Lewis Hamilton",
    77: "Valtteri Bottas",
    33: "Max Verstappen",
    11: "Sergio Pérez",
    55: "Carlos Sainz",
  };

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-4 rounded-lg border border-zinc-700 text-zinc-200 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">Race Overview</div>
        <div className="text-xs text-zinc-400">
          {mode === 'replay' && raceId && (
            <span>Replay: {raceId}</span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Lap:</span>
          <span className="font-mono">{lap}</span>
        </div>
        <div className="flex justify-between">
          <span>Drivers:</span>
          <span className="font-mono">{driverCount}</span>
        </div>
        <div className="flex justify-between">
          <span>Leader:</span>
          <span className="font-mono">
            {leader.driver != null ? (
              <>
                {driverNames[leader.driver as number] || `Driver ${leader.driver}`} (P{(leader.position ?? 0).toFixed(2)})
              </>
            ) : (
              "?"
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Fastest:</span>
          <span className="font-mono">
            {fastest.driver != null ? (
              <>
                {driverNames[fastest.driver as number] || `Driver ${fastest.driver}`} ({fastest.speed.toFixed(0)} km/h)
              </>
            ) : (
              "?"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}