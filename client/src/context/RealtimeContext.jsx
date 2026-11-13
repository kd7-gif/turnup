import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

// One live connection for signed-in hosts and door staff. Pages subscribe to events and refetch what they show.
const RealtimeContext = createContext({ connected: false, socket: null });

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const wanted = Boolean(user?.can_host || user?.can_check_in);

  useEffect(() => {
    if (!wanted) return undefined;
    const s = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    s.on('ready', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setSocket(s);
    return () => { s.close(); setSocket(null); setConnected(false); };
  }, [user?.id, wanted]); // reconnect only when a different person signs in

  return <RealtimeContext.Provider value={{ connected, socket }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Calls `handler` whenever the server sends `event`. The handler can change between renders. */
export function useLiveEvent(event, handler) {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (data) => ref.current(data);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}
