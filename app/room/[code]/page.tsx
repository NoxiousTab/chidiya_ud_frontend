"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : 'http://localhost:4000');

interface Player { id: string; name: string; avatar: string; ready: boolean; alive: boolean; }
interface Round { itemId: string; itemText: string; itemImage?: string; flies: boolean; roundStartTs: number; deadlineTs: number; }
interface RoomSettings { roundMs: number; intermissionMs: number }
interface Room { code: string; hostId: string; status: 'lobby' | 'playing' | 'game_over'; players: Record<string, Player>; round?: Round; winnerId?: string; settings: RoomSettings }
interface RoundResultsDetail { choice?: 'ud'|'not_ud'; correct: boolean; inTime: boolean }
interface RoundResultsSummary { itemText: string; flies: boolean; perPlayer: Record<string, RoundResultsDetail> }

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const meId: string | undefined = socket?.id;
  const me: Player | undefined = meId ? room?.players[meId] : undefined;
  const [myChoice, setMyChoice] = useState<'ud'|'not_ud'|null>(null);
  const [lastSummary, setLastSummary] = useState<RoundResultsSummary | null>(null);

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);
    const name = sessionStorage.getItem('name') || `Player-${Math.floor(Math.random()*1000)}`;

    s.on('connect', () => {
      if (code === 'new') {
        s.emit('room:create', { name });
      } else {
        s.emit('room:join', { code, name });
      }
    });
    s.on('room:state', (r: Room) => setRoom(r));
    s.on('room:error', ({ message }: { message: string }) => alert(message));
    s.on('player:joined', () => s.emit('room:state'));
    s.on('player:left', () => s.emit('room:state'));
    s.on('round:started', ({ round }: { round: Round }) => {
      setRoom(prev => prev ? { ...prev, status: 'playing', round } : prev);
      setMyChoice(null);
      setProgress(100);
      lastTickRef.current = undefined;
    });
    s.on('round:results', ({ eliminated, survivors, summary }: { eliminated: string[]; survivors: string[]; summary: RoundResultsSummary }) => {
      setLastSummary(summary);
      // Authoritative state will arrive via room:state already
    });

    return () => { s.disconnect(); };
  }, [code]);

  // Timer progress handling using server ticks only, monotonic decrease
  const [progress, setProgress] = useState<number>(100);
  const lastTickRef = React.useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!socket) return;
    const onTick = ({ serverTs, deadlineTs }: { serverTs: number; deadlineTs: number }) => {
      const r = room?.round;
      if (!r) return;
      const total = r.deadlineTs - r.roundStartTs;
      const left = Math.max(0, deadlineTs - serverTs);
      const pct = Math.max(0, Math.min(100, (left / total) * 100));
      // monotonic: never increase
      setProgress(prev => Math.min(prev, pct));
      lastTickRef.current = serverTs;
    };
    socket.on('round:tick', onTick);
    return () => { socket.off('round:tick', onTick); };
  }, [socket, room?.round?.roundStartTs, room?.round?.deadlineTs]);

  const timePct = progress;

  if (!room) return <div className="container"><div className="card">Connecting...</div></div>;

  const isHost = meId === room.hostId;
  const allReady = room && Object.values(room.players).every(p => p.ready);

  return (
    <div className="container col">
      <div className="header">
        <div className="row">
          <div>Room: <b>{room.code}</b></div>
        </div>
        <div className="row">
          <span className={`badge ${room.status==='playing' ? 'success' : room.status==='lobby' ? '' : 'warn'}`}>{room.status}</span>
          {room.status==='lobby' && (
            <span className={`badge ${allReady? 'success':'warn'}`}>{allReady? 'All ready' : 'Waiting'}</span>
          )}
        </div>
      </div>

      {room.status === 'lobby' && (
        <div className="card col game-card">
          <h2 className="title" style={{marginBottom:0}}>Lobby</h2>
          <div className="players">
            {Object.values(room.players).map(p=> (
              <div key={p.id} className="player">
                <span>{p.avatar}</span>
                <span className="name">{p.name}</span>
                <span className={`badge ${p.ready? 'success':'warn'}`}>{p.ready? 'Ready':'Waiting'}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{justifyContent:'space-between'}}>
            <div className="row" style={{gap:8}}>
              <span className="badge">Round: <b>{Math.round((room.settings?.roundMs ?? 4000)/1000)}s</b></span>
              <span className="badge">Break: <b>{Math.round((room.settings?.intermissionMs ?? 1000)/1000)}s</b></span>
            </div>
          </div>
          <div className="btn-group">
            <button className="btn btn-ghost" onClick={()=> socket?.emit('room:ready', { ready: !me?.ready })}>
              {me?.ready ? 'Unready' : 'Ready'}
            </button>
            {isHost && (
              <button className="btn btn-primary" disabled={!allReady} onClick={()=> socket?.emit('game:start')}>Start Game</button>
            )}
          </div>
          {isHost && (
            <div className="col" style={{gap:8}}>
              <label className="subtitle" htmlFor="roundMs">Round duration: {((room.settings?.roundMs ?? 4000)/1000).toFixed(1)}s</label>
              <input id="roundMs" type="range" min={500} max={8000} step={100}
                     value={room.settings?.roundMs ?? 4000}
                     onChange={(e)=> socket?.emit('room:settings', { roundMs: Number(e.target.value) })} />
            </div>
          )}
        </div>
      )}

      {room.status === 'playing' && room.round && (
        <div className="card col game-card">
          <div className="prompt">
            {room.round.itemImage && (
              <img src={room.round.itemImage} alt={room.round.itemText} style={{maxWidth:'220px', width:'100%', display:'block', margin:'0 auto 8px', filter:'drop-shadow(0 10px 16px rgba(2,132,199,.15))'}} />
            )}
            <div className="prompt-badge">✨ {room.round.itemText} ✨</div>
          </div>
          <div className="timer"><div style={{width:`${timePct}%`}} /></div>
          <div className="actions">
            <button className="btn btn-lg btn-ud" disabled={!!myChoice} onClick={()=> { setMyChoice('ud'); socket?.emit('round:answer', { choice: 'ud' }); }}>Ud 🕊️ {myChoice==='ud' ? '✓' : ''}</button>
            <button className="btn btn-lg btn-not" disabled={!!myChoice} onClick={()=> { setMyChoice('not_ud'); socket?.emit('round:answer', { choice: 'not_ud' }); }}>Not Ud 🪨 {myChoice==='not_ud' ? '✓' : ''}</button>
          </div>
          <div className="players">
            {Object.values(room.players).map(p=> (
              <div key={p.id} className={`player ${p.alive? '':'dead'}`}>
                <span>{p.avatar}</span>
                <span className="name">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {room.status === 'game_over' && (
        <div className="card col game-card">
          <h2 className="title">🏆 Winner</h2>
          <div className="players">
            {room.winnerId ? (
              <div className="player"><span>{room.players[room.winnerId]?.avatar}</span><span className="name">{room.players[room.winnerId]?.name}</span></div>
            ) : (
              <div className="player">No winner</div>
            )}
          </div>
          {lastSummary && (
            <div className="col" style={{gap:8}}>
              <h3 className="subtitle" style={{margin:'8px 0 0'}}>Last round</h3>
              <div className="prompt-badge" style={{fontSize:20}}>Word: {lastSummary.itemText} • {lastSummary.flies ? 'Flies' : 'Does not fly'}</div>
              <div className="players">
                {Object.entries(lastSummary.perPlayer).map(([pid, detail]) => (
                  <div key={pid} className="player">
                    <span className="name">{room.players[pid]?.name || 'Player'}</span>
                    <span className={`badge ${detail.correct && detail.inTime ? 'success' : 'warn'}`}>
                      chose {detail.choice ?? 'no answer'} • {detail.inTime ? 'in time' : 'late'} • {detail.correct ? 'correct' : 'wrong'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="btn-group">
            <button className="btn btn-primary" onClick={()=> window.location.href = '/'}>Play Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
