"use client";
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const router = useRouter();

  return (
    <div className="container col">
      <div className="card col" style={{textAlign:'center', gap:16}}>
        <div style={{fontSize:56}}>🕊️✨</div>
        <h1 className="title" style={{fontSize:32, margin:0}}>Chidiya Ud</h1>
        <p className="subtitle" style={{marginTop:0}}>Fast reflex multiplayer — decide if it flies or not!</p>
        <div className="row" style={{justifyContent:'center', gap:8}}>
          <span className="badge">Real‑time</span>
          <span className="badge">Room Codes</span>
          <span className="badge">Mobile Friendly</span>
        </div>
        <div className="spacer" />
        <div className="row">
          <input className="input" placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
        </div>
        <div className="btn-group">
          <button className="btn btn-primary" disabled={!name} onClick={()=>{
            sessionStorage.setItem('name', name);
            router.push('/room/new');
          }}>Create Room</button>
          <div className="row" style={{gap:8}}>
            <input className="input" placeholder="Room code" value={code} onChange={e=>setCode(e.target.value)} />
          </div>
          <button className="btn btn-secondary" disabled={!name || code.length<5} onClick={()=>{
            sessionStorage.setItem('name', name);
            router.push(`/room/${code}`);
          }}>Join Room</button>
        </div>
      </div>

      <div className="spacer" />

      <div className="card col" style={{gap:12}}>
        <h2 className="title" style={{margin:0}}>How to play</h2>
        <ol style={{margin:'0 0 4px 16px', padding:0, color:'#475569'}}>
          <li>Create a room and share the 5‑digit code.</li>
          <li>Everyone joins, toggles Ready, and the host starts.</li>
          <li>See the item and tap Ud or Not Ud before time runs out.</li>
          <li>Wrong or late? Eliminated. Last one alive wins.</li>
        </ol>
      </div>

      <div className="spacer" />

      <footer className="row" style={{justifyContent:'space-between', opacity:.8}}>
        <span className="badge">v0.1</span>
        <span className="badge">Made for friends & fun</span>
      </footer>
    </div>
  );
}
