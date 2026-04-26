/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Search, 
  Menu, 
  X, 
  Save, 
  Clock, 
  ChevronLeft,
  BookOpen,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Lock,
  Mail,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './lib/supabase';

// --- Types ---
interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  userId: string;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
}

// --- Constants ---
const DEBOUNCE_DELAY = 500;

export default function App() {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showLandingPage, setShowLandingPage] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authFormData, setAuthFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // --- App State ---
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Derived State ---
  const filteredNotes = useMemo(() => {
    return notes
      .filter(n => 
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        n.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, searchQuery]);

  const activeNote = useMemo(() => {
    return notes.find(n => n.id === activeNoteId);
  }, [notes, activeNoteId]);

  // --- Helpers ---
  const generateTitle = useCallback((content: string) => {
    const firstLine = content.split('\n')[0].trim();
    return firstLine || 'Untitled Note';
  }, []);

  // --- Auth Actions ---
  const handleAuth = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      if (authMode === 'signup') {
        if (authFormData.password !== authFormData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        
        const { data, error } = await supabase.auth.signUp({
          email: authFormData.email,
          password: authFormData.password,
          options: {
            data: {
              full_name: authFormData.name
            }
          }
        });

        if (error) throw error;
        if (data.user) {
          if (!data.session) {
            setAuthError('Check your email for confirmation link!');
          }
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authFormData.email,
          password: authFormData.password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  }, [authMode, authFormData]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setNotes([]);
    setActiveNoteId(null);
    setShowLandingPage(true);
  }, []);

  // --- App Actions ---
  const fetchNotes = useCallback(async () => {
    if (!currentUser) return;
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching notes:', error);
      return;
    }

    if (data) {
      const formattedNotes: Note[] = data.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        updatedAt: new Date(n.updated_at).getTime(),
        userId: n.user_id
      }));
      setNotes(formattedNotes);
    }
  }, [currentUser]);

  const createNote = useCallback(async () => {
    if (!currentUser) return;
    
    const newNoteData = {
      title: 'New Note',
      content: '',
      user_id: currentUser.id,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('notes')
      .insert([newNoteData])
      .select()
      .single();

    if (error) {
      console.error('Error creating note:', error);
      return;
    }

    if (data) {
      const newNote: Note = {
        id: data.id,
        title: data.title,
        content: data.content,
        updatedAt: new Date(data.updated_at).getTime(),
        userId: data.user_id
      };
      setNotes(prev => [newNote, ...prev]);
      setActiveNoteId(newNote.id);
      setIsSidebarOpen(false);
    }
  }, [currentUser]);

  const deleteNote = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting note:', error);
      return;
    }

    setNotes(prev => prev.filter(n => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
    }
  }, [activeNoteId]);

  const updateNote = useCallback((content: string) => {
    if (!activeNoteId || !currentUser) return;

    setSaveStatus('saving');
    const title = generateTitle(content);
    const updatedAt = Date.now();

    // Optimistic update
    setNotes(prev => prev.map(n => {
      if (n.id === activeNoteId) {
        return { ...n, content, title, updatedAt };
      }
      return n;
    }));

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const { error } = await supabase
        .from('notes')
        .update({ 
          content, 
          title, 
          updated_at: new Date(updatedAt).toISOString() 
        })
        .eq('id', activeNoteId);

      if (error) {
        console.error('Error saving note:', error);
        setSaveStatus('idle');
      } else {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    }, DEBOUNCE_DELAY);
  }, [activeNoteId, currentUser, generateTitle]);

  // --- Effects ---
  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Initial session error:', error);
        supabase.auth.signOut();
        setCurrentUser(null);
        setSessionLoading(false);
        return;
      }

      if (session?.user) {
        setCurrentUser({
          id: session.user.id,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
          email: session.user.email || ''
        });
        setShowLandingPage(false);
      }
      setSessionLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        // Handle these if needed
      }

      if (session?.user) {
        setCurrentUser({
          id: session.user.id,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
          email: session.user.email || ''
        });
        setShowLandingPage(false);
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchNotes();
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && notes.length > 0 && !activeNoteId) {
      setActiveNoteId(notes[0].id);
    }
  }, [currentUser, notes.length]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-spin text-amber-500">
          <Clock size={32} />
        </div>
      </div>
    );
  }

  // --- Auth View ---
  if (!currentUser) {
    if (showLandingPage) {
      return (
        <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-amber-200">
          {/* Header */}
          <nav className="fixed top-0 w-full z-50 bg-white/70 backdrop-blur-xl border-b border-neutral-200/50">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="bg-amber-500 p-2 rounded-xl text-white shadow-lg shadow-amber-500/30">
                  <BookOpen size={24} />
                </div>
                <span className="text-xl font-bold tracking-tight">Notopad</span>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowLandingPage(false)}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2.5 rounded-full font-semibold transition-all shadow-lg shadow-amber-500/20 active:scale-95"
                >
                  Get Started
                </button>
              </div>
            </div>
          </nav>

          {/* Hero Section */}
          <main className="pt-32 pb-20 px-6">
            <div className="max-w-7xl mx-auto text-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 bg-gradient-to-br from-neutral-900 to-neutral-500 bg-clip-text text-transparent">
                  Your Ideas, Simplified. <br />
                  <span className="text-amber-500">Auto-saved.</span>
                </h1>
                <p className="text-lg md:text-xl text-neutral-500 max-w-2xl mx-auto mb-12 leading-relaxed">
                  The most minimal, fastest, and efficient way to capture your thoughts. 
                  Zero friction. Just open and start typing.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button 
                    onClick={() => setShowLandingPage(false)}
                    className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white px-10 py-4 rounded-2xl font-bold text-lg transition-all shadow-xl shadow-amber-500/30 hover:-translate-y-1"
                  >
                    Start Writing Now
                  </button>
                  <a href="#features" className="w-full sm:w-auto px-10 py-4 rounded-2xl font-semibold hover:bg-neutral-100 transition-all">
                    Learn More
                  </a>
                </div>
              </motion.div>

              {/* Mockup */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="mt-20 relative px-4"
              >
                <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-2xl border border-neutral-200 overflow-hidden">
                  <div className="h-12 bg-neutral-50 flex items-center px-6 gap-2 border-b border-neutral-200">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400/50" />
                      <div className="w-3 h-3 rounded-full bg-amber-400/50" />
                      <div className="w-3 h-3 rounded-full bg-green-400/50" />
                    </div>
                    <div className="flex-1 text-center text-xs font-medium text-neutral-400">notopad.app</div>
                  </div>
                  <div className="p-8 aspect-video flex items-center justify-center">
                    <div className="text-left w-full max-w-2xl">
                      <div className="h-4 w-48 bg-neutral-100 rounded-full mb-6" />
                      <div className="space-y-4">
                        <div className="h-3 w-full bg-neutral-50 rounded-full" />
                        <div className="h-3 w-full bg-neutral-50 rounded-full" />
                        <div className="h-3 w-2/3 bg-neutral-50 rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>
                {/* Decorative gradients */}
                <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[500px] bg-amber-500/10 blur-[120px] rounded-full" />
              </motion.div>
            </div>
          </main>

          {/* Features */}
          <section id="features" className="py-24 px-6 bg-white">
            <div className="max-w-7xl mx-auto">
              <div className="grid md:grid-cols-3 gap-8">
                {[
                  { icon: <Save size={28} />, title: "Instant Auto-save", desc: "Never lose a thought again. Every keystroke is saved immediately." },
                  { icon: <Lock size={28} />, title: "Secure & Private", desc: "Your notes belong to you. Encrypted storage right in your browser." },
                  { icon: <Clock size={28} />, title: "Minimal Experience", desc: "A beautifully crafted interface designed for focus and speed." }
                ].map((feat, i) => (
                  <motion.div 
                    key={i}
                    whileHover={{ y: -5 }}
                    className="p-10 rounded-3xl bg-neutral-50 border border-neutral-200 transition-all"
                  >
                    <div className="bg-amber-500/10 text-amber-500 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                      {feat.icon}
                    </div>
                    <h3 className="text-xl font-bold mb-3">{feat.title}</h3>
                    <p className="text-neutral-500 leading-relaxed">{feat.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="py-12 px-6 border-t border-neutral-100">
            <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 opacity-60 text-sm">
              <p>© 2024 Notopad. All rights reserved.</p>
              <div className="flex items-center gap-8">
                <a href="#" className="hover:text-amber-500">Privacy</a>
                <a href="#" className="hover:text-amber-500">Terms</a>
                <a href="#" className="hover:text-amber-500">Contact</a>
              </div>
            </div>
          </footer>
        </div>
      );
    }    return (
      <div className={`min-h-screen flex items-center justify-center p-6 bg-neutral-50 transition-colors duration-300 font-sans`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-neutral-100"
        >
          <button 
            onClick={() => setShowLandingPage(true)}
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-amber-500 mb-6 transition-colors font-medium"
          >
            <ChevronLeft size={16} />
            Back to landing page
          </button>
          <div className="flex flex-col items-center mb-10">
            <div className="bg-amber-500 p-3 rounded-2xl text-white mb-4 shadow-lg shadow-amber-500/20">
              <BookOpen size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Notopad</h1>
            <p className="text-neutral-500 text-sm mt-1">
              {authMode === 'login' ? 'Welcome back! Please login.' : 'Create an account to start writing.'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input 
                    type="text" 
                    required
                    placeholder="Enter your name"
                    className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                    value={authFormData.name}
                    onChange={(e) => setAuthFormData({...authFormData, name: e.target.value})}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <input 
                  type="email" 
                  required
                  placeholder="Enter your email"
                  className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                  value={authFormData.email}
                  onChange={(e) => setAuthFormData({...authFormData, email: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <input 
                  type="password" 
                  required
                  placeholder="Enter your password"
                  className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                  value={authFormData.password}
                  onChange={(e) => setAuthFormData({...authFormData, password: e.target.value})}
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input 
                    type="password" 
                    required
                    placeholder="Confirm your password"
                    className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                    value={authFormData.confirmPassword}
                    onChange={(e) => setAuthFormData({...authFormData, confirmPassword: e.target.value})}
                  />
                </div>
              </div>
            )}

            {authError && (
              <p className="text-red-500 text-xs font-medium ml-1 bg-red-50 p-2 rounded-lg">{authError}</p>
            )}

            <button 
              type="submit"
              disabled={isAuthLoading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 mt-4"
            >
              {isAuthLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <>
                  {authMode === 'login' ? 'Login' : 'Create Account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-neutral-500 font-medium">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button 
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthError('');
              }}
              className="text-amber-500 hover:underline"
            >
              {authMode === 'login' ? 'Sign Up' : 'Login'}
            </button>
          </p>
        </motion.div>
      </div>
    );
  }

  // --- Main App View ---
  return (
    <div className={`min-h-screen bg-neutral-50 text-neutral-900 transition-colors duration-300 font-sans`}>
      
      {/* Header */}
      <header className="sticky top-0 z-30 w-full bg-white/80 backdrop-blur-md border-b border-neutral-200 h-16 flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-neutral-100 rounded-full md:hidden"
            id="menu-toggle"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-amber-500 p-1.5 rounded-lg text-white">
              <BookOpen size={20} />
            </div>
            <h1 className="font-bold text-lg tracking-tight hidden sm:block">Notopad</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus !== 'idle' && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-neutral-100 rounded-full text-xs font-medium animate-pulse">
              <Save size={12} className={saveStatus === 'saving' ? 'animate-bounce' : ''} />
              <span>{saveStatus === 'saving' ? 'Saving...' : 'Saved'}</span>
            </div>
          )}
          
          <div className="h-8 w-[1px] bg-neutral-200 mx-2 hidden sm:block" />

          <button 
            onClick={createNote}
            className="bg-amber-500 hover:bg-amber-600 text-white p-2 sm:px-4 sm:py-2 rounded-full sm:rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
            id="new-note-btn"
          >
            <Plus size={20} />
            <span className="hidden sm:inline font-medium">New Note</span>
          </button>

          <div className="relative group">
            <button className="p-2 hover:bg-neutral-100 rounded-full">
              <User size={20} />
            </button>
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-neutral-100 p-2 opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all">
              <div className="px-3 py-2 border-b border-neutral-100 mb-1">
                <p className="text-xs font-bold text-neutral-400 uppercase">Signed in as</p>
                <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        
        {/* Sidebar Overlay (Mobile) */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-neutral-200 flex flex-col transition-transform duration-300 md:relative md:translate-x-0
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <div className="p-4 flex items-center justify-between border-b border-neutral-200">
            <h2 className="font-semibold">My Notes</h2>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 hover:bg-neutral-100 rounded">
              <X size={20} />
            </button>
          </div>

          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
              <input 
                type="text" 
                placeholder="Search notes..." 
                className="w-full bg-neutral-100 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
            {filteredNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4 opacity-50">
                <Search size={32} className="mb-2" />
                <p className="text-sm">{searchQuery ? "No matching notes" : "Start your first note"}</p>
              </div>
            ) : (
              filteredNotes.map(note => (
                <div
                  key={note.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveNoteId(note.id);
                    setIsSidebarOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setActiveNoteId(note.id);
                      setIsSidebarOpen(false);
                    }
                  }}
                  className={`
                    w-full text-left p-3 rounded-xl transition-all group flex items-start justify-between cursor-pointer
                    ${activeNoteId === note.id 
                      ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' 
                      : 'hover:bg-neutral-100'}
                  `}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className="font-medium text-sm truncate">{note.title}</h3>
                    <p className="text-xs opacity-60 truncate mt-1">
                      {note.content.split('\n')[1] || note.content || 'Empty note'}
                    </p>
                    <div className="flex items-center gap-1 mt-2 text-[10px] opacity-40">
                      <Clock size={10} />
                      <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => deleteNote(note.id, e)}
                    className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-white hover:text-red-500 rounded-lg transition-all"
                    aria-label="Delete note"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main Editor */}
        <main className="flex-1 h-full bg-white flex flex-col">
          {activeNote ? (
            <>
              {/* Mobile Back Button */}
              <div className="md:hidden p-2">
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex items-center gap-1 text-sm font-medium text-amber-500"
                >
                  <ChevronLeft size={18} />
                  Notes List
                </button>
              </div>
              
              <div className="flex-1 flex flex-col p-4 sm:p-8 max-w-4xl mx-auto w-full">
                <input 
                  type="text" 
                  value={activeNote.title}
                  readOnly
                  placeholder="Note Title"
                  className="text-2xl sm:text-4xl font-bold border-none outline-none bg-transparent placeholder:opacity-20 mb-6 text-neutral-800 px-0"
                />
                
                <textarea
                  placeholder="Start typing your thoughts..."
                  className="flex-1 w-full text-base sm:text-lg resize-none border-none outline-none bg-transparent placeholder:opacity-30 leading-relaxed text-neutral-600"
                  value={activeNote.content}
                  onChange={(e) => updateNote(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Status Bar */}
              <footer className="p-3 border-t border-neutral-100 text-[11px] text-neutral-400 flex justify-between px-6">
                <span>{activeNote.content.length} characters</span>
                <span className="flex items-center gap-1">
                  Last updated: {new Date(activeNote.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-30 select-none">
              <div className="bg-neutral-100 p-8 rounded-full mb-6">
                <Plus size={64} />
              </div>
              <h2 className="text-xl font-semibold mb-2">Welcome, {currentUser.name}!</h2>
              <p className="max-w-xs text-sm">Select a note from the sidebar or create a new one to get started.</p>
              <button 
                onClick={createNote}
                className="mt-6 font-medium text-amber-500 hover:underline"
              >
                Create your first note
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
