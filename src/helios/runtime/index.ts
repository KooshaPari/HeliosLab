import { InMemoryLocalBus } from "./protocol/bus";

export function createRuntime() {
  const bus = new InMemoryLocalBus();
  return {
    bus,
    getState: () => bus.getState(),
    getEvents: () => bus.getEvents(),
  };
}
