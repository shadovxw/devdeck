import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { TopicSocket, type SocketStatus } from "./ws";

const SocketContext = createContext<TopicSocket | null>(null);

function socketUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

/** `socket` lets a test supply its own; the app lets the provider make one. */
export function SocketProvider({ children, socket: given }: { children: ReactNode; socket?: TopicSocket }) {
  const [socket] = useState(() => given ?? new TopicSocket({ url: socketUrl() }));
  useEffect(() => {
    socket.connect();
    return () => socket.close();
  }, [socket]);
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

const never = () => () => {};
const closed = (): SocketStatus => "closed";

/** Connection state of the live-data socket. */
export function useSocketStatus(): SocketStatus {
  const socket = useContext(SocketContext);
  return useSyncExternalStore(socket?.onStatus ?? never, socket?.getStatus ?? closed);
}

/** Calls handler for every event on topic. Use for streams such as logs. */
export function useTopicHandler<T = unknown>(topic: string, handler: (data: T, topic: string) => void): void {
  const socket = useContext(SocketContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!socket) return;
    return socket.subscribe(topic, (data, t) => latest.current(data as T, t));
  }, [socket, topic]);
}

/** The most recent value on topic, or undefined until one arrives. */
export function useTopic<T = unknown>(topic: string): T | undefined {
  const [value, setValue] = useState<T>();
  useTopicHandler<T>(topic, setValue);
  return value;
}
