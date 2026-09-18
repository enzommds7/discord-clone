import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Hash, Volume2, Plus, LogOut, Settings, Video, Mic, MicOff, VideoOff, MonitorUp } from 'lucide-react';

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

export default function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);

  const [servers, setServers] = useState<any[]>([]);
  const [activeServer, setActiveServer] = useState<any>(null);
  const [activeChannel, setActiveChannel] = useState<any>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  
  // Voice Call States
  const [inCall, setInCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{[key: string]: MediaStream}>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const peersRef = useRef<{[key: string]: RTCPeerConnection}>({});
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    if (!t || !u) {
      navigate('/login');
      return;
    }
    setToken(t);
    setUser(JSON.parse(u));

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    fetchServers(t);

    return () => {
      newSocket.disconnect();
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchServers = async (t: string) => {
    const res = await fetch(`${API_URL}/servers`, {
      headers: { 'Authorization': `Bearer ${t}` }
    });
    if (res.ok) {
      const data = await res.json();
      setServers(data);
    }
  };

  const handleCreateServer = async () => {
    const name = prompt('Nome do novo servidor:');
    if (!name) return;
    
    const res = await fetch(`${API_URL}/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      fetchServers(token);
    }
  };

  const selectServer = async (server: any) => {
    const res = await fetch(`${API_URL}/servers/${server.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setActiveServer(data);
      setActiveChannel(null);
      if (inCall) leaveCall();
    }
  };

  const selectChannel = async (channel: any) => {
    if (activeChannel?.id === channel.id) return;
    
    setActiveChannel(channel);
    
    if (channel.type === 'TEXT') {
      if (inCall) leaveCall();
      const res = await fetch(`${API_URL}/channels/${channel.id}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setMessages(await res.json());
      }
      
      socket?.emit('join-room', channel.id);
    } else if (channel.type === 'VOICE') {
      joinVoiceCall(channel.id);
    }
  };

  useEffect(() => {
    if (!socket) return;
    
    socket.on('new-message', (msg) => {
      if (activeChannel?.id === msg.channelId) {
        setMessages(prev => [...prev, msg]);
      }
    });

    return () => {
      socket.off('new-message');
    };
  }, [socket, activeChannel]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !activeChannel || activeChannel.type !== 'TEXT') return;
    
    socket?.emit('send-message', {
      channelId: activeChannel.id,
      content: inputMessage,
      authorId: user.id
    });
    setInputMessage('');
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // --- WebRTC Logic (Mesh) ---
  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  const joinVoiceCall = async (channelId: string) => {
    setInCall(true);
    socket?.emit('join-room', channelId);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: camEnabled });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (e) {
      console.error('Erro ao acessar mídia', e);
      alert('Permissão de microfone/câmera negada');
    }
  };

  const leaveCall = () => {
    setInCall(false);
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    Object.values(peersRef.current).forEach(peer => peer.close());
    peersRef.current = {};
    setRemoteStreams({});
    socket?.emit('join-room', activeServer?.id); // Dummy leave
  };

  useEffect(() => {
    if (!socket || !inCall || !localStream) return;

    socket.on('user-joined', async (userId) => {
      // Create Peer Connection for the new user
      const pc = createPeerConnection(userId);
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { to: userId, offer });
    });

    socket.on('webrtc-offer', async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { to: from, answer });
    });

    socket.on('webrtc-answer', async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('user-left', (userId) => {
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
        delete peersRef.current[userId];
        setRemoteStreams(prev => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });

    return () => {
      socket.off('user-joined');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice-candidate');
      socket.off('user-left');
    };
  }, [socket, inCall, localStream]);

  const createPeerConnection = (userId: string) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peersRef.current[userId] = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket?.emit('webrtc-ice-candidate', { to: userId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      setRemoteStreams(prev => ({ ...prev, [userId]: e.streams[0] }));
    };

    return pc;
  };

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !micEnabled);
      setMicEnabled(!micEnabled);
    }
  };

  const toggleCam = async () => {
    if (!localStream) return;
    
    if (!camEnabled) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
        
        // Update all peers with new track (Simpler to renegotiate but let's just do addTrack)
        Object.values(peersRef.current).forEach(pc => {
          pc.addTrack(videoTrack, localStream);
          // Realistically requires renegotiation
        });
        setCamEnabled(true);
      } catch (e) {
        console.error(e);
      }
    } else {
      localStream.getVideoTracks().forEach(t => {
        t.stop();
        localStream.removeTrack(t);
      });
      setCamEnabled(false);
    }
  };

  const toggleScreenShare = async () => {
    if (!localStream) return;
    
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        
        Object.values(peersRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          } else {
            pc.addTrack(videoTrack, localStream);
          }
        });
        
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setIsScreenSharing(true);

        videoTrack.onended = () => {
          stopScreenShare();
        };
      } catch (e) {
        console.error(e);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    setIsScreenSharing(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
    const videoTrack = localStream?.getVideoTracks()[0];
    Object.values(peersRef.current).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        if (videoTrack) sender.replaceTrack(videoTrack);
      }
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden text-[#dbdee1]">
      {/* Servers Sidebar */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 shrink-0 overflow-y-auto custom-scrollbar">
        <div 
          className="w-12 h-12 bg-[#313338] rounded-[24px] hover:rounded-[16px] hover:bg-discord-brand transition-all flex items-center justify-center cursor-pointer text-[#dbdee1]"
          onClick={() => { setActiveServer(null); setActiveChannel(null); if(inCall) leaveCall(); }}
        >
          <img src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6ca814282eca7172c6_icon_clyde_white_RGB.svg" alt="Home" className="w-7 h-7" />
        </div>
        <div className="w-8 h-[2px] bg-[#3f4147] rounded"></div>
        
        {servers.map(s => (
          <div 
            key={s.id} 
            className={`w-12 h-12 bg-[#313338] transition-all flex items-center justify-center cursor-pointer text-white font-bold text-lg select-none
              ${activeServer?.id === s.id ? 'rounded-[16px] bg-discord-brand' : 'rounded-[24px] hover:rounded-[16px] hover:bg-discord-brand'}`}
            onClick={() => selectServer(s)}
          >
            {s.name.charAt(0).toUpperCase()}
          </div>
        ))}

        <div 
          className="w-12 h-12 bg-[#313338] rounded-[24px] hover:rounded-[16px] hover:bg-[#23a559] hover:text-white text-[#23a559] transition-all flex items-center justify-center cursor-pointer mt-2"
          onClick={handleCreateServer}
        >
          <Plus size={24} />
        </div>
      </div>

      {/* Channels Sidebar */}
      {activeServer && (
        <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 rounded-tl-lg">
          <div className="h-12 border-b border-[#1e1f22] flex items-center px-4 font-bold text-white shadow-sm hover:bg-[#3f4147] cursor-pointer transition-colors">
            {activeServer.name}
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {/* Text Channels */}
            <div className="mb-4">
              <div className="flex items-center text-xs font-bold text-[#949ba4] uppercase mb-1 px-2">
                Canais de Texto
              </div>
              {activeServer.channels.filter((c:any) => c.type === 'TEXT').map((c:any) => (
                <div 
                  key={c.id} 
                  onClick={() => selectChannel(c)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[15px] cursor-pointer transition-colors
                    ${activeChannel?.id === c.id ? 'bg-[#3f4147]/60 text-white' : 'text-[#949ba4] hover:bg-[#3f4147]/40 hover:text-[#dbdee1]'}`}
                >
                  <Hash size={20} className="shrink-0" />
                  <span className="truncate">{c.name}</span>
                </div>
              ))}
            </div>

            {/* Voice Channels */}
            <div>
              <div className="flex items-center text-xs font-bold text-[#949ba4] uppercase mb-1 px-2">
                Canais de Voz
              </div>
              {activeServer.channels.filter((c:any) => c.type === 'VOICE').map((c:any) => (
                <div 
                  key={c.id} 
                  onClick={() => selectChannel(c)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[15px] cursor-pointer transition-colors
                    ${activeChannel?.id === c.id && inCall ? 'bg-[#3f4147]/60 text-white' : 'text-[#949ba4] hover:bg-[#3f4147]/40 hover:text-[#dbdee1]'}`}
                >
                  <Volume2 size={20} className="shrink-0" />
                  <span className="truncate">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* User Profile Area */}
          <div className="h-[52px] bg-[#232428] flex items-center px-2 gap-2 shrink-0">
            <div className="w-8 h-8 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white shrink-0">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-white truncate">{user?.name}</div>
              <div className="text-xs text-[#949ba4] truncate">Online</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={logout} className="p-1.5 rounded hover:bg-[#3f4147] text-[#b5bac1]"><LogOut size={18}/></button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 bg-[#313338] flex flex-col min-w-0">
        {!activeChannel ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#949ba4]">
            <img src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png" alt="Wumpus" className="w-48 opacity-30 mb-4" />
            <p className="text-lg">Selecione um canal para começar</p>
          </div>
        ) : activeChannel.type === 'TEXT' ? (
          <>
            <div className="h-12 border-b border-[#1e1f22] flex items-center px-4 gap-2 shadow-sm shrink-0">
              <Hash size={24} className="text-[#949ba4]" />
              <span className="font-bold text-white text-[15px]">{activeChannel.name}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col">
              <div className="mt-auto flex flex-col gap-4">
                {messages.map((m, i) => (
                  <div key={i} className="flex gap-4 group hover:bg-[#2b2d31]/50 p-2 rounded -mx-2 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-discord-brand shrink-0 flex items-center justify-center font-bold text-white mt-0.5">
                      {m.author.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-white hover:underline cursor-pointer">{m.author.name}</span>
                        <span className="text-xs text-[#949ba4]">Hoje às {new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="text-[15px] text-[#dbdee1] whitespace-pre-wrap leading-[1.375rem]">{m.content}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="p-4 shrink-0">
              <form onSubmit={sendMessage} className="bg-[#383a40] p-3 rounded-lg flex items-center gap-4">
                <input 
                  type="text" 
                  placeholder={`Conversar em #${activeChannel.name}`}
                  className="bg-transparent border-none outline-none text-white w-full text-[15px]"
                  value={inputMessage}
                  onChange={e => setInputMessage(e.target.value)}
                />
              </form>
            </div>
          </>
        ) : (
          /* Voice/Video Area */
          <div className="flex-1 flex flex-col bg-[#000000]">
            <div className="h-12 border-b border-[#1e1f22]/50 flex items-center px-4 gap-2 shrink-0 bg-[#313338]">
              <Volume2 size={24} className="text-[#949ba4]" />
              <span className="font-bold text-white text-[15px]">{activeChannel.name}</span>
            </div>
            
            <div className="flex-1 p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-max overflow-y-auto custom-scrollbar content-start">
              {/* Local User */}
              <div className="bg-[#1e1f22] aspect-video rounded-xl overflow-hidden relative border border-[#3f4147] shadow-lg flex items-center justify-center">
                {camEnabled ? (
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover -scale-x-100" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-discord-brand flex items-center justify-center text-3xl font-bold text-white">
                    {user?.name?.charAt(0)}
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs font-bold text-white flex gap-1 items-center backdrop-blur-sm">
                  {!micEnabled && <MicOff size={14} className="text-discord-red" />}
                  {user?.name} (Você)
                </div>
              </div>

              {/* Remote Users */}
              {Object.entries(remoteStreams).map(([peerId, stream]) => (
                <div key={peerId} className="bg-[#1e1f22] aspect-video rounded-xl overflow-hidden relative border border-[#3f4147] shadow-lg flex items-center justify-center">
                  {stream.getVideoTracks().length > 0 ? (
                    <video 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-cover" 
                      ref={el => { if(el) el.srcObject = stream; }}
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-indigo-500 flex items-center justify-center text-3xl font-bold text-white">
                      ?
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs font-bold text-white flex gap-1 items-center backdrop-blur-sm">
                    {/* Aqui precisaríamos do nome do par, mas para simplificar: */}
                    Usuário
                  </div>
                </div>
              ))}
            </div>

            {/* Call Controls */}
            <div className="h-[88px] bg-[#1e1f22] flex items-center justify-center gap-4 shrink-0 pb-2">
              <button onClick={toggleCam} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${camEnabled ? 'bg-[#313338] hover:bg-[#3f4147]' : 'bg-white hover:bg-gray-200 text-[#1e1f22]'}`}>
                {camEnabled ? <Video size={24}/> : <VideoOff size={24}/>}
              </button>
              <button onClick={toggleMic} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${micEnabled ? 'bg-[#313338] hover:bg-[#3f4147]' : 'bg-white hover:bg-gray-200 text-[#1e1f22]'}`}>
                {micEnabled ? <Mic size={24}/> : <MicOff size={24}/>}
              </button>
              <button onClick={toggleScreenShare} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isScreenSharing ? 'bg-[#23a559] hover:bg-[#1f8c4c] text-white' : 'bg-[#313338] hover:bg-[#3f4147]'}`}>
                <MonitorUp size={24}/>
              </button>
              <button onClick={leaveCall} className="w-14 h-14 rounded-full bg-[#da373c] hover:bg-[#c92f33] flex items-center justify-center text-white transition-all ml-4">
                <Volume2 size={24}/> {/* ícone de desligar idealmente */}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
