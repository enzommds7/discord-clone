import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/');
      window.location.reload(); // Quick way to update app state
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#313338] bg-[url('https://source.unsplash.com/random/1920x1080/?galaxy')] bg-cover bg-center bg-blend-overlay relative">
      <div className="absolute inset-0 bg-[#313338]/80 backdrop-blur-sm z-0"></div>
      
      <div className="bg-[#313338] p-8 rounded-md shadow-lg w-full max-w-md z-10 border border-[#1e1f22]/50">
        <h2 className="text-2xl font-bold text-center text-[#f2f3f5] mb-2">Bem-vindo de volta!</h2>
        <p className="text-center text-[#949ba4] mb-6">Estamos muito felizes em ver você novamente!</p>
        
        {error && <div className="bg-[#da373c]/20 text-[#da373c] p-2 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-1">E-mail</label>
            <input 
              type="email" 
              className="w-full bg-[#1e1f22] text-[#dbdee1] p-2.5 rounded border-none outline-none focus:ring-1 focus:ring-discord-brand"
              value={email} onChange={e => setEmail(e.target.value)} required 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-1">Senha</label>
            <input 
              type="password" 
              className="w-full bg-[#1e1f22] text-[#dbdee1] p-2.5 rounded border-none outline-none focus:ring-1 focus:ring-discord-brand"
              value={password} onChange={e => setPassword(e.target.value)} required 
            />
          </div>
          <button type="submit" className="bg-[#5865F2] hover:bg-[#4752C4] text-white p-2.5 rounded font-medium mt-2 transition-colors">
            Entrar
          </button>
        </form>

        <div className="mt-4 text-sm text-[#949ba4]">
          Precisando de uma conta? <Link to="/register" className="text-[#00a8fc] hover:underline">Registre-se</Link>
        </div>
      </div>
    </div>
  );
}
