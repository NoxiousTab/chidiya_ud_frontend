"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : 'http://localhost:4000');

interface Player { id: string; name: string; avatar: string; ready: boolean; alive: boolean; failedAtWord?: string; failedChoice?: 'ud'|'not_ud' }
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
  const [showResults, setShowResults] = useState<boolean>(false);
  const resultsTimerRef = React.useRef<number | null>(null);
  const [showCountdown, setShowCountdown] = useState<boolean>(false);
  const [countdownText, setCountdownText] = useState<string>('');
  const [isFirstRound, setIsFirstRound] = useState<boolean>(false);
  const isFirstRoundRef = React.useRef<boolean>(false);
  const [iAmOut, setIAmOut] = useState<boolean>(false);
  const [eliminatedWord, setEliminatedWord] = useState<string | null>(null);
  const [tapUd, setTapUd] = useState(false);
  const [tapNot, setTapNot] = useState(false);
  const countdownTimersRef = React.useRef<number[]>([]);
  const audioRef = React.useRef<AudioContext | null>(null);
  const ensureAudio = () => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) audioRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioRef.current;
  };
  const beep = (freq: number, ms: number, gain=0.03) => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g).connect(ctx.destination);
    const now = ctx.currentTime;
    o.start(now);
    o.stop(now + ms/1000);
  };

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
    s.on('room:state', (r: Room) => {
      setRoom(r);
      const meNow = r.players[s.id!];
      if (meNow && !meNow.alive) {
        setIAmOut(true);
        if (meNow.failedAtWord) setEliminatedWord(meNow.failedAtWord);
      }
    });
    s.on('room:error', ({ message }: { message: string }) => alert(message));
    s.on('player:joined', () => s.emit('room:state'));
    s.on('player:left', () => s.emit('room:state'));
    s.on('game:started', () => {
      setIsFirstRound(true);
      isFirstRoundRef.current = true;
      setIAmOut(false);
      setEliminatedWord(null);
    });
    s.on('round:started', ({ round }: { round: Round }) => {
      setRoom(prev => prev ? { ...prev, status: 'playing', round } : prev);
      setMyChoice(null);
      setProgress(100);
      lastTickRef.current = undefined;
      setShowResults(false);
      if (resultsTimerRef.current) { clearTimeout(resultsTimerRef.current); resultsTimerRef.current = null; }
      // Clear any existing countdown timers
      countdownTimersRef.current.forEach(id => clearTimeout(id));
      countdownTimersRef.current = [];
      // Show Ready/Go only before the first round (use ref to avoid stale state in handler)
      if (isFirstRoundRef.current) {
        setShowCountdown(true);
        setCountdownText('Ready');
        beep(600, 90);
        const t1 = window.setTimeout(() => { setCountdownText('Go!'); beep(900, 120); }, 700);
        const t2 = window.setTimeout(() => { setShowCountdown(false); }, 1200);
        countdownTimersRef.current.push(t1 as unknown as number, t2 as unknown as number);
        setIsFirstRound(false);
        isFirstRoundRef.current = false;
      }
    });
    s.on('round:results', ({ eliminated, survivors, summary }: { eliminated: string[]; survivors: string[]; summary: RoundResultsSummary }) => {
      setLastSummary(summary);
      if (meId && eliminated.includes(meId)) {
        setShowResults(true);
        setIAmOut(true);
        setEliminatedWord(summary.itemText);
        const inter = (room?.settings?.intermissionMs ?? 1000);
        if (resultsTimerRef.current) { clearTimeout(resultsTimerRef.current); }
        resultsTimerRef.current = window.setTimeout(() => { setShowResults(false); resultsTimerRef.current = null; }, Math.max(300, inter - 50)) as unknown as number;
      } else {
        setShowResults(false);
      }
    });
    // Personal elimination event: immediate feedback after a wrong answer
    s.on('you:eliminated', ({ word }: { word: string }) => {
      setIAmOut(true);
      setEliminatedWord(word);
      setShowResults(true);
      if (resultsTimerRef.current) { clearTimeout(resultsTimerRef.current); }
      resultsTimerRef.current = window.setTimeout(() => { setShowResults(false); resultsTimerRef.current = null; }, 900) as unknown as number;
    });

    return () => {
      s.disconnect();
      if (resultsTimerRef.current) { clearTimeout(resultsTimerRef.current); resultsTimerRef.current = null; }
    };
  }, [code]);

  // Timer progress handling using server ticks only, monotonic decrease
  const [progress, setProgress] = useState<number>(100);
  const lastTickRef = React.useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!socket) return;
    const onTick = ({ serverTs, deadlineTs }: { serverTs: number; deadlineTs: number }) => {
      const r = room?.round;
      if (!r) return;
      // Keep timer full during pre-start countdown
      if (serverTs < r.roundStartTs) { setProgress(100); return; }
      const total = r.deadlineTs - r.roundStartTs;
      const left = Math.max(0, deadlineTs - serverTs);
      const pct = Math.max(0, Math.min(100, (left / total) * 100));
      // monotonic: never increase
      setProgress(prev => Math.min(prev, pct));
      lastTickRef.current = serverTs;
      // Do not hide the countdown on tick; it will auto-hide by timer
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
          <div className="row" style={{marginLeft:'auto', gap:8}}>
            <button className="btn btn-ghost" onClick={() => { socket?.emit('room:leave'); router.push('/'); }}>Leave Room</button>
          </div>
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

      {room.status === 'playing' && room.round && !iAmOut && (
        <div className="card col game-card">
          <div className="prompt">
            {room.round.itemImage && (
              <img src={room.round.itemImage} alt={room.round.itemText} style={{maxWidth:'220px', width:'100%', display:'block', margin:'0 auto 8px', filter:'drop-shadow(0 10px 16px rgba(2,132,199,.15))'}} />
            )}
            <div className="prompt-badge">✨ {room.round.itemText} ✨</div>
          </div>
          <div className="timer"><div style={{width:`${timePct}%`}} /></div>
          <div className="actions">
            <button
              className={`btn btn-lg btn-ud ${tapUd ? 'tap' : ''} ${myChoice==='ud' ? 'selected' : ''}`}
              disabled={!!myChoice}
              onMouseDown={()=>{ setTapUd(true); setTimeout(()=>setTapUd(false), 120); }}
              onClick={()=> { setMyChoice('ud'); beep(700,100); socket?.emit('round:answer', { choice: 'ud' }); }}
            >Ud 🕊️ {myChoice==='ud' ? '🔒' : ''}</button>
            <button
              className={`btn btn-lg btn-not ${tapNot ? 'tap' : ''} ${myChoice==='not_ud' ? 'selected' : ''}`}
              disabled={!!myChoice}
              onMouseDown={()=>{ setTapNot(true); setTimeout(()=>setTapNot(false), 120); }}
              onClick={()=> { setMyChoice('not_ud'); beep(500,100); socket?.emit('round:answer', { choice: 'not_ud' }); }}
            >Not Ud 🪨 {myChoice==='not_ud' ? '🔒' : ''}</button>
          </div>
          <div className="players">
            {Object.values(room.players).map(p=> (
              <div key={p.id} className={`player ${p.alive? '':'dead'}`}>
                <span>{p.avatar}</span>
                <span className="name">{p.name}</span>
                <span className={`badge ${p.alive? 'success':'warn'}`}>
                  {p.alive ? 'Alive' : 'Eliminated'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {room.status === 'playing' && iAmOut && (
        <div className="card col game-card">
          <h2 className="title">You are eliminated</h2>
          {lastSummary && (
            <div className="col" style={{gap:8}}>
              <div className="prompt-badge" style={{fontSize:18}}>Word: {lastSummary.itemText} • {lastSummary.flies ? 'Flies' : 'Does not fly'}</div>
              <div className="players">
                {Object.values(room.players).map(p=> (
                  <div key={p.id} className={`player ${p.alive? '':'dead'}`}>
                    <span>{p.avatar}</span>
                    <span className="name">{p.name}</span>
                    <span className={`badge ${p.alive? 'success':'warn'}`}>
                      {p.alive ? 'Alive' : `Eliminated${p.failedAtWord ? ` on "${p.failedAtWord}"` : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="subtitle" style={{marginTop:8}}>Waiting for the game to finish…</div>
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
          <h3 className="subtitle" style={{margin:'12px 0 4px'}}>How everyone lost</h3>
          <div className="players">
            {Object.values(room.players)
              .filter(p => p.id !== room.winnerId)
              .map(p => (
                <div key={p.id} className={`player ${p.alive? '':'dead'}`}>
                  <span>{p.avatar}</span>
                  <span className="name">{p.name}</span>
                  <span className="badge warn">
                    {p.failedAtWord ? `on "${p.failedAtWord}"` : 'no record'}{p.failedChoice ? ` • chose ${p.failedChoice}` : ''}
                  </span>
                </div>
              ))}
          </div>
          <div className="btn-group">
            {isHost ? (
              <button className="btn btn-primary" onClick={()=> socket?.emit('room:reset')}>Return to Lobby</button>
            ) : (
              <button className="btn btn-primary" disabled>Return to Lobby (waiting for host)</button>
            )}
          </div>
        </div>
      )}

      {showCountdown && (
        <div className="overlay">
          <div className="countdown">{countdownText}</div>
        </div>
      )}

      {showResults && lastSummary && (
        <div className="overlay">
          <div className="card col" style={{gap:8, padding:'16px 18px', maxWidth:480}}>
            <h3 className="title" style={{margin:'0 0 4px'}}>Results</h3>
            <div className="prompt-badge" style={{fontSize:18}}>Word: {lastSummary.itemText} • {lastSummary.flies ? 'Flies' : 'Does not fly'}</div>
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
        </div>
      )}
    </div>
  );
}
